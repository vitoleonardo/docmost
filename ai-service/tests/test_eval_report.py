from datetime import date
from decimal import Decimal

from ai_service.eval_metrics import (
    AgentCase,
    ExtractedValue,
    ExtractionCase,
    Metric,
    MetricResult,
    RagCase,
    Ratings,
    Result,
)
from ai_service.eval_report import EvalRun, render_report, summary_line
from ai_service.eval_sets import (
    AgentScenario,
    ContractTruth,
    FieldTruth,
    GoldenQuestion,
)

SEED_SENTENCE = "The judge received only fictional seed data over the Anthropic API."
FAKE_KEY = "sk-ant-test-key-0000"
INSTRUCTIONS = "Rate every statement.\nAnswer with a verdict."


def golden(id: str, user: str, *expected: str) -> GoldenQuestion:
    return GoldenQuestion(
        id, user, "Frage?", list(expected), expected[0] if expected else None, None, None
    )


def contract(pdf: str, text_layer: bool = True) -> ContractTruth:
    fields = {
        key: FieldTruth(value, f"Zeile {value}", 1)
        for key, value in [("a", "Alpha"), ("b", "Beta")]
    }
    return ContractTruth(pdf, text_layer, fields)


def result(name: str, passed: int, counted: int, outcome: Result, threshold: int | None):
    percentage = Decimal(passed) * 100 / counted if counted else None
    metric = Metric(name, passed, counted, name.startswith("rag_g"), percentage, ())
    return MetricResult(metric, None if threshold is None else Decimal(threshold), outcome)


RESULTS = [
    result("rag_citation_accuracy", 7, 8, Result.PASSED, 75),
    result("rag_refusal", 1, 2, Result.FAILED, 100),
    result("extraction_outcome", 3, 3, Result.BASELINE_SET, 90),
    result("agent_task_success", 1, 2, Result.NO_THRESHOLD, None),
    result("rag_groundedness", 0, 0, Result.NO_CASES, None),
    result("rag_answer_correctness", 0, 0, Result.NOT_JUDGED, None),
]

RAG = [
    RagCase(
        golden("q1", "GF", "Seite A"),
        "answered",
        "Text",
        ("Seite A", "Seite B"),
        12.34,
        None,
        Ratings(True, "supported", False, "wrong | value\nsecond line"),
        None,
    ),
    RagCase(golden("q2", "PL"), "no_source", "", (), 3.0, None, None, None),
    RagCase(golden("q3", "VT", "Seite C"), "failed", "", (), 300.0, "timeout", None, None),
    RagCase(
        golden("q4", "WS", "Seite D"),
        "answered",
        "Text",
        ("Seite D",),
        5.0,
        None,
        None,
        "RateLimitError",
    ),
]

EXTRACTION = [
    ExtractionCase(
        contract("a.pdf"),
        "extracted",
        None,
        {
            "a": ExtractedValue("Alpha", "Zeile Alpha", 1),
            "b": ExtractedValue("Falsch", "Zeile Falsch", 1),
        },
        20.26,
        None,
    ),
    ExtractionCase(contract("scan.pdf", False), "refused", "no_text_layer", {}, 0.5, None),
    ExtractionCase(contract("c.pdf"), "failed", None, {}, 210.0, "ReadTimeout"),
]

AGENT = [
    AgentCase(
        AgentScenario("s1", "GF", "Recht", "Aufgabe", ["finished"], ["Seite A", "Seite B"]),
        "finished",
        ("Seite A", "Seite B"),
        (),
        61.5,
        None,
    ),
    AgentCase(
        AgentScenario("s2", "PL", "Technik", "Aufgabe", ["finished"], []),
        "finished",
        (),
        ("Seite X", "Seite Y"),
        10.0,
        None,
    ),
    AgentCase(
        AgentScenario("s3", "VT", "Technik", "Aufgabe", ["finished"], []),
        None,
        (),
        (),
        900.0,
        "no_end",
    ),
]


def run(judge_model: str | None = "judge-1") -> EvalRun:
    return EvalRun(
        date(2026, 3, 5),
        "local",
        "qwen3:8b",
        "embed-1",
        "Apple M4",
        judge_model,
        INSTRUCTIONS if judge_model else None,
        RAG,
        EXTRACTION,
        AGENT,
        RESULTS,
    )


def row(report: str, start: str) -> str:
    return next(line for line in report.splitlines() if line.startswith(start))


def test_eval_ac48_header_holds_date_mode_models_and_processor() -> None:
    report = render_report(run())
    assert report.startswith("# Evals\n")
    for line in [
        "- Date: 05.03.2026",
        "- Inference mode: local",
        "- Model: qwen3:8b",
        "- Embedding model: embed-1",
        "- Processor: Apple M4",
    ]:
        assert line in report.splitlines()


def test_eval_ac48_judge_section_holds_model_date_instructions_and_sentence() -> None:
    report = render_report(run())
    lines = report.splitlines()
    assert "- Judge: judge-1" in lines
    assert "- Judge calls: 05.03.2026" in lines
    assert f"```\n{INSTRUCTIONS}\n```" in report
    assert SEED_SENTENCE in lines


def test_eval_ac48_metrics_table_holds_counts_percentages_thresholds_and_results() -> None:
    report = render_report(run())
    assert "| Metric | Passed | Percentage | Threshold | Result |" in report
    assert row(report, "| rag_citation_accuracy") == (
        "| rag_citation_accuracy | 7 of 8 | 87.5 % | 75 % | passed |"
    )
    assert row(report, "| rag_refusal") == "| rag_refusal | 1 of 2 | 50.0 % | 100 % | failed |"
    assert row(report, "| extraction_outcome") == (
        "| extraction_outcome | 3 of 3 | 100.0 % | 90 % | baseline set |"
    )
    assert row(report, "| agent_task_success") == (
        "| agent_task_success | 1 of 2 | 50.0 % | none | no threshold |"
    )
    assert row(report, "| rag_groundedness") == (
        "| rag_groundedness | 0 of 0 | - | none | no cases |"
    )
    assert row(report, "| rag_answer_correctness") == (
        "| rag_answer_correctness | 0 of 0 | - | none | not judged |"
    )


def test_eval_ac48_rag_table_has_one_row_per_question() -> None:
    report = render_report(run())
    assert "| Id | User | Outcome | Cited pages | Citation passed | Refusal passed |" in report
    assert row(report, "| q1 ") == (
        "| q1 | GF | answered | Seite A, Seite B | no | - | "
        "grounded: supported | incorrect: wrong \\| value second line | 12.3 |"
    )
    assert row(report, "| q2 ") == "| q2 | PL | no_source | - | - | yes | - | - | 3.0 |"
    assert row(report, "| q3 ") == "| q3 | VT | failed | - | no | - | - | - | 300.0 |"


def test_eval_ac48_extraction_table_has_field_results_and_scan_dashes() -> None:
    report = render_report(run())
    assert "| File | Outcome | Fields | Seconds |" in report
    assert row(report, "| a.pdf") == "| a.pdf | extracted | a: passed, b: wrong | 20.3 |"
    assert row(report, "| scan.pdf") == "| scan.pdf | no_text_layer | - | 0.5 |"
    assert row(report, "| c.pdf") == "| c.pdf | failed | a: flagged, b: flagged | 210.0 |"


def test_eval_ac48_agent_table_has_success_and_changed_pages() -> None:
    report = render_report(run())
    assert "| Id | User | Space | Outcome | Proposal pages | Task success |" in report
    assert row(report, "| s1 ") == (
        "| s1 | GF | Recht | finished | Seite A, Seite B | yes | - | 61.5 |"
    )
    assert (
        row(report, "| s2 ")
        == "| s2 | PL | Technik | finished | - | yes | Seite X, Seite Y | 10.0 |"
    )
    assert row(report, "| s3 ") == "| s3 | VT | Technik | - | - | no | - | 900.0 |"


def test_eval_ac48_failed_requests_and_judgements_list_ids_and_classes() -> None:
    report = render_report(run())
    lines = report.splitlines()
    assert "Failed requests: 3" in lines
    assert "Failed judgements: 1" in lines
    assert "- q3: timeout" in lines
    assert "- c.pdf: ReadTimeout" in lines
    assert "- s3: no_end" in lines
    assert "- q4: RateLimitError" in lines


def test_eval_ac48_no_failures_shows_zero_counts_without_lines() -> None:
    clean = EvalRun(date(2026, 3, 5), "local", "m", "e", "p", None, None, [], [], [], [])
    lines = render_report(clean).splitlines()
    assert "Failed requests: 0" in lines
    assert "Failed judgements: 0" in lines
    assert not any(line.startswith("- ") and ": " in line and "Failed" in line for line in lines)


def test_eval_ac20_no_judge_shows_not_run_and_no_sentence() -> None:
    report = render_report(run(None))
    assert "- Judge: not run" in report.splitlines()
    assert SEED_SENTENCE not in report
    assert "Judge calls" not in report
    assert "```" not in report
    assert "| rag_answer_correctness | 0 of 0 | - | none | not judged |" in report


def test_eval_ac49_summary_counts_only_passed_failed_and_baseline_set() -> None:
    results = [
        result("rag_citation_accuracy", 1, 1, Result.PASSED, 50),
        result("rag_refusal", 1, 1, Result.PASSED, 50),
        result("extraction_outcome", 1, 1, Result.PASSED, 50),
        result("extraction_field_accuracy", 1, 1, Result.PASSED, 50),
        result("extraction_no_wrong_value", 1, 1, Result.BASELINE_SET, 50),
        result("agent_task_success", 1, 1, Result.PASSED, 50),
        result("agent_no_unconfirmed_write", 0, 1, Result.FAILED, 100),
        result("rag_groundedness", 0, 0, Result.NO_CASES, None),
        result("rag_answer_correctness", 0, 0, Result.NOT_JUDGED, None),
    ]
    assert summary_line(results) == "Evals: 6 of 7 metrics passed"


def test_eval_ac49_summary_line_with_nothing_measured() -> None:
    assert summary_line([]) == "Evals: 0 of 0 metrics passed"


def test_eval_ac17_key_not_placed_in_the_run_never_appears() -> None:
    assert FAKE_KEY not in render_report(run())
    assert FAKE_KEY not in render_report(run(None))
