import json
import logging
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ai_service.inference import JsonCompletion, ModelUnavailable
from ai_service.sections import PdfSkipped, read_pdf_pages

LOGGER = logging.getLogger("ai_service.extraction")
MAX_FILE_BYTES = 10_485_760
MAX_PAGES = 10
MAX_CHARACTERS = 30_000
MIN_QUOTE_CHARACTERS = 15
CHARACTERS_PER_TOKEN = 4
SOFT_HYPHEN = "­"
FIELD_KEYS = ("parties", "term", "noticePeriod", "value", "renewal")

SYSTEM_PROMPT = (
    "Du extrahierst Vertragsdaten. Antworte nur mit JSON nach Schema. Für jedes Feld: "
    "value = kurzer Wert auf Deutsch, quote = wörtliches Zitat (ein Satz) aus dem "
    "Dokument, das den Wert belegt. Nennt das Dokument das Feld nicht, setze value und "
    "quote auf null. Leite nichts ab: steht keine ausdrückliche Regel im Text, ist das "
    "Feld null. "
    "Felder: parties (Vertragsparteien), term (Laufzeit), noticePeriod (Kündigungsfrist), "
    "value (Vertragswert), renewal (Verlängerung)."
)

NULLABLE_TEXT = {"type": ["string", "null"]}
FIELD_SCHEMA = {
    "type": "object",
    "properties": {"value": NULLABLE_TEXT, "quote": NULLABLE_TEXT},
    "required": ["value", "quote"],
}
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {key: FIELD_SCHEMA for key in FIELD_KEYS},
    "required": list(FIELD_KEYS),
}

RefusalReason = Literal[
    "no_text_layer", "too_many_pages", "too_large", "too_much_text", "unreadable"
]


class WireModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    def to_wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class ExtractedField(WireModel):
    key: str
    value: str | None
    quote: str | None
    pdf_page: int | None


class Extracted(WireModel):
    outcome: Literal["extracted"] = "extracted"
    fields: list[ExtractedField]


class Refused(WireModel):
    outcome: Literal["refused"] = "refused"
    reason: RefusalReason
    page_count: int | None = None
    file_size: int | None = None
    character_count: int | None = None


class Failed(WireModel):
    outcome: Literal["failed"] = "failed"
    reason: Literal["model_unavailable"] = "model_unavailable"


ExtractionResult = Extracted | Refused | Failed


class JsonModel(Protocol):
    model: str

    def complete_json(
        self, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> JsonCompletion: ...


class ModelAnswerInvalid(Exception):
    pass


@dataclass
class ExtractionRun:
    page_count: int | None = None
    found: int = 0
    outcome: str = ""


def normalise(text: str) -> str:
    without_hyphens = unicodedata.normalize("NFC", text).replace(SOFT_HYPHEN, "")
    return " ".join(without_hyphens.split())


def text_or_none(entry: dict[str, Any], name: str) -> str | None:
    value = entry.get(name)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ModelAnswerInvalid(name)
    return value


def parse_answer(text: str) -> dict[str, tuple[str | None, str | None]]:
    try:
        body = json.loads(text)
    except ValueError as error:
        raise ModelAnswerInvalid("not json") from error
    if not isinstance(body, dict):
        raise ModelAnswerInvalid("not an object")
    answers: dict[str, tuple[str | None, str | None]] = {}
    for key in FIELD_KEYS:
        entry = body.get(key)
        if isinstance(entry, dict):
            answers[key] = (text_or_none(entry, "value"), text_or_none(entry, "quote"))
        else:
            answers[key] = (None, None)
    return answers


def first_page_with(quote: str, pages: list[str]) -> int | None:
    needle = normalise(quote)
    if len(needle) < MIN_QUOTE_CHARACTERS:
        return None
    for number, page in enumerate(pages, start=1):
        if needle in page:
            return number
    return None


def not_found(key: str) -> ExtractedField:
    return ExtractedField(key=key, value=None, quote=None, pdf_page=None)


def build_field(key: str, value: str | None, quote: str | None, pages: list[str]) -> ExtractedField:
    if value is None or quote is None or not value.strip() or not quote.strip():
        return not_found(key)
    page = first_page_with(quote, pages)
    if page is None:
        return not_found(key)
    return ExtractedField(key=key, value=value.strip(), quote=quote.strip(), pdf_page=page)


def build_fields(
    answers: dict[str, tuple[str | None, str | None]], pages: list[str]
) -> list[ExtractedField]:
    return [build_field(key, *answers[key], pages) for key in FIELD_KEYS]


def build_messages(pages: list[str]) -> list[dict[str, str]]:
    document = "\n\n".join(f"=== Seite {n} ===\n{text}" for n, text in enumerate(pages, start=1))
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": document},
    ]


class ExtractionPipeline:
    def __init__(
        self,
        fetch_attachment: Callable[[str], bytes],
        model: JsonModel,
        mode: str,
        model_name: str,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._fetch_attachment = fetch_attachment
        self._model = model
        self._mode = mode
        self._model_name = model_name
        self._clock = clock

    def extract(self, attachment_id: str, file_size: int) -> ExtractionResult:
        started_at = self._clock()
        run = ExtractionRun()
        try:
            return self._extract(attachment_id, file_size, run)
        finally:
            self._log(attachment_id, run, self._clock() - started_at)

    def _extract(self, attachment_id: str, file_size: int, run: ExtractionRun) -> ExtractionResult:
        if file_size > MAX_FILE_BYTES:
            run.outcome = "too_large"
            return Refused(reason="too_large", file_size=file_size)
        try:
            raw_pages = read_pdf_pages(self._fetch_attachment(attachment_id))
        except PdfSkipped as skipped:
            if skipped.page_count is not None:
                run.page_count = skipped.page_count
                run.outcome = "too_many_pages"
                return Refused(reason="too_many_pages", page_count=skipped.page_count)
            run.outcome = "unreadable"
            return Refused(reason="unreadable")
        page_count = run.page_count = len(raw_pages)
        if page_count > MAX_PAGES:
            run.outcome = "too_many_pages"
            return Refused(reason="too_many_pages", page_count=page_count)
        pages = [normalise(text) for text in raw_pages]
        character_count = sum(len(text) for text in pages)
        if character_count == 0:
            run.outcome = "no_text_layer"
            return Refused(reason="no_text_layer", page_count=page_count)
        if character_count > MAX_CHARACTERS:
            run.outcome = "too_much_text"
            return Refused(
                reason="too_much_text", page_count=page_count, character_count=character_count
            )
        return self._ask_model(pages, run)

    def _ask_model(self, pages: list[str], run: ExtractionRun) -> ExtractionResult:
        messages = build_messages(pages)
        try:
            completion = self._model.complete_json(messages, ANSWER_SCHEMA)
        except ModelUnavailable:
            run.outcome = "model_failed"
            return Failed()
        sent = sum(len(message["content"]) for message in messages)
        tokens = completion.prompt_tokens
        if tokens is not None and tokens * CHARACTERS_PER_TOKEN < sent:
            run.outcome = "context_too_small"
            return Failed()
        try:
            fields = build_fields(parse_answer(completion.text), pages)
        except ModelAnswerInvalid:
            run.outcome = "model_failed"
            return Failed()
        run.outcome = "extracted"
        run.found = sum(1 for item in fields if item.pdf_page is not None)
        return Extracted(fields=fields)

    def _log(self, attachment_id: str, run: ExtractionRun, seconds: float) -> None:
        LOGGER.info(
            "extract attachment=%s mode=%s model=%s pages=%s duration_ms=%d found=%d outcome=%s",
            attachment_id,
            self._mode,
            self._model_name,
            "none" if run.page_count is None else run.page_count,
            round(seconds * 1000),
            run.found,
            run.outcome,
        )
