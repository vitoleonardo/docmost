import json
import logging
import unicodedata
from dataclasses import dataclass, field
from typing import Any

import pytest

from ai_service import extraction
from ai_service.bridge_client import BridgeUnavailable
from ai_service.extraction import ExtractionPipeline
from ai_service.inference import JsonCompletion, ModelUnavailable
from tests.conftest import FakeClock
from tests.pdf_fixtures import build_blank_pdf, build_pdf

ATTACHMENT_ID = "6f1b6a52-0c0e-4f55-9c4a-0d2f0f6f2a11"
KEYS = ["parties", "term", "noticePeriod", "value", "renewal"]
LOGGER_NAME = "ai_service.extraction"
PLAIN_QUOTE = "Die Laufzeit betraegt zwei Jahre."


def answer(**fields: object) -> str:
    body: dict[str, object] = {key: {"value": None, "quote": None} for key in KEYS}
    body.update(fields)
    return json.dumps(body)


def field_answer(value: object, quote: object) -> dict[str, object]:
    return {"value": value, "quote": quote}


@dataclass
class StubModel:
    text: str = field(default_factory=answer)
    prompt_tokens: int | None = 10_000
    error: ModelUnavailable | None = None
    calls: list[tuple[list[dict[str, str]], dict[str, Any]]] = field(default_factory=list)
    model: str = "qwen3:8b"

    def complete_json(
        self, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> JsonCompletion:
        self.calls.append((messages, schema))
        if self.error is not None:
            raise self.error
        return JsonCompletion(self.text, self.prompt_tokens, None)


class Fetcher:
    def __init__(self, content: bytes):
        self.content = content
        self.requested: list[str] = []

    def __call__(self, attachment_id: str) -> bytes:
        self.requested.append(attachment_id)
        return self.content


def pipeline(
    content: bytes, model: StubModel, clock: FakeClock | None = None
) -> tuple[ExtractionPipeline, Fetcher]:
    fetcher = Fetcher(content)
    built = ExtractionPipeline(fetcher, model, "local", "qwen3:8b", clock or FakeClock())
    return built, fetcher


def run(pages: list[str], model: StubModel, file_size: int = 1000):
    built, _ = pipeline(build_pdf(pages), model)
    return built.extract(ATTACHMENT_ID, file_size).to_wire()


def by_key(wire: dict) -> dict[str, dict]:
    return {item["key"]: item for item in wire["fields"]}


def log_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.name == LOGGER_NAME]


def test_extract_ac11_page_number_comes_from_where_the_quote_is_found() -> None:
    model = StubModel(answer(term={"value": "2 Jahre", "quote": PLAIN_QUOTE, "page": 1}))
    wire = run(["Deckblatt mit Titel", PLAIN_QUOTE], model)
    assert wire["outcome"] == "extracted"
    assert [item["key"] for item in wire["fields"]] == KEYS
    assert by_key(wire)["term"] == {
        "key": "term",
        "value": "2 Jahre",
        "quote": PLAIN_QUOTE,
        "pdfPage": 2,
    }


def test_extract_ac12_quote_on_two_pages_gets_the_first_page() -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", PLAIN_QUOTE)))
    wire = run([f"A {PLAIN_QUOTE}", f"B {PLAIN_QUOTE}"], model)
    assert by_key(wire)["term"]["pdfPage"] == 1


def test_extract_ac13_line_break_in_the_pdf_matches_a_space_in_the_quote() -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", "Die Laufzeit betraegt zwei Jahre.")))
    wire = run(["Die Laufzeit betraegt\nzwei Jahre."], model)
    assert by_key(wire)["term"]["pdfPage"] == 1
    assert by_key(wire)["term"]["quote"] == "Die Laufzeit betraegt zwei Jahre."


def test_extract_ac14_quote_found_nowhere_drops_the_value() -> None:
    model = StubModel(answer(renewal=field_answer("nicht vorgesehen", "Eine ganz andere Klausel.")))
    wire = run([PLAIN_QUOTE], model)
    assert by_key(wire)["renewal"] == {
        "key": "renewal",
        "value": None,
        "quote": None,
        "pdfPage": None,
    }


@pytest.mark.parametrize("quote", ["", "   ", None])
def test_extract_ac15_empty_or_missing_quote_is_not_found(quote: str | None) -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", quote)))
    wire = run([PLAIN_QUOTE], model)
    assert by_key(wire)["term"]["value"] is None
    assert by_key(wire)["term"]["pdfPage"] is None


def test_extract_ac15_absent_quote_key_is_not_found() -> None:
    model = StubModel(answer(term={"value": "2 Jahre"}))
    wire = run([PLAIN_QUOTE], model)
    assert by_key(wire)["term"]["value"] is None


@pytest.mark.parametrize("value", ["", "  ", None])
def test_extract_ac16_empty_or_missing_value_is_not_found(value: str | None) -> None:
    model = StubModel(answer(term=field_answer(value, PLAIN_QUOTE)))
    wire = run([PLAIN_QUOTE], model)
    assert by_key(wire)["term"] == {
        "key": "term",
        "value": None,
        "quote": None,
        "pdfPage": None,
    }


def test_extract_ac17_quote_of_14_characters_is_not_found_and_15_is_found() -> None:
    text = "123456789012345 und mehr"
    short = text[:14]
    long = text[:15]
    model = StubModel(answer(term=field_answer("a", short), parties=field_answer("b", long)))
    wire = run([text], model)
    assert by_key(wire)["term"]["pdfPage"] is None
    assert by_key(wire)["parties"]["pdfPage"] == 1


def test_extract_ac17_length_counts_after_whitespace_normalisation() -> None:
    model = StubModel(answer(term=field_answer("a", "12345   6789 01234")))
    wire = run(["12345 6789 01234"], model)
    assert by_key(wire)["term"]["pdfPage"] == 1


def test_extract_ac32_pdf_without_text_is_refused_and_the_model_is_not_called() -> None:
    model = StubModel()
    built, _ = pipeline(build_blank_pdf(2), model)
    wire = built.extract(ATTACHMENT_ID, 1000).to_wire()
    assert wire["outcome"] == "refused"
    assert wire["reason"] == "no_text_layer"
    assert model.calls == []


def test_extract_ac32_pages_of_whitespace_only_count_as_no_text() -> None:
    model = StubModel()
    wire = run(["   ", " "], model)
    assert wire["reason"] == "no_text_layer"
    assert model.calls == []


def test_extract_ac33_eleven_pages_are_refused_with_the_count() -> None:
    model = StubModel()
    wire = run([f"Seite {n} mit Text" for n in range(11)], model)
    assert wire == {
        "outcome": "refused",
        "reason": "too_many_pages",
        "pageCount": 11,
        "fileSize": None,
        "characterCount": None,
    }
    assert model.calls == []


def test_extract_ac34_ten_pages_are_extracted() -> None:
    model = StubModel()
    wire = run([f"Seite {n} mit Text" for n in range(10)], model)
    assert wire["outcome"] == "extracted"
    assert len(model.calls) == 1


@pytest.mark.parametrize("size", [12_163_481, 10_485_761])
def test_extract_ac35_ac65_oversize_file_is_refused_before_the_file_is_requested(
    size: int,
) -> None:
    model = StubModel()
    built, fetcher = pipeline(build_pdf([PLAIN_QUOTE]), model)
    wire = built.extract(ATTACHMENT_ID, size).to_wire()
    assert wire == {
        "outcome": "refused",
        "reason": "too_large",
        "pageCount": None,
        "fileSize": size,
        "characterCount": None,
    }
    assert fetcher.requested == []
    assert model.calls == []


def test_extract_ac36_file_of_exactly_10_mb_is_fetched() -> None:
    model = StubModel()
    built, fetcher = pipeline(build_pdf([PLAIN_QUOTE]), model)
    wire = built.extract(ATTACHMENT_ID, 10_485_760).to_wire()
    assert wire["outcome"] == "extracted"
    assert fetcher.requested == [ATTACHMENT_ID]


def test_extract_ac37_bytes_that_are_no_pdf_are_unreadable() -> None:
    model = StubModel()
    built, fetcher = pipeline(b"this is not a pdf", model)
    wire = built.extract(ATTACHMENT_ID, 17).to_wire()
    assert wire == {
        "outcome": "refused",
        "reason": "unreadable",
        "pageCount": None,
        "fileSize": None,
        "characterCount": None,
    }
    assert fetcher.requested == [ATTACHMENT_ID]
    assert model.calls == []


@pytest.mark.parametrize(
    "text",
    [
        "[1, 2]",
        "no json at all",
        '"text"',
        json.dumps({"term": {"value": 3, "quote": PLAIN_QUOTE}}),
        json.dumps({"term": {"value": "a", "quote": 3}}),
        json.dumps({"term": {"value": True, "quote": None}}),
    ],
)
def test_extract_ac40_answer_outside_the_schema_is_a_model_failure(text: str) -> None:
    wire = run([PLAIN_QUOTE], StubModel(text))
    assert wire == {"outcome": "failed", "reason": "model_unavailable"}


@pytest.mark.parametrize("entry", ["2 Jahre", ["a"], None])
def test_extract_ac40_field_that_is_present_but_not_an_object_is_a_model_failure(
    entry: object,
) -> None:
    wire = run([PLAIN_QUOTE], StubModel(json.dumps({"term": entry})))
    assert wire == {"outcome": "failed", "reason": "model_unavailable"}


def test_extract_ac53_a_bridge_error_propagates_without_an_extraction_log_line(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def failing_fetch(attachment_id: str) -> bytes:
        raise BridgeUnavailable("HTTP 500")

    built = ExtractionPipeline(failing_fetch, StubModel(), "local", "qwen3:8b", FakeClock())
    with caplog.at_level(logging.INFO, logger=LOGGER_NAME), pytest.raises(BridgeUnavailable):
        built.extract(ATTACHMENT_ID, 1000)
    assert log_lines(caplog) == []


def test_extract_ac53_an_unexpected_error_logs_its_class_without_content_and_propagates(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def crashing_fetch(attachment_id: str) -> bytes:
        raise RuntimeError(PLAIN_QUOTE)

    built = ExtractionPipeline(crashing_fetch, StubModel(), "local", "qwen3:8b", FakeClock())
    with caplog.at_level(logging.INFO, logger=LOGGER_NAME), pytest.raises(RuntimeError):
        built.extract(ATTACHMENT_ID, 1000)
    assert log_lines(caplog) == [f"extract attachment={ATTACHMENT_ID} error=RuntimeError"]
    assert [r.levelno for r in caplog.records if r.name == LOGGER_NAME] == [logging.WARNING]


def test_extract_ac38_model_unavailable_is_a_failed_result() -> None:
    model = StubModel(error=ModelUnavailable("timeout"))
    wire = run([PLAIN_QUOTE], model)
    assert wire == {"outcome": "failed", "reason": "model_unavailable"}


def test_extract_ac59_extra_keys_are_ignored() -> None:
    model = StubModel(
        answer(
            extra=field_answer("x", PLAIN_QUOTE),
            term={"value": "2 Jahre", "quote": PLAIN_QUOTE, "confidence": 1},
        )
    )
    wire = run([PLAIN_QUOTE], model)
    assert [item["key"] for item in wire["fields"]] == KEYS
    assert set(by_key(wire)["term"]) == {"key", "value", "quote", "pdfPage"}


def test_extract_ac62_missing_field_is_not_found() -> None:
    body = json.loads(answer(term=field_answer("2 Jahre", PLAIN_QUOTE)))
    del body["renewal"]
    wire = run([PLAIN_QUOTE], StubModel(json.dumps(body)))
    assert wire["outcome"] == "extracted"
    assert by_key(wire)["renewal"]["value"] is None
    assert by_key(wire)["term"]["pdfPage"] == 1


def test_extract_ac63_nfd_quote_matches_nfc_page(monkeypatch: pytest.MonkeyPatch) -> None:
    page = unicodedata.normalize("NFC", "Die Kündigungsfrist beträgt drei Monate.")
    quote = unicodedata.normalize("NFD", page)
    assert quote != page
    monkeypatch.setattr(extraction, "read_pdf_pages", lambda _content: [page])
    model = StubModel(answer(noticePeriod=field_answer("3 Monate", quote)))
    built, _ = pipeline(b"unused", model)
    wire = built.extract(ATTACHMENT_ID, 10).to_wire()
    assert by_key(wire)["noticePeriod"]["pdfPage"] == 1


def test_extract_ac63_soft_hyphens_are_removed_before_matching(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    page = "Die Kündi­gungsfrist beträgt drei Monate."
    monkeypatch.setattr(extraction, "read_pdf_pages", lambda _content: [page])
    model = StubModel(
        answer(noticePeriod=field_answer("3 Monate", "Die Kündigungsfrist beträgt drei Monate."))
    )
    built, _ = pipeline(b"unused", model)
    assert by_key(built.extract(ATTACHMENT_ID, 10).to_wire())["noticePeriod"]["pdfPage"] == 1


def test_extract_ac64_30001_characters_are_refused_and_30000_are_extracted() -> None:
    model = StubModel()
    refused = run(["x" * 30_001], model)
    assert refused == {
        "outcome": "refused",
        "reason": "too_much_text",
        "pageCount": 1,
        "fileSize": None,
        "characterCount": 30_001,
    }
    assert model.calls == []
    accepted = run(["x" * 15_000, "y" * 15_000], model)
    assert accepted["outcome"] == "extracted"
    assert len(model.calls) == 1


def test_extract_ac64_characters_are_counted_across_pages_after_normalisation() -> None:
    model = StubModel()
    wire = run(["a   b " + "x" * 14_998, "y" * 15_000], model)
    assert wire["outcome"] == "refused"
    assert wire["characterCount"] == 30_002


def test_extract_ac66_prompt_tokens_below_a_quarter_of_the_characters_fail() -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", PLAIN_QUOTE)), prompt_tokens=2050)
    page = "Text " * 2850
    built, _ = pipeline(build_pdf([PLAIN_QUOTE + " " + page]), model)
    wire = built.extract(ATTACHMENT_ID, 1000).to_wire()
    sent = sum(len(message["content"]) for message in model.calls[0][0])
    assert sent >= 14_654
    assert wire == {"outcome": "failed", "reason": "model_unavailable"}


def test_extract_ac66_prompt_tokens_at_a_quarter_of_the_characters_pass() -> None:
    probe = StubModel()
    run([PLAIN_QUOTE], probe)
    sent = sum(len(message["content"]) for message in probe.calls[0][0])
    assert run([PLAIN_QUOTE], StubModel(prompt_tokens=(sent + 3) // 4))["outcome"] == "extracted"
    assert run([PLAIN_QUOTE], StubModel(prompt_tokens=None))["outcome"] == "extracted"


def test_extract_ac58_text_only_on_page_one_gives_no_field_on_page_two() -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", PLAIN_QUOTE)))
    wire = run([PLAIN_QUOTE, ""], model)
    assert wire["outcome"] == "extracted"
    assert [item["pdfPage"] for item in wire["fields"] if item["pdfPage"]] == [1]


def test_extract_prompt_sends_german_instructions_pages_and_the_five_field_schema() -> None:
    model = StubModel()
    run(["Erste Seite Text", "Zweite Seite Text"], model)
    messages, schema = model.calls[0]
    assert [m["role"] for m in messages] == ["system", "user"]
    assert "ausdrückliche Regel" in messages[0]["content"]
    assert "wörtlich" in messages[0]["content"]
    assert messages[1]["content"] == (
        "=== Seite 1 ===\nErste Seite Text\n\n=== Seite 2 ===\nZweite Seite Text"
    )
    assert list(schema["properties"]) == KEYS
    assert schema["required"] == KEYS
    assert schema["properties"]["term"]["properties"]["quote"]["type"] == ["string", "null"]


def test_extract_wire_shape_of_an_extracted_result_uses_camel_case_keys() -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", PLAIN_QUOTE)))
    built, _ = pipeline(build_pdf([PLAIN_QUOTE]), model)
    result = built.extract(ATTACHMENT_ID, 1000)
    assert result.to_wire() == json.loads(result.model_dump_json(by_alias=True))
    assert result.to_wire()["fields"][1]["pdfPage"] == 1


def logged(caplog: pytest.LogCaptureFixture, content: bytes, model: StubModel, size: int) -> str:
    clock = FakeClock()

    class SlowModel(StubModel):
        def complete_json(
            self, messages: list[dict[str, str]], schema: dict[str, Any]
        ) -> JsonCompletion:
            clock.now += 2.5
            return super().complete_json(messages, schema)

    slow = SlowModel(model.text, model.prompt_tokens, model.error)
    fetcher = Fetcher(content)
    built = ExtractionPipeline(fetcher, slow, "local", "qwen3:8b", clock)
    with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
        built.extract(ATTACHMENT_ID, size)
    lines = log_lines(caplog)
    assert len(lines) == 1
    return lines[0]


def test_extract_ac53_one_log_line_for_an_extracted_result(
    caplog: pytest.LogCaptureFixture,
) -> None:
    model = StubModel(answer(term=field_answer("2 Jahre", PLAIN_QUOTE)))
    line = logged(caplog, build_pdf(["Seite", PLAIN_QUOTE]), model, 1000)
    assert line == (
        f"extract attachment={ATTACHMENT_ID} mode=local model=qwen3:8b pages=2"
        " duration_ms=2500 found=1 outcome=extracted"
    )


@pytest.mark.parametrize(
    ("content", "size", "model", "pages", "outcome"),
    [
        (build_blank_pdf(1), 1000, StubModel(), "1", "no_text_layer"),
        (build_pdf(["a"] * 11), 1000, StubModel(), "11", "too_many_pages"),
        (build_pdf(["a"]), 10_485_761, StubModel(), "none", "too_large"),
        (build_pdf(["x" * 30_001]), 1000, StubModel(), "1", "too_much_text"),
        (b"garbage", 7, StubModel(), "none", "unreadable"),
        (build_pdf([PLAIN_QUOTE]), 1000, StubModel("[]"), "1", "model_failed"),
        (
            build_pdf([PLAIN_QUOTE]),
            1000,
            StubModel(error=ModelUnavailable("down")),
            "1",
            "model_failed",
        ),
        (
            build_pdf([PLAIN_QUOTE]),
            1000,
            StubModel(prompt_tokens=1),
            "1",
            "context_too_small",
        ),
    ],
)
def test_extract_ac53_one_log_line_per_outcome(
    caplog: pytest.LogCaptureFixture,
    content: bytes,
    size: int,
    model: StubModel,
    pages: str,
    outcome: str,
) -> None:
    line = logged(caplog, content, model, size)
    assert f"attachment={ATTACHMENT_ID} mode=local model=qwen3:8b pages={pages} " in line
    assert " found=0 " in line
    assert line.endswith(f"outcome={outcome}")
    assert "duration_ms=" in line


def test_extract_ac54_log_lines_hold_no_pdf_text_value_or_quote(
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret_value = "Geheimwert 4711"
    model = StubModel(answer(term=field_answer(secret_value, PLAIN_QUOTE)))
    with caplog.at_level(logging.DEBUG):
        built, _ = pipeline(build_pdf([PLAIN_QUOTE + " Vertraulicher Rest"]), model)
        built.extract(ATTACHMENT_ID, 1000)
        failing, _ = pipeline(
            build_pdf([PLAIN_QUOTE]), StubModel(error=ModelUnavailable(PLAIN_QUOTE))
        )
        failing.extract(ATTACHMENT_ID, 1000)
    text = caplog.text
    for forbidden in (PLAIN_QUOTE, secret_value, "Vertraulicher", "Laufzeit"):
        assert forbidden not in text


def test_extract_ac33_pdf_beyond_the_indexing_page_limit_is_refused_with_its_count() -> None:
    model = StubModel()
    built, _ = pipeline(build_blank_pdf(301), model)
    wire = built.extract(ATTACHMENT_ID, 1000).to_wire()
    assert wire == {
        "outcome": "refused",
        "reason": "too_many_pages",
        "pageCount": 301,
        "fileSize": None,
        "characterCount": None,
    }
    assert model.calls == []
