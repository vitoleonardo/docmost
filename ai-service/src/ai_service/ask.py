import logging
import time
from collections.abc import Callable, Generator, Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import psycopg

from ai_service.bridge_client import BridgeError
from ai_service.citations import CitationFilter
from ai_service.conversations import ConversationStore, Turn
from ai_service.embedding import EmbeddingFailed
from ai_service.index_store import SearchHit
from ai_service.inference import ChatModel, ModelUnavailable, StreamUsage
from ai_service.prompt import MAX_HISTORY_TURNS, build_messages
from ai_service.request_log import RequestLog, TokenTally

SEARCH_LIMIT = 20
MAX_SOURCES = 8
SEARCH_ERRORS = (psycopg.Error, EmbeddingFailed)
LOGGER = logging.getLogger("ai_service.ask")

Event = dict[str, Any]
SearchSections = Callable[[str, Sequence[str], str | None, int], list[SearchHit]]
FilterPages = Callable[[Sequence[str], str, str | None], list[str]]


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
    tally: TokenTally = field(default_factory=TokenTally)


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
        request_log: RequestLog,
        clock: Callable[[], float] = time.monotonic,
        logger: logging.Logger = LOGGER,
    ) -> None:
        self._search = search
        self._filter_pages = filter_pages
        self._model = model
        self._conversations = conversations
        self._threshold = threshold
        self._inference_mode = inference_mode
        self._request_log = request_log
        self._clock = clock
        self._logger = logger

    def ask(
        self,
        request: AskRequest,
        user_id: str,
        workspace_id: str,
        space_ids: Sequence[str],
        user_token: str,
    ) -> Generator[Event]:
        timer = self._request_log.start("ask", user_id, workspace_id)
        run = AskRun(request.conversation_id, self._clock())
        try:
            yield from self._answer(run, request, user_id, space_ids, user_token)
        finally:
            if run.outcome is not None:
                self._log(run)
            self._request_log.finish(timer, run.outcome or "error", run.tally)

    def _answer(
        self,
        run: AskRun,
        request: AskRequest,
        user_id: str,
        token_space_ids: Sequence[str],
        user_token: str,
    ) -> Generator[Event]:
        self._conversations.touch(user_id, request.conversation_id)
        space_ids = scope_space_ids(token_space_ids, request.space_id)
        if not space_ids:
            run.outcome = Outcome.NO_SOURCE
            yield no_source()
            return
        history = self._conversations.load(user_id, request.conversation_id)[-MAX_HISTORY_TURNS:]
        try:
            candidates = self._search(
                search_text(history, request.question), space_ids, request.page_id, SEARCH_LIMIT
            )
        except SEARCH_ERRORS:
            run.outcome = Outcome.MODEL_FAILED
            yield model_unavailable()
            return
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
        candidate_page_ids = unique(hit.page_id for hit in relevant)
        history_page_ids = unique(page for turn in history for page in turn.source_page_ids)
        try:
            passing, history_passing = self._passing_pages(
                candidate_page_ids, history_page_ids, request.space_id, user_token
            )
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
            run, request, user_id, sources[:MAX_SOURCES], visible_history(history, history_passing)
        )

    def _passing_pages(
        self,
        candidate_page_ids: list[str],
        history_page_ids: list[str],
        space_id: str | None,
        user_token: str,
    ) -> tuple[set[str], set[str]]:
        if space_id is None:
            passing = set(
                self._filter_pages(unique(candidate_page_ids + history_page_ids), user_token, None)
            )
            return passing, passing
        in_scope_space = set(self._filter_pages(candidate_page_ids, user_token, space_id))
        viewable_history = set(self._filter_pages(history_page_ids, user_token, None))
        return in_scope_space, viewable_history

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
        usage = StreamUsage()
        stream = self._model.stream(build_messages(request.question, sources, history), usage)
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
            run.tally.add(usage.prompt_tokens, usage.completion_tokens)
        cited = citations.cited()
        if not cited:
            run.outcome = Outcome.NO_SOURCE
            yield no_source()
            return
        turn = Turn(request.question, "".join(shown), unique(hit.page_id for hit in sources))
        turn_id = self._conversations.append(user_id, request.conversation_id, turn)
        run.outcome = Outcome.ANSWERED
        yield {
            "type": "citations",
            "turnId": turn_id,
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
