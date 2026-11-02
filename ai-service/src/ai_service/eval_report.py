from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from ai_service.eval_metrics import (
    DATE_FORMAT,
    AgentCase,
    ExtractionCase,
    MetricResult,
    RagCase,
    Ratings,
    cites_only_expected,
    field_results,
    summary_counts,
    task_succeeds,
)

SEED_DATA_SENTENCE = "The judge received only fictional seed data over the Anthropic API."
NONE_CELL = "-"


@dataclass(frozen=True)
class EvalRun:
    date: date
    mode: str
    model: str
    embedding_model: str
    processor: str
    judge_model: str | None
    judge_instructions: str | None
    rag: list[RagCase]
    extraction: list[ExtractionCase]
    agent: list[AgentCase]
    results: list[MetricResult]


def cell(text: str) -> str:
    return " ".join(text.split()).replace("|", "\\|")


def table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> list[str]:
    return [
        f"| {' | '.join(header)} |",
        f"|{'|'.join('-' * (len(name) + 2) for name in header)}|",
        *[f"| {' | '.join(cell(value) for value in row)} |" for row in rows],
    ]


def yes_no(value: bool) -> str:
    return "yes" if value else "no"


def seconds(value: float) -> str:
    return f"{value:.1f}"


def pages(titles: Sequence[str]) -> str:
    return ", ".join(titles) or NONE_CELL


def percent(value: Decimal) -> str:
    return f"{value:.1f} %"


def metric_row(entry: MetricResult) -> list[str]:
    metric = entry.metric
    shown = percent(metric.percentage) if metric.percentage is not None else NONE_CELL
    threshold = f"{entry.threshold:f} %" if entry.threshold is not None else "none"
    return [
        metric.name,
        f"{metric.passed} of {metric.counted}",
        shown,
        threshold,
        entry.result.value,
    ]


def rating_text(label: str, reason: str | None) -> str:
    return f"{label}: {reason}"


def grounded_text(ratings: Ratings | None) -> str:
    if ratings is None:
        return NONE_CELL
    return rating_text("grounded" if ratings.grounded else "not_grounded", ratings.grounded_reason)


def correct_text(ratings: Ratings | None) -> str:
    if ratings is None or ratings.correct is None:
        return NONE_CELL
    return rating_text("correct" if ratings.correct else "incorrect", ratings.correct_reason)


def rag_row(case: RagCase) -> list[str]:
    expects_pages = bool(case.question.expected_pages)
    refused = case.outcome == "no_source" and case.failure is None
    return [
        case.question.id,
        case.question.user,
        case.outcome,
        pages(case.cited_pages),
        yes_no(cites_only_expected(case)) if expects_pages else NONE_CELL,
        NONE_CELL if expects_pages else yes_no(refused),
        grounded_text(case.ratings),
        correct_text(case.ratings),
        seconds(case.seconds),
    ]


def extraction_row(case: ExtractionCase) -> list[str]:
    shown_outcome = case.reason if case.outcome == "refused" and case.reason else case.outcome
    if case.contract.text_layer:
        fields = ", ".join(f"{key}: {r.value}" for key, r in field_results(case).items())
    else:
        fields = NONE_CELL
    return [case.contract.pdf, shown_outcome, fields, seconds(case.seconds)]


def agent_row(case: AgentCase) -> list[str]:
    scenario = case.scenario
    return [
        scenario.id,
        scenario.user,
        scenario.space,
        case.outcome or NONE_CELL,
        pages(case.proposal_pages),
        yes_no(task_succeeds(case)),
        pages(case.changed_pages),
        seconds(case.seconds),
    ]


def judge_section(run: EvalRun) -> list[str]:
    if run.judge_model is None:
        return ["- Judge: not run"]
    return [
        f"- Judge: {run.judge_model}",
        f"- Judge calls: {run.date.strftime(DATE_FORMAT)}",
        "",
        "Judge instructions:",
        "",
        "```",
        run.judge_instructions or "",
        "```",
        "",
        SEED_DATA_SENTENCE,
    ]


def failed_requests(run: EvalRun) -> list[tuple[str, str]]:
    return [
        *[(c.question.id, c.failure) for c in run.rag if c.failure],
        *[(c.contract.pdf, c.failure) for c in run.extraction if c.failure],
        *[(c.scenario.id, c.failure) for c in run.agent if c.failure],
    ]


def failed_judgements(run: EvalRun) -> list[tuple[str, str]]:
    return [(c.question.id, c.judge_failure) for c in run.rag if c.judge_failure]


def failure_section(title: str, failures: Sequence[tuple[str, str]]) -> list[str]:
    return [f"{title}: {len(failures)}", *[f"- {cell(i)}: {cell(why)}" for i, why in failures]]


def render_report(run: EvalRun) -> str:
    lines = [
        "# Evals",
        "",
        f"- Date: {run.date.strftime(DATE_FORMAT)}",
        f"- Inference mode: {run.mode}",
        f"- Model: {run.model}",
        f"- Embedding model: {run.embedding_model}",
        f"- Processor: {run.processor}",
        *judge_section(run),
        "",
        "## Metrics",
        "",
        *table(
            ["Metric", "Passed", "Percentage", "Threshold", "Result"],
            [metric_row(entry) for entry in run.results],
        ),
        "",
        "## RAG questions",
        "",
        *table(
            [
                "Id",
                "User",
                "Outcome",
                "Cited pages",
                "Citation passed",
                "Refusal passed",
                "Grounded",
                "Correct",
                "Seconds",
            ],
            [rag_row(case) for case in run.rag],
        ),
        "",
        "## Extraction",
        "",
        *table(
            ["File", "Outcome", "Fields", "Seconds"], [extraction_row(c) for c in run.extraction]
        ),
        "",
        "## Agent scenarios",
        "",
        *table(
            [
                "Id",
                "User",
                "Space",
                "Outcome",
                "Proposal pages",
                "Task success",
                "Pages changed",
                "Seconds",
            ],
            [agent_row(case) for case in run.agent],
        ),
        "",
        "## Failures",
        "",
        *failure_section("Failed requests", failed_requests(run)),
        "",
        *failure_section("Failed judgements", failed_judgements(run)),
    ]
    return "\n".join(lines) + "\n"


def summary_line(results: list[MetricResult]) -> str:
    reached, measured = summary_counts(results)
    return f"Evals: {reached} of {measured} metrics passed"
