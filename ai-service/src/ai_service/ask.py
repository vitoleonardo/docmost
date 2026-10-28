import logging
import time
from collections.abc import Callable, Generator, Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from ai_service.bridge_client import BridgeError
from ai_service.citations import CitationFilter
from ai_service.conversations import ConversationStore, Turn
from ai_service.index_store import SearchHit
from ai_service.inference import ChatModel, ModelUnavailable
from ai_service.prompt import MAX_HISTORY_TURNS, build_messages

SEARCH_LIMIT = 20
MAX_SOURCES = 8
LOGGER = logging.getLogger("ai_service.ask")

Event = dict[str, Any]
SearchSections = Callable[[str, Sequence[str], str | None, int], list[SearchHit]]
FilterPages = Callable[[Sequence[str], str], list[str]]


class Outcome(StrEnum):
    ANSWERED = "answered"
    NO_SOURCE = "no_source"
    STOPPED = "stopped"
    MODEL_FAILED = "model_failed"
    FILTER_FAILED = "filter_failed"


@dataclass(frozen=True)
class AskRequest:
    question: str
    conversation_id: str
    space_id: str | None = None
    page_id: str | None = None


@dataclass
class AskRun:
    conversation_id: str
    started_at: float
    candidates: int = 0
    passing: int = 0
    first_text_at: float | None = None
    outcome: Outcome | None = None


def no_source() -> Event:
    return {"type": "no_source"}


def model_unavailable() -> Event:
    return {"type": "error", "code": "model_unavailable"}


def scope_space_ids(token_space_ids: Sequence[str], space_id: str | None) -> list[str]:
    if space_id is None:
        return list(token_space_ids)
    return [space_id] if space_id in token_space_ids else []


def search_text(history: Sequence[Turn], question: str) -> str:
    if not history:
        return question
    return f"{history[-1].question}\n{question}"


def unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(values))


def in_scope(hit: SearchHit, space_ids: Sequence[str], page_id: str | None) -> bool:
    return hit.space_id in space_ids and (page_id is None or hit.page_id == page_id)


def visible_history(turns: Sequence[Turn], passing: set[str]) -> list[tuple[str, str | None]]:
    return [
        (turn.question, turn.answer if set(turn.source_page_ids) <= passing else None)
        for turn in turns
    ]


def citation(number: int, hit: SearchHit) -> Event:
    return {
        "number": number,
        "pageId": hit.page_id,
        "headingPath": list(hit.heading_path),
        "attachmentId": hit.attachment_id,
        "fileName": hit.file_name,
        "pdfPage": hit.pdf_page,
    }


class AskPipeline:
    def __init__(
        self,
        search: SearchSections,
        filter_pages: FilterPages,
        model: ChatModel,
        conversations: ConversationStore,
        threshold: float,
        inference_mode: str,
        clock: Callable[[], float] = time.monotonic,
        logger: logging.Logger = LOGGER,
    ) -> None:
        self._search = search
        self._filter_pages = filter_pages
        self._model = model
        self._conversations = conversations
        self._threshold = threshold
        self._inference_mode = inference_mode
        self._clock = clock
        self._logger = logger

    def ask(
        self, request: AskRequest, user_id: str, space_ids: Sequence[str], user_token: str
    ) -> Generator[Event]:
        run = AskRun(request.conversation_id, self._clock())
        try:
            yield from self._answer(run, request, user_id, space_ids, user_token)
        finally:
            if run.outcome is not None:
                self._log(run)

    def _answer(
        self,
        run: AskRun,
        request: AskRequest,
        user_id: str,
        token_space_ids: Sequence[str],
        user_token: str,
    ) -> Generator[Event]:
        space_ids = scope_space_ids(token_space_ids, request.space_id)
        if not space_ids:
            run.outcome = Outcome.NO_SOURCE
            yield no_source()
            return
        history = self._conversations.load(user_id, request.conversation_id)[-MAX_HISTORY_TURNS:]
        candidates = self._search(
            search_text(history, request.question), space_ids, request.page_id, SEARCH_LIMIT
        )
        run.candidates = len(candidates)
        relevant = [
            hit
            for hit in candidates
            if in_scope(hit, space_ids, request.page_id) and hit.score >= self._threshold
        ]
        if not relevant:
            run.outcome = Outcome.NO_SOURCE
            yield no_source()
            return
        page_ids = unique(
            [hit.page_id for hit in relevant]
            + [page for turn in history for page in turn.source_page_ids]
        )
        try:
            passing = set(self._filter_pages(page_ids, user_token))
        except BridgeError:
            run.outcome = Outcome.FILTER_FAILED
            yield model_unavailable()
            return
        sources = sorted(
            (hit for hit in relevant if hit.page_id in passing),
            key=lambda hit: hit.score,
            reverse=True,
        )
        run.passing = len(sources)
        if not sources:
            run.outcome = Outcome.NO_SOURCE
            yield no_source()
            return
        yield from self._generate(
            run, request, user_id, sources[:MAX_SOURCES], visible_history(history, passing)
        )

    def _generate(
        self,
        run: AskRun,
        request: AskRequest,
        user_id: str,
        sources: Sequence[SearchHit],
        history: Sequence[tuple[str, str | None]],
    ) -> Generator[Event]:
        citations = CitationFilter(len(sources))
        shown: list[str] = []
        stream = self._model.stream(build_messages(request.question, sources, history))
        try:
            for delta in stream:
                text = citations.feed(delta)
                if text:
                    yield self._shown(run, shown, text)
            tail = citations.finish()
            if tail:
                yield self._shown(run, shown, tail)
        except ModelUnavailable:
            run.outcome = Outcome.MODEL_FAILED
            yield model_unavailable()
            return
        except GeneratorExit:
            run.outcome = Outcome.STOPPED
            raise
        finally:
            stream.close()
        cited = citations.cited()
        if not cited:
            run.outcome = Outcome.NO_SOURCE
            yield no_source()
            return
        turn = Turn(request.question, "".join(shown), unique(hit.page_id for hit in sources))
        self._conversations.append(user_id, request.conversation_id, turn)
        run.outcome = Outcome.ANSWERED
        yield {
            "type": "citations",
            "citations": [
                citation(number, sources[model_number - 1])
                for number, model_number in enumerate(cited, start=1)
            ],
        }

    def _shown(self, run: AskRun, shown: list[str], text: str) -> Event:
        if run.first_text_at is None:
            run.first_text_at = self._clock()
        shown.append(text)
        return {"type": "delta", "text": text}

    def _log(self, run: AskRun) -> None:
        first_text_ms = (
            "none"
            if run.first_text_at is None
            else str(round((run.first_text_at - run.started_at) * 1000))
        )
        self._logger.info(
            "ask conversation=%s mode=%s model=%s candidates=%d passing=%d"
            " first_text_ms=%s outcome=%s",
            run.conversation_id,
            self._inference_mode,
            self._model.model,
            run.candidates,
            run.passing,
            first_text_ms,
            run.outcome,
        )
