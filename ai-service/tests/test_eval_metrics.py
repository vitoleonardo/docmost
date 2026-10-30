import json
from collections.abc import Sequence
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import pytest

from ai_service.eval_metrics import (
    AgentCase,
    ExtractedValue,
    ExtractionCase,
    FieldResult,
    Metric,
    MetricResult,
    RagCase,
    Ratings,
    Result,
    RunInfo,
    ThresholdEntry,
    ThresholdList,
    compute_metrics,
    evaluate,
    exit_status,
    load_thresholds,
    match_field,
    summary_counts,
    write_thresholds,
)
from ai_service.eval_sets import (
    AgentScenario,
    ContractTruth,
    FieldTruth,
    GoldenQuestion,
    load_eval_sets,
)
from ai_service.wiki_session import StartFailed
from tests.seed_matrix import SEED_CONTENT

CONTRACTS = {contract.pdf: contract for contract in load_eval_sets(SEED_CONTENT).contracts}
CUSTOMER = CONTRACTS["kundenvertrag-stadtwerke-beispielstadt.pdf"]
SUBCONTRACTOR = CONTRACTS["subunternehmervertrag-tiefbau.pdf"]
SCAN = CONTRACTS["wartungsvertrag-serverraum-scan.pdf"]
RUN_INFO = RunInfo(date="30.10.2026", embedding_model="embed-1", judge_model="judge-1")
GOOD = Ratings(True, "supported", True, "matches")


def question(*expected: str, id: str = "q") -> GoldenQuestion:
    return GoldenQuestion(
        id=id,
        user="GF",
        question="Frage?",
        expected_pages=list(expected),
        answered_by=expected[0] if expected else None,
        reference_answer="Antwort" if expected else None,
        key_fact="Fakt" if expected else None,
    )


def rag_case(
    asked: GoldenQuestion,
    outcome: str = "answered",
    cited: tuple[str, ...] = (),
    ratings: Ratings | None = None,
    failure: str | None = None,
    judge_failure: str | None = None,
) -> RagCase:
    return RagCase(asked, outcome, "Text", cited, 1.0, failure, ratings, judge_failure)


def scenario(proposals: list[str], outcomes: list[str] | None = None) -> AgentScenario:
    return AgentScenario("agent", "GF", "Space", "Aufgabe", outcomes or ["finished"], proposals)


def agent_case(
    planned: AgentScenario,
    outcome: str | None = "finished",
    proposals: tuple[str, ...] = (),
    changed: tuple[str, ...] = (),
    failure: str | None = None,
) -> AgentCase:
    return AgentCase(planned, outcome, proposals, changed, 1.0, failure)


def perfect_fields(contract: ContractTruth) -> dict[str, ExtractedValue]:
    return {
        key: ExtractedValue(truth.value, truth.quote, truth.pdf_page)
        for key, truth in contract.fields.items()
    }


def extraction_case(
    contract: ContractTruth,
    outcome: str = "extracted",
    reason: str | None = None,
    fields: dict[str, ExtractedValue] | None = None,
    failure: str | None = None,
) -> ExtractionCase:
    given = perfect_fields(contract) if fields is None else fields
    return ExtractionCase(contract, outcome, reason, given, 1.0, failure)


def metrics_of(
    rag: Sequence[RagCase] = (),
    extraction: Sequence[ExtractionCase] = (),
    agent: Sequence[AgentCase] = (),
    judged: bool = True,
) -> dict[str, Metric]:
    return {m.name: m for m in compute_metrics(list(rag), list(extraction), list(agent), judged)}


def metric(name: str, passed: int, counted: int, judged: bool = False) -> Metric:
    percentage = Decimal(passed) * 100 / counted if counted else None
    return Metric(name, passed, counted, judged, percentage, ())


def truth(value: str | None = "1.200.000,00 € netto", page: int | None = 1) -> FieldTruth:
    return FieldTruth(value=value, quote=value, pdf_page=page)


def found(value: str, quote: str, page: int = 1) -> ExtractedValue:
    return ExtractedValue(value, quote, page)


def entry(metric_name: str, threshold: str, model: str = "qwen3:8b") -> ThresholdEntry:
    return ThresholdEntry(
        "local",
        model,
        metric_name,
        Decimal(threshold),
        Decimal("90"),
        "01.01.2026",
        "embed-0",
        None,
    )


def evaluate_one(
    m: Metric,
    existing: Sequence[ThresholdEntry] = (),
    clean: bool = True,
    judged: bool = True,
    model: str = "qwen3:8b",
) -> tuple[MetricResult, ThresholdList]:
    results, updated = evaluate(
        [m], ThresholdList(tuple(existing)), "local", model, clean, judged, RUN_INFO
    )
    return results[0], updated


def test_eval_ac9_a_citation_through_an_attached_pdf_passes():
    asked = question("Vertragsseite", "Zweite Seite")
    cases = [rag_case(asked, cited=("Vertragsseite",))]
    assert metrics_of(rag=cases)["rag_citation_accuracy"].passed == 1


def test_eval_ac10_an_extra_cited_page_fails_the_citation():
    asked = question("Seite A")
    cases = [rag_case(asked, cited=("Seite A", "Seite B"))]
    result = metrics_of(rag=cases)["rag_citation_accuracy"]
    assert (result.passed, result.counted) == (0, 1)
    assert result.failed_ids == ("q",)


def test_eval_ac10_an_answer_without_a_cited_page_fails_the_citation():
    cases = [rag_case(question("Seite A"), cited=())]
    assert metrics_of(rag=cases)["rag_citation_accuracy"].passed == 0


def test_eval_ac11_no_source_fails_citation_and_correctness_without_ratings():
    cases = [rag_case(question("Seite A"), outcome="no_source")]
    metrics = metrics_of(rag=cases)
    assert (metrics["rag_citation_accuracy"].passed, metrics["rag_citation_accuracy"].counted) == (
        0,
        1,
    )
    assert (
        metrics["rag_answer_correctness"].passed,
        metrics["rag_answer_correctness"].counted,
    ) == (
        0,
        1,
    )
    assert metrics["rag_groundedness"].counted == 0


def test_eval_ac12_no_source_passes_the_refusal():
    cases = [rag_case(question(), outcome="no_source")]
    result = metrics_of(rag=cases)["rag_refusal"]
    assert (result.passed, result.counted) == (1, 1)


def test_eval_ac13_an_answered_question_without_pages_fails_refusal_and_counts_for_groundedness():
    cases = [rag_case(question(), ratings=Ratings(True, "ok", None, None))]
    metrics = metrics_of(rag=cases)
    assert (metrics["rag_refusal"].passed, metrics["rag_refusal"].counted) == (0, 1)
    assert (metrics["rag_groundedness"].passed, metrics["rag_groundedness"].counted) == (1, 1)
    assert metrics["rag_answer_correctness"].counted == 0


def test_eval_ac14_no_answered_case_gives_no_cases_no_threshold_and_exit_1():
    cases = [rag_case(question("Seite A"), outcome="no_source")]
    groundedness = metrics_of(rag=cases)["rag_groundedness"]
    assert (groundedness.passed, groundedness.counted, groundedness.percentage) == (0, 0, None)
    result, updated = evaluate_one(groundedness, judged=True)
    assert result.result is Result.NO_CASES
    assert updated.entries == ()
    assert exit_status([result], 0, 0) == 1


def test_eval_ac16_correct_but_not_grounded_passes_correctness_and_fails_groundedness():
    ratings = Ratings(False, "unsupported", True, "matches")
    cases = [rag_case(question("Seite A"), cited=("Seite A",), ratings=ratings)]
    metrics = metrics_of(rag=cases)
    assert metrics["rag_answer_correctness"].passed == 1
    assert metrics["rag_groundedness"].passed == 0


def test_eval_ac16_a_judge_failure_or_failed_request_counts_as_not_passed():
    asked = question("Seite A")
    cases = [
        rag_case(asked, judge_failure="APITimeoutError"),
        rag_case(asked, outcome="failed", failure="error", ratings=GOOD, cited=("Seite A",)),
    ]
    metrics = metrics_of(rag=cases)
    assert metrics["rag_answer_correctness"].passed == 0
    assert metrics["rag_answer_correctness"].counted == 2
    assert metrics["rag_groundedness"].passed == 0
    assert metrics["rag_groundedness"].counted == 1
    assert metrics["rag_citation_accuracy"].passed == 0


def test_eval_ac16_without_a_judge_the_judged_metrics_have_no_percentage():
    cases = [rag_case(question("Seite A"), cited=("Seite A",))]
    metrics = metrics_of(rag=cases, judged=False)
    assert metrics["rag_answer_correctness"].percentage is None
    assert metrics["rag_answer_correctness"].judged
    assert metrics["rag_citation_accuracy"].percentage == Decimal(100)


def test_eval_ac23_a_found_field_on_the_right_page_with_the_value_in_the_quote_passes():
    extracted = found("1.200.000,00 € netto", "Der Wert beträgt 1.200.000,00 €  netto zuzüglich.")
    assert match_field(extracted, truth()) is FieldResult.PASSED


def test_eval_ac24_an_extracted_value_holding_the_truth_value_passes():
    extracted = found(
        "Auftragswert 1.200.000,00 € netto zuzüglich Umsatzsteuer", "xx 1.200.000,00 € netto yy"
    )
    assert match_field(extracted, truth()) is FieldResult.PASSED


def test_eval_ac24_a_value_held_in_the_extracted_value_in_either_direction_passes():
    shorter = found("1.200.000,00", "xx 1.200.000,00 € netto yy")
    assert match_field(shorter, truth()) is FieldResult.PASSED


def test_eval_ac25_the_value_zero_for_a_large_amount_is_wrong():
    extracted = found("0", "Der Auftragswert beträgt 1.200.000,00 € netto.")
    assert match_field(extracted, truth()) is FieldResult.WRONG


def test_eval_ac25_a_quote_without_the_truth_value_is_wrong():
    extracted = found("1.200.000,00 € netto", "Der Auftragswert beträgt etwas.")
    assert match_field(extracted, truth()) is FieldResult.WRONG


def test_eval_ac26_another_pdf_page_is_wrong():
    extracted = found("1.200.000,00 € netto", "1.200.000,00 € netto", page=2)
    assert match_field(extracted, truth()) is FieldResult.WRONG


def test_eval_ac27_a_not_found_field_with_a_truth_value_is_flagged_and_fails_accuracy_only():
    fields = perfect_fields(CUSTOMER)
    fields["value"] = ExtractedValue(None, None, None)
    metrics = metrics_of(extraction=[extraction_case(CUSTOMER, fields=fields)])
    assert match_field(fields["value"], CUSTOMER.fields["value"]) is FieldResult.FLAGGED
    assert (
        metrics["extraction_field_accuracy"].passed,
        metrics["extraction_field_accuracy"].counted,
    ) == (4, 5)
    assert metrics["extraction_no_wrong_value"].passed == 5


def test_eval_ac27_an_empty_quote_counts_as_not_found():
    assert match_field(ExtractedValue("x", "", 1), truth()) is FieldResult.FLAGGED
    assert match_field(ExtractedValue("", "x", 1), truth()) is FieldResult.FLAGGED


def test_eval_ac28_a_missing_truth_with_a_not_found_field_passes():
    renewal = SUBCONTRACTOR.fields["renewal"]
    assert renewal.missing
    assert match_field(ExtractedValue(None, None, None), renewal) is FieldResult.PASSED
    assert match_field(None, renewal) is FieldResult.PASSED


def test_eval_ac29_a_missing_truth_with_a_found_field_is_wrong():
    renewal = SUBCONTRACTOR.fields["renewal"]
    assert match_field(found("12 Monate", "verlängert sich"), renewal) is FieldResult.WRONG


def test_eval_ac30_a_refused_scan_passes_the_outcome_and_counts_no_fields():
    refused = extraction_case(SCAN, outcome="refused", reason="no_text_layer", fields={})
    metrics = metrics_of(extraction=[refused])
    assert (metrics["extraction_outcome"].passed, metrics["extraction_outcome"].counted) == (1, 1)
    assert metrics["extraction_field_accuracy"].counted == 0
    assert metrics["extraction_no_wrong_value"].counted == 0


def test_eval_ac30_a_scan_refused_for_another_reason_or_extracted_fails_the_outcome():
    other = extraction_case(SCAN, outcome="refused", reason="other", fields={})
    extracted = extraction_case(SCAN)
    assert metrics_of(extraction=[other, extracted])["extraction_outcome"].passed == 0


def test_eval_ac31_a_model_failure_fails_the_outcome_and_flags_the_five_fields():
    failed = extraction_case(CUSTOMER, outcome="failed", fields={}, failure="model_failed")
    metrics = metrics_of(extraction=[failed])
    assert metrics["extraction_outcome"].passed == 0
    assert (
        metrics["extraction_field_accuracy"].passed,
        metrics["extraction_field_accuracy"].counted,
    ) == (0, 5)
    assert metrics["extraction_no_wrong_value"].passed == 5


def test_eval_ac31_a_refused_text_layer_contract_flags_its_fields():
    refused = extraction_case(CUSTOMER, outcome="refused", reason="no_text_layer", fields={})
    metrics = metrics_of(extraction=[refused])
    assert metrics["extraction_outcome"].passed == 0
    assert metrics["extraction_field_accuracy"].counted == 5


def test_eval_ac31_the_subcontractor_contract_extracted_perfectly_passes_all_fields():
    metrics = metrics_of(extraction=[extraction_case(SUBCONTRACTOR)])
    assert metrics["extraction_field_accuracy"].passed == 5
    assert metrics["extraction_outcome"].passed == 1


def test_eval_ac33_the_exact_proposal_set_passes_task_success():
    planned = scenario(["Reisekosten Richtlinie 2022"])
    cases = [agent_case(planned, proposals=("Reisekosten Richtlinie 2022",))]
    assert metrics_of(agent=cases)["agent_task_success"].passed == 1


def test_eval_ac34_an_extra_proposal_page_fails_task_success():
    planned = scenario(["Seite A"])
    cases = [agent_case(planned, proposals=("Seite A", "Seite B"))]
    assert metrics_of(agent=cases)["agent_task_success"].passed == 0


def test_eval_ac34_a_missing_proposal_or_unexpected_outcome_or_failure_fails():
    planned = scenario(["Seite A"])
    cases = [
        agent_case(planned, proposals=()),
        agent_case(planned, outcome="out_of_scope", proposals=("Seite A",)),
        agent_case(planned, proposals=("Seite A",), failure="timeout"),
    ]
    assert metrics_of(agent=cases)["agent_task_success"].passed == 0


def test_eval_ac35_finished_without_a_proposal_passes_when_either_outcome_is_expected():
    planned = scenario([], outcomes=["finished", "out_of_scope"])
    cases = [agent_case(planned), agent_case(planned, outcome="out_of_scope")]
    assert metrics_of(agent=cases)["agent_task_success"].passed == 2


def test_eval_ac36_an_unchanged_workspace_passes_no_unconfirmed_write():
    metrics = metrics_of(agent=[agent_case(scenario([]))])
    assert metrics["agent_no_unconfirmed_write"].passed == 1


def test_eval_ac37_a_changed_page_fails_and_the_command_exits_1():
    cases = [agent_case(scenario([]), changed=("Seite A",))]
    result = metrics_of(agent=cases)["agent_no_unconfirmed_write"]
    assert result.passed == 0
    evaluated, _ = evaluate_one(result, existing=[entry("agent_no_unconfirmed_write", "100")])
    assert evaluated.result is Result.FAILED
    assert exit_status([evaluated], 0, 0) == 1


def test_eval_ac38_an_added_page_fails_no_unconfirmed_write():
    cases = [agent_case(scenario([]), changed=("Neue Seite",))]
    assert metrics_of(agent=cases)["agent_no_unconfirmed_write"].passed == 0


def test_eval_ac38_a_failed_run_counts_as_not_passed():
    cases = [agent_case(scenario([]), outcome=None, failure="timeout")]
    assert metrics_of(agent=cases)["agent_no_unconfirmed_write"].passed == 0


def test_eval_the_nine_metrics_come_in_spec_order():
    assert list(metrics_of()) == [
        "rag_answer_correctness",
        "rag_groundedness",
        "rag_citation_accuracy",
        "rag_refusal",
        "extraction_outcome",
        "extraction_field_accuracy",
        "extraction_no_wrong_value",
        "agent_task_success",
        "agent_no_unconfirmed_write",
    ]


def test_eval_ac39_87_5_percent_sets_threshold_75_with_baseline_and_run_info():
    result, updated = evaluate_one(metric("rag_citation_accuracy", 7, 8))
    assert result.result is Result.BASELINE_SET
    assert result.threshold == Decimal(75)
    assert updated.entries == (
        ThresholdEntry(
            "local",
            "qwen3:8b",
            "rag_citation_accuracy",
            Decimal(75),
            Decimal("87.5"),
            "30.10.2026",
            "embed-1",
            "judge-1",
        ),
    )


def test_eval_ac40_100_percent_sets_threshold_90():
    result, updated = evaluate_one(metric("rag_refusal", 5, 5))
    assert updated.entries[0].threshold == Decimal(90)
    assert result.threshold == Decimal(90)


def test_eval_ac41_4_percent_sets_threshold_0():
    result, updated = evaluate_one(metric("rag_refusal", 1, 25))
    assert updated.entries[0].threshold == Decimal(0)
    assert result.result is Result.BASELINE_SET


def test_eval_ac42_no_unconfirmed_write_always_gets_threshold_100():
    _, full = evaluate_one(metric("agent_no_unconfirmed_write", 6, 6))
    _, partial = evaluate_one(metric("agent_no_unconfirmed_write", 3, 6))
    assert full.entries[0].threshold == Decimal(100)
    assert partial.entries[0].threshold == Decimal(100)


def test_eval_ac43_75_below_80_fails_keeps_the_threshold_and_exits_1():
    existing = [entry("rag_refusal", "80")]
    result, updated = evaluate_one(metric("rag_refusal", 3, 4), existing=existing)
    assert result.result is Result.FAILED
    assert result.threshold == Decimal(80)
    assert updated.entries == tuple(existing)
    assert exit_status([result], 0, 0) == 1


def test_eval_ac43_a_percentage_just_below_the_threshold_fails_without_rounding():
    existing = [entry("rag_refusal", "67")]
    result, _ = evaluate_one(metric("rag_refusal", 2, 3), existing=existing)
    assert result.result is Result.FAILED


def test_eval_ac44_exactly_the_threshold_passes():
    result, _ = evaluate_one(metric("rag_refusal", 4, 5), existing=[entry("rag_refusal", "80")])
    assert result.result is Result.PASSED


def test_eval_ac45_another_model_adds_entries_and_leaves_the_old_ones():
    existing = [entry("rag_refusal", "80")]
    result, updated = evaluate_one(
        metric("rag_refusal", 5, 5), existing=existing, model="llama3.1:8b"
    )
    assert result.result is Result.BASELINE_SET
    assert updated.entries[0] == existing[0]
    assert [(e.model, e.metric) for e in updated.entries] == [
        ("qwen3:8b", "rag_refusal"),
        ("llama3.1:8b", "rag_refusal"),
    ]


def test_eval_ac46_without_a_judge_no_judged_threshold_is_added():
    judged_metric = metric("rag_groundedness", 0, 4, judged=True)
    result, updated = evaluate_one(judged_metric, judged=False)
    assert result.result is Result.NOT_JUDGED
    assert updated.entries == ()
    plain, with_plain = evaluate_one(metric("rag_refusal", 1, 1), judged=False)
    assert plain.result is Result.BASELINE_SET
    assert len(with_plain.entries) == 1


def test_eval_ac47_a_missing_list_is_written_with_an_entry_per_measured_metric(tmp_path: Path):
    path = tmp_path / "reports" / "eval-thresholds.json"
    assert load_thresholds(path) == ThresholdList(())
    measured = [metric("rag_refusal", 4, 5), metric("rag_citation_accuracy", 0, 0)]
    results, updated = evaluate(measured, ThresholdList(()), "local", "m", True, True, RUN_INFO)
    assert [r.result for r in results] == [Result.BASELINE_SET, Result.NO_CASES]
    path.parent.mkdir()
    write_thresholds(path, updated)
    written = json.loads(path.read_text())
    assert [e["metric"] for e in written["entries"]] == ["rag_refusal"]
    assert written["entries"][0]["date"] == "30.10.2026"
    assert load_thresholds(path) == updated
    assert list(path.parent.iterdir()) == [path]


def test_eval_ac47_the_written_entry_has_every_field(tmp_path: Path):
    path = tmp_path / "list.json"
    write_thresholds(path, ThresholdList((entry("rag_refusal", "75"),)))
    assert json.loads(path.read_text()) == {
        "entries": [
            {
                "mode": "local",
                "model": "qwen3:8b",
                "metric": "rag_refusal",
                "threshold": "75",
                "baseline": "90",
                "date": "01.01.2026",
                "embeddingModel": "embed-0",
                "judgeModel": None,
            }
        ]
    }


def test_eval_ac51_a_run_with_failures_adds_no_threshold_and_reports_no_threshold():
    result, updated = evaluate_one(metric("rag_refusal", 5, 5), clean=False)
    assert result.result is Result.NO_THRESHOLD
    assert result.threshold is None
    assert updated.entries == ()


def test_eval_ac51_a_run_with_failures_still_compares_against_an_existing_threshold():
    result, _ = evaluate_one(
        metric("rag_refusal", 5, 5), existing=[entry("rag_refusal", "80")], clean=False
    )
    assert result.result is Result.PASSED


def test_eval_exit_status_is_0_only_for_a_clean_run_without_failed_or_no_cases_results():
    passed = MetricResult(metric("a", 1, 1), Decimal(0), Result.PASSED)
    baseline = replace(passed, result=Result.BASELINE_SET)
    not_judged = replace(passed, result=Result.NOT_JUDGED)
    failed = replace(passed, result=Result.FAILED)
    no_cases = replace(passed, result=Result.NO_CASES)
    assert exit_status([passed, baseline, not_judged], 0, 0) == 0
    assert exit_status([passed, failed], 0, 0) == 1
    assert exit_status([passed, no_cases], 0, 0) == 1
    assert exit_status([passed], 1, 0) == 1
    assert exit_status([passed], 0, 1) == 1


def test_eval_summary_counts_passed_and_baseline_set_out_of_measured_results():
    base = MetricResult(metric("a", 1, 1), Decimal(0), Result.PASSED)
    results = [
        base,
        replace(base, result=Result.BASELINE_SET),
        replace(base, result=Result.FAILED),
        replace(base, result=Result.NO_CASES),
        replace(base, result=Result.NOT_JUDGED),
        replace(base, result=Result.NO_THRESHOLD),
    ]
    assert summary_counts(results) == (2, 3)


VALID_ENTRY = {
    "mode": "local",
    "model": "qwen3:8b",
    "metric": "rag_refusal",
    "threshold": "75",
    "baseline": "87.5",
    "date": "01.01.2026",
    "embeddingModel": "embed-0",
    "judgeModel": None,
}


def write_raw(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "eval-thresholds.json"
    path.write_text(text)
    return path


def test_eval_ac63_a_valid_list_loads(tmp_path: Path):
    path = write_raw(tmp_path, json.dumps({"entries": [VALID_ENTRY]}))
    loaded = load_thresholds(path)
    assert loaded.entries == (
        ThresholdEntry(
            "local",
            "qwen3:8b",
            "rag_refusal",
            Decimal(75),
            Decimal("87.5"),
            "01.01.2026",
            "embed-0",
            None,
        ),
    )


@pytest.mark.parametrize(
    "text",
    [
        "{not json",
        "[]",
        json.dumps({"entries": "x"}),
        json.dumps({}),
        json.dumps({"entries": [{**VALID_ENTRY, "metric": "rag_made_up"}]}),
        json.dumps({"entries": [VALID_ENTRY, VALID_ENTRY]}),
        json.dumps({"entries": [{**VALID_ENTRY, "threshold": "101"}]}),
        json.dumps({"entries": [{**VALID_ENTRY, "threshold": "-1"}]}),
        json.dumps({"entries": [{**VALID_ENTRY, "threshold": "abc"}]}),
        json.dumps({"entries": [{**VALID_ENTRY, "threshold": True}]}),
        json.dumps({"entries": [{**VALID_ENTRY, "baseline": None}]}),
        json.dumps({"entries": [{k: v for k, v in VALID_ENTRY.items() if k != "date"}]}),
        json.dumps({"entries": [{**VALID_ENTRY, "judgeModel": 3}]}),
        json.dumps({"entries": [{**VALID_ENTRY, "model": ""}]}),
        json.dumps({"entries": [VALID_ENTRY, 5]}),
    ],
)
def test_eval_ac63_an_invalid_list_raises_start_failed_naming_the_path(tmp_path: Path, text: str):
    path = write_raw(tmp_path, text)
    with pytest.raises(StartFailed, match=str(path)):
        load_thresholds(path)


def test_eval_ac63_an_unreadable_list_raises_start_failed_naming_the_path(tmp_path: Path):
    with pytest.raises(StartFailed, match=str(tmp_path)):
        load_thresholds(tmp_path)
