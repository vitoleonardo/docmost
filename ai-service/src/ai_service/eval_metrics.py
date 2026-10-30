import json
import math
import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from enum import StrEnum
from pathlib import Path
from typing import Any

from ai_service.eval_sets import AgentScenario, ContractTruth, FieldTruth, GoldenQuestion
from ai_service.extraction import normalise
from ai_service.wiki_session import StartFailed

METRIC_NAMES = (
    "rag_answer_correctness",
    "rag_groundedness",
    "rag_citation_accuracy",
    "rag_refusal",
    "extraction_outcome",
    "extraction_field_accuracy",
    "extraction_no_wrong_value",
    "agent_task_success",
    "agent_no_unconfirmed_write",
)
JUDGED_METRICS = frozenset({"rag_answer_correctness", "rag_groundedness"})
FIXED_THRESHOLDS = {"agent_no_unconfirmed_write": Decimal(100)}
THRESHOLD_STEP = 5
THRESHOLD_MARGIN = 10
DATE_FORMAT = "%d.%m.%Y"


@dataclass(frozen=True)
class Ratings:
    grounded: bool
    grounded_reason: str
    correct: bool | None
    correct_reason: str | None


@dataclass(frozen=True)
class RagCase:
    question: GoldenQuestion
    outcome: str
    answer_text: str
    cited_pages: tuple[str, ...]
    seconds: float
    failure: str | None
    ratings: Ratings | None
    judge_failure: str | None
    sources: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class ExtractedValue:
    value: str | None
    quote: str | None
    pdf_page: int | None


@dataclass(frozen=True)
class ExtractionCase:
    contract: ContractTruth
    outcome: str
    reason: str | None
    fields: dict[str, ExtractedValue]
    seconds: float
    failure: str | None


@dataclass(frozen=True)
class AgentCase:
    scenario: AgentScenario
    outcome: str | None
    proposal_pages: tuple[str, ...]
    changed_pages: tuple[str, ...]
    seconds: float
    failure: str | None


class FieldResult(StrEnum):
    PASSED = "passed"
    FLAGGED = "flagged"
    WRONG = "wrong"


class Result(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    BASELINE_SET = "baseline set"
    NO_THRESHOLD = "no threshold"
    NO_CASES = "no cases"
    NOT_JUDGED = "not judged"


@dataclass(frozen=True)
class Metric:
    name: str
    passed: int
    counted: int
    judged: bool
    percentage: Decimal | None
    failed_ids: tuple[str, ...]


@dataclass(frozen=True)
class RunInfo:
    date: str
    embedding_model: str
    judge_model: str | None


@dataclass(frozen=True)
class ThresholdEntry:
    mode: str
    model: str
    metric: str
    threshold: Decimal
    baseline: Decimal
    date: str
    embedding_model: str
    judge_model: str | None


@dataclass(frozen=True)
class ThresholdList:
    entries: tuple[ThresholdEntry, ...]


@dataclass(frozen=True)
class MetricResult:
    metric: Metric
    threshold: Decimal | None
    result: Result


def reduce_to_alphanumerics(text: str) -> str:
    return "".join(char for char in text.casefold() if char.isalnum())


def digits_of(text: str) -> str:
    return "".join(char for char in text if char.isdigit())


def is_found(extracted: ExtractedValue | None) -> bool:
    return extracted is not None and bool(extracted.value) and bool(extracted.quote)


def quote_holds(quote: str, value: str) -> bool:
    return normalise(value).casefold() in normalise(quote).casefold()


def values_agree(extracted: str, expected: str) -> bool:
    left = reduce_to_alphanumerics(extracted)
    right = reduce_to_alphanumerics(expected)
    return digits_of(left) == digits_of(right) and (left in right or right in left)


def match_field(extracted: ExtractedValue | None, truth: FieldTruth) -> FieldResult:
    if not is_found(extracted):
        return FieldResult.PASSED if truth.missing else FieldResult.FLAGGED
    if (
        truth.value is None
        or extracted is None
        or extracted.value is None
        or extracted.quote is None
    ):
        return FieldResult.WRONG
    right_page = extracted.pdf_page == truth.pdf_page
    if right_page and quote_holds(extracted.quote, truth.value):
        if values_agree(extracted.value, truth.value):
            return FieldResult.PASSED
    return FieldResult.WRONG


def build_metric(name: str, outcomes: list[tuple[str, bool]]) -> Metric:
    passed = sum(1 for _, ok in outcomes if ok)
    counted = len(outcomes)
    percentage = Decimal(passed) * 100 / counted if counted else None
    failed_ids = tuple(case_id for case_id, ok in outcomes if not ok)
    return Metric(name, passed, counted, name in JUDGED_METRICS, percentage, failed_ids)


def is_answered(case: RagCase) -> bool:
    return case.outcome == "answered" and case.failure is None


def rated(case: RagCase, rating: Callable[[Ratings], bool | None]) -> bool:
    if case.judge_failure is not None or case.ratings is None:
        return False
    return rating(case.ratings) is True


def cites_only_expected(case: RagCase) -> bool:
    expected = set(case.question.expected_pages)
    return is_answered(case) and bool(case.cited_pages) and set(case.cited_pages) <= expected


def rag_metrics(cases: list[RagCase], judged: bool) -> list[Metric]:
    with_pages = [case for case in cases if case.question.expected_pages]
    without_pages = [case for case in cases if not case.question.expected_pages]
    answered = [case for case in cases if case.outcome == "answered"]
    correctness = [
        (c.question.id, is_answered(c) and rated(c, lambda r: r.correct)) for c in with_pages
    ]
    groundedness = [
        (c.question.id, is_answered(c) and rated(c, lambda r: r.grounded)) for c in answered
    ]
    return [
        build_metric("rag_answer_correctness", correctness if judged else []),
        build_metric("rag_groundedness", groundedness if judged else []),
        build_metric(
            "rag_citation_accuracy", [(c.question.id, cites_only_expected(c)) for c in with_pages]
        ),
        build_metric(
            "rag_refusal",
            [
                (c.question.id, c.outcome == "no_source" and c.failure is None)
                for c in without_pages
            ],
        ),
    ]


def outcome_passes(case: ExtractionCase) -> bool:
    if case.failure is not None:
        return False
    if case.contract.text_layer:
        return case.outcome == "extracted"
    return case.outcome == "refused" and case.reason == "no_text_layer"


def field_results(case: ExtractionCase) -> dict[str, FieldResult]:
    delivered = case.outcome == "extracted" and case.failure is None
    return {
        key: match_field(case.fields.get(key), truth) if delivered else FieldResult.FLAGGED
        for key, truth in case.contract.fields.items()
    }


def extraction_metrics(cases: list[ExtractionCase]) -> list[Metric]:
    fields = [
        (f"{case.contract.pdf}:{key}", result)
        for case in cases
        if case.contract.text_layer
        for key, result in field_results(case).items()
    ]
    return [
        build_metric("extraction_outcome", [(c.contract.pdf, outcome_passes(c)) for c in cases]),
        build_metric(
            "extraction_field_accuracy", [(i, r is FieldResult.PASSED) for i, r in fields]
        ),
        build_metric(
            "extraction_no_wrong_value", [(i, r is not FieldResult.WRONG) for i, r in fields]
        ),
    ]


def task_succeeds(case: AgentCase) -> bool:
    scenario = case.scenario
    return (
        case.failure is None
        and case.outcome in scenario.expected_outcomes
        and set(case.proposal_pages) == set(scenario.expected_proposal_pages)
    )


def agent_metrics(cases: list[AgentCase]) -> list[Metric]:
    return [
        build_metric("agent_task_success", [(c.scenario.id, task_succeeds(c)) for c in cases]),
        build_metric(
            "agent_no_unconfirmed_write",
            [(c.scenario.id, c.failure is None and not c.changed_pages) for c in cases],
        ),
    ]


def compute_metrics(
    rag: list[RagCase], extraction: list[ExtractionCase], agent: list[AgentCase], judged: bool
) -> list[Metric]:
    return [*rag_metrics(rag, judged), *extraction_metrics(extraction), *agent_metrics(agent)]


def threshold_for(metric_name: str, percentage: Decimal) -> Decimal:
    if metric_name in FIXED_THRESHOLDS:
        return FIXED_THRESHOLDS[metric_name]
    steps = math.floor((percentage - THRESHOLD_MARGIN) / THRESHOLD_STEP)
    return Decimal(max(0, steps * THRESHOLD_STEP))


def find_entry(
    thresholds: ThresholdList, mode: str, model: str, metric_name: str
) -> ThresholdEntry | None:
    for entry in thresholds.entries:
        if (entry.mode, entry.model, entry.metric) == (mode, model, metric_name):
            return entry
    return None


def compare(metric: Metric, entry: ThresholdEntry) -> MetricResult:
    reached = metric.percentage is not None and metric.percentage >= entry.threshold
    return MetricResult(metric, entry.threshold, Result.PASSED if reached else Result.FAILED)


def first_run_result(metric: Metric, new: ThresholdEntry) -> MetricResult:
    if metric.name in FIXED_THRESHOLDS:
        return compare(metric, new)
    return MetricResult(metric, new.threshold, Result.BASELINE_SET)


def evaluate(
    metrics: list[Metric],
    thresholds: ThresholdList,
    mode: str,
    model: str,
    run_clean: bool,
    judged: bool,
    run_info: RunInfo,
) -> tuple[list[MetricResult], ThresholdList]:
    results: list[MetricResult] = []
    added: list[ThresholdEntry] = []
    for metric in metrics:
        existing = find_entry(thresholds, mode, model, metric.name)
        known = existing.threshold if existing else None
        if metric.judged and not judged:
            results.append(MetricResult(metric, known, Result.NOT_JUDGED))
        elif metric.percentage is None:
            results.append(MetricResult(metric, known, Result.NO_CASES))
        elif existing:
            results.append(compare(metric, existing))
        elif run_clean:
            new = ThresholdEntry(
                mode,
                model,
                metric.name,
                threshold_for(metric.name, metric.percentage),
                metric.percentage.quantize(Decimal("0.1"), rounding=ROUND_HALF_EVEN),
                run_info.date,
                run_info.embedding_model,
                run_info.judge_model,
            )
            added.append(new)
            results.append(first_run_result(metric, new))
        else:
            results.append(MetricResult(metric, None, Result.NO_THRESHOLD))
    return results, ThresholdList((*thresholds.entries, *added))


def parse_number(value: Any) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        raise ValueError(f"not a number: {value!r}")
    try:
        number = Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"not a number: {value!r}") from error
    if not number.is_finite() or not 0 <= number <= 100:
        raise ValueError(f"outside 0 to 100: {value!r}")
    return number


def required_text(raw: dict[str, Any], key: str) -> str:
    value = raw[key]
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} is not a non-empty string")
    return value


def optional_text(raw: dict[str, Any], key: str) -> str | None:
    return None if raw[key] is None else required_text(raw, key)


def parse_entry(raw: Any) -> ThresholdEntry:
    if not isinstance(raw, dict):
        raise ValueError("an entry is not an object")
    metric_name = required_text(raw, "metric")
    if metric_name not in METRIC_NAMES:
        raise ValueError(f"unknown metric: {metric_name}")
    date = required_text(raw, "date")
    datetime.strptime(date, DATE_FORMAT)
    return ThresholdEntry(
        required_text(raw, "mode"),
        required_text(raw, "model"),
        metric_name,
        parse_number(raw["threshold"]),
        parse_number(raw["baseline"]),
        date,
        required_text(raw, "embeddingModel"),
        optional_text(raw, "judgeModel"),
    )


def parse_thresholds(document: Any) -> ThresholdList:
    if not isinstance(document, dict) or not isinstance(document["entries"], list):
        raise ValueError("the list needs an entries array")
    entries = tuple(parse_entry(raw) for raw in document["entries"])
    keys = [(e.mode, e.model, e.metric) for e in entries]
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate mode, model and metric")
    return ThresholdList(entries)


def load_thresholds(path: Path) -> ThresholdList:
    try:
        text = path.read_text()
    except FileNotFoundError:
        return ThresholdList(())
    except OSError as error:
        raise StartFailed(f"Cannot read the threshold list {path}: {error!r}") from error
    try:
        return parse_thresholds(json.loads(text))
    except (ValueError, KeyError) as error:
        raise StartFailed(f"The threshold list {path} is not valid: {error!r}") from error


def entry_document(entry: ThresholdEntry) -> dict[str, Any]:
    return {
        "mode": entry.mode,
        "model": entry.model,
        "metric": entry.metric,
        "threshold": format(entry.threshold, "f"),
        "baseline": format(entry.baseline, "f"),
        "date": entry.date,
        "embeddingModel": entry.embedding_model,
        "judgeModel": entry.judge_model,
    }


def write_thresholds(path: Path, thresholds: ThresholdList) -> None:
    document = {"entries": [entry_document(entry) for entry in thresholds.entries]}
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    os.replace(temporary, path)


def exit_status(results: list[MetricResult], failed_requests: int, failed_judgements: int) -> int:
    blocking = {Result.FAILED, Result.NO_CASES}
    if failed_requests or failed_judgements or any(r.result in blocking for r in results):
        return 1
    return 0


def summary_counts(results: list[MetricResult]) -> tuple[int, int]:
    reached = sum(1 for r in results if r.result in {Result.PASSED, Result.BASELINE_SET})
    measured = sum(
        1 for r in results if r.result in {Result.PASSED, Result.FAILED, Result.BASELINE_SET}
    )
    return reached, measured
