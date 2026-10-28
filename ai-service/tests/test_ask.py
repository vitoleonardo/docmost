import json
import logging
import re
from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from redis import Redis

from ai_service.ask import MAX_SOURCES, SEARCH_LIMIT, AskPipeline, AskRequest
from ai_service.bridge_client import (
    FILTER_PAGES_PATH,
    MAX_FILTER_PAGE_IDS,
    USER_TOKEN_HEADER,
    BridgeError,
    BridgeRefused,
    BridgeUnavailable,
)
from ai_service.conversations import (
    HISTORY_TTL_SECONDS,
    ConversationStore,
    Turn,
    conversation_key,
)
from ai_service.embedding import EmbeddingFailed
from ai_service.index_store import IndexStore, SearchHit, StoredSection
from ai_service.inference import ChatModel, ModelUnavailable
from ai_service.search import search_index
from tests.conftest import USER_ID, FakeClock
from tests.fake_bridge import FilterBridge, answer, mock_client, refuse, server_error
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import (
    SPACE_A,
    SPACE_B,
    SPACE_C,
    attachment_id,
    index_page,
    make_entry,
    page_id,
)
from tests.seed_matrix import SEED_USERS, SeedPage, load_seed_pages, member_space_ids

USER_TOKEN = "test-user-token-not-a-real-jwt"
OTHER_USER_ID = "0192f000-0000-7000-8000-0000000000b2"
CONVERSATION_ID = "0192f000-0000-7000-8000-0000000c0001"
THRESHOLD = 0.45
MODE = "local"
MODEL_NAME = "stub-model"
ASK_LOGGER = "ai_service.ask"
LOG_LINE = re.compile(
    r"^ask conversation=(?P<conversation>\S+) mode=(?P<mode>\S+) model=(?P<model>\S+)"
    r" candidates=(?P<candidates>\d+) passing=(?P<passing>\d+)"
    r" first_text_ms=(?P<first_text_ms>\d+|none) outcome=(?P<outcome>\S+)$"
)


def hit(
    number: int,
    space_id: str = SPACE_A,
    score: float = 0.8,
    text: str | None = None,
    heading_path: Sequence[str] = (),
    attachment: str | None = None,
    file_name: str | None = None,
    pdf_page: int | None = None,
) -> SearchHit:
    return SearchHit(
        page_id=page_id(number),
        title=f"Seite {number}",
        space_id=space_id,
        heading_path=list(heading_path),
        text=text if text is not None else f"Abschnittstext der Seite {number}.",
        score=score,
        attachment_id=attachment,
        file_name=file_name,
        pdf_page=pdf_page,
    )


@dataclass
class FakeSearch:
    hits: list[SearchHit] = field(default_factory=list)
    by_text: Callable[[str], list[SearchHit]] | None = None
    failure: Exception | None = None
    calls: list[tuple[str, list[str], str | None, int]] = field(default_factory=list)

    def __call__(
        self, text: str, space_ids: Sequence[str], page_id: str | None, limit: int
    ) -> list[SearchHit]:
        self.calls.append((text, list(space_ids), page_id, limit))
        if self.failure is not None:
            raise self.failure
        if self.by_text is not None:
            return self.by_text(text)
        return list(self.hits)


class StubModel(ChatModel):
    def __init__(
        self,
        deltas: Sequence[str] = ("Die Antwort steht in der Quelle [1].",),
        failure: Exception | None = None,
        clock: FakeClock | None = None,
        seconds_per_delta: float = 0.0,
    ) -> None:
        self.model = MODEL_NAME
        self.deltas = list(deltas)
        self.failure = failure
        self.clock = clock
        self.seconds_per_delta = seconds_per_delta
        self.calls: list[list[dict[str, str]]] = []
        self.yielded = 0
        self.closed = False
        self.streams: list[Generator[str]] = []

    def stream(self, messages: list[dict[str, str]]) -> Generator[str]:
        self.calls.append(messages)
        produced = self._produce()
        self.streams.append(produced)
        return produced

    def _produce(self) -> Generator[str]:
        try:
            for delta in self.deltas:
                if self.clock is not None:
                    self.clock.now += self.seconds_per_delta
                self.yielded += 1
                yield delta
            if self.failure is not None:
                raise self.failure
        finally:
            self.closed = True


@dataclass
class Harness:
    redis: Redis
    search: FakeSearch = field(default_factory=FakeSearch)
    bridge: FilterBridge = field(default_factory=FilterBridge)
    model: StubModel = field(default_factory=StubModel)
    clock: FakeClock = field(default_factory=FakeClock)

    @property
    def conversations(self) -> ConversationStore:
        return ConversationStore(self.redis)

    def pipeline(self) -> AskPipeline:
        return AskPipeline(
            search=self.search,
            filter_pages=self.bridge.client().filter_pages,
            model=self.model,
            conversations=self.conversations,
            threshold=THRESHOLD,
            inference_mode=MODE,
            clock=self.clock,
        )

    def events(
        self,
        question: str = "Wie lautet die Regel?",
        space_ids: Sequence[str] = (SPACE_A, SPACE_B),
        space_id: str | None = None,
        scope_page_id: str | None = None,
        user_id: str = USER_ID,
    ) -> Generator[dict[str, Any]]:
        request = AskRequest(
            question=question,
            conversation_id=CONVERSATION_ID,
            space_id=space_id,
            page_id=scope_page_id,
        )
        return self.pipeline().ask(request, user_id, list(space_ids), USER_TOKEN)

    def run(self, **arguments: Any) -> list[dict[str, Any]]:
        return list(self.events(**arguments))

    def prompt(self, call: int = -1) -> str:
        return "\n".join(message["content"] for message in self.model.calls[call])

    def stored(self, user_id: str = USER_ID) -> list[Turn]:
        return self.conversations.load(user_id, CONVERSATION_ID)


@pytest.fixture
def harness(redis_client: Redis) -> Harness:
    return Harness(redis=redis_client)


@pytest.fixture
def ask_log(caplog: pytest.LogCaptureFixture) -> pytest.LogCaptureFixture:
    caplog.set_level(logging.DEBUG)
    return caplog


def ask_lines(caplog: pytest.LogCaptureFixture) -> list[re.Match[str]]:
    lines = [record for record in caplog.records if record.name == ASK_LOGGER]
    assert all(record.levelno == logging.INFO for record in lines)
    matches = [LOG_LINE.match(record.getMessage()) for record in lines]
    assert all(match is not None for match in matches), [r.getMessage() for r in lines]
    return [match for match in matches if match is not None]


def final(events: list[dict[str, Any]]) -> dict[str, Any]:
    assert [event["type"] for event in events[:-1]] == ["delta"] * (len(events) - 1)
    return events[-1]


def remember(harness: Harness, turn: Turn, user_id: str = USER_ID) -> None:
    conversations = harness.conversations
    conversations.confirm(
        user_id, CONVERSATION_ID, conversations.append(user_id, CONVERSATION_ID, turn)
    )


def confirm_answer(harness: Harness, events: list[dict[str, Any]]) -> None:
    harness.conversations.confirm(USER_ID, CONVERSATION_ID, final(events)["turnId"])


def page_ids_in_prompt(harness: Harness, numbers: Sequence[int]) -> set[int]:
    prompt = harness.prompt()
    return {number for number in numbers if f"Abschnittstext der Seite {number}." in prompt}


def test_ask_ac29_only_sections_of_pages_that_pass_the_filter_reach_the_prompt(harness: Harness):
    harness.search.hits = [hit(1), hit(2, SPACE_B), hit(3), hit(4, SPACE_B)]
    harness.bridge.viewable = {page_id(1), page_id(4)}

    events = harness.run()

    assert final(events)["type"] == "citations"
    assert page_ids_in_prompt(harness, [1, 2, 3, 4]) == {1, 4}


def test_ask_ac29_one_filter_call_with_candidates_and_history_pages_and_the_user_token(
    harness: Harness,
):
    remember(harness, Turn("Erste?", "Antwort [1]", [page_id(7), page_id(1)]))
    harness.search.hits = [hit(1), hit(2), hit(1, text="Zweiter Abschnitt der Seite 1.")]
    harness.bridge.viewable = {page_id(1), page_id(2), page_id(7)}

    harness.run()

    assert harness.bridge.requests == [[page_id(1), page_id(2), page_id(7)]]
    assert harness.bridge.user_tokens == [USER_TOKEN]


def test_ask_ac29_hits_outside_the_token_spaces_are_dropped_even_if_the_search_returns_them(
    harness: Harness,
):
    harness.search.hits = [hit(1), hit(2, SPACE_C)]
    harness.bridge.viewable = {page_id(1), page_id(2)}

    harness.run(space_ids=[SPACE_A])

    assert harness.search.calls[0][1] == [SPACE_A]
    assert page_ids_in_prompt(harness, [1, 2]) == {1}


def test_ask_ac30_space_scope_searches_that_space_and_keeps_only_its_sections(harness: Harness):
    harness.search.hits = [hit(1, SPACE_A), hit(2, SPACE_B)]
    harness.bridge.viewable = {page_id(1), page_id(2)}
    harness.bridge.current_spaces = {page_id(1): SPACE_A, page_id(2): SPACE_B}

    harness.run(space_ids=[SPACE_A, SPACE_B], space_id=SPACE_B)

    assert harness.search.calls[0][1] == [SPACE_B]
    assert page_ids_in_prompt(harness, [1, 2]) == {2}


def test_ask_ac30_a_page_indexed_in_the_scope_but_now_in_another_space_is_not_in_the_prompt(
    harness: Harness,
):
    harness.search.hits = [hit(1, SPACE_A, score=0.9), hit(2, SPACE_A, score=0.6)]
    harness.bridge.viewable = {page_id(1), page_id(2)}
    harness.bridge.current_spaces = {page_id(1): SPACE_B, page_id(2): SPACE_A}

    events = harness.run(space_ids=[SPACE_A, SPACE_B], space_id=SPACE_A)

    assert final(events)["type"] == "citations"
    assert page_ids_in_prompt(harness, [1, 2]) == {2}
    assert harness.bridge.requests == [[page_id(1), page_id(2)]]
    assert harness.bridge.space_ids == [SPACE_A]


def test_ask_ac30_history_pages_are_filtered_without_the_space_scope(harness: Harness):
    remember(harness, Turn("Erste?", "Antwort aus Bereich B [1]", [page_id(3)]))
    harness.search.hits = [hit(1, SPACE_A)]
    harness.bridge.viewable = {page_id(1), page_id(3)}
    harness.bridge.current_spaces = {page_id(1): SPACE_A, page_id(3): SPACE_B}

    harness.run(space_ids=[SPACE_A, SPACE_B], space_id=SPACE_A)

    assert harness.bridge.requests == [[page_id(1)], [page_id(3)]]
    assert harness.bridge.space_ids == [SPACE_A, None]
    assert {"role": "assistant", "content": "Antwort aus Bereich B [1]"} in harness.model.calls[0]


def test_ask_ac29_without_a_space_scope_one_filter_call_has_no_space_id(harness: Harness):
    remember(harness, Turn("Erste?", "Antwort [1]", [page_id(3)]))
    harness.search.hits = [hit(1, SPACE_A)]
    harness.bridge.viewable = {page_id(1), page_id(3)}

    harness.run(space_ids=[SPACE_A, SPACE_B])

    assert harness.bridge.requests == [[page_id(1), page_id(3)]]
    assert harness.bridge.space_ids == [None]


def test_ask_ac30_space_scope_outside_the_token_spaces_is_no_source_without_search(
    harness: Harness,
):
    harness.search.hits = [hit(1, SPACE_C)]
    harness.bridge.viewable = {page_id(1)}

    events = harness.run(space_ids=[SPACE_A], space_id=SPACE_C)

    assert events == [{"type": "no_source"}]
    assert harness.search.calls == []
    assert harness.bridge.requests == []
    assert harness.model.calls == []


def test_ask_ac31_page_scope_passes_the_page_id_and_keeps_only_that_page(harness: Harness):
    harness.search.hits = [hit(1), hit(2)]
    harness.bridge.viewable = {page_id(1), page_id(2)}

    harness.run(space_ids=[SPACE_A, SPACE_B], scope_page_id=page_id(2))

    text, space_ids, scope, limit = harness.search.calls[0]
    assert (space_ids, scope, limit) == ([SPACE_A, SPACE_B], page_id(2), SEARCH_LIMIT)
    assert page_ids_in_prompt(harness, [1, 2]) == {2}


def test_ask_ac76_page_scope_puts_a_section_and_a_pdf_of_that_page_in_the_prompt(
    harness: Harness,
):
    harness.search.hits = [
        hit(3, heading_path=["Antrag"], text="Urlaub beantragt man zwei Wochen vorher."),
        hit(
            3,
            text="Belege bitte einscannen.",
            attachment=attachment_id(1),
            file_name="reise.pdf",
            pdf_page=2,
            score=0.6,
        ),
    ]
    harness.bridge.viewable = {page_id(3)}
    harness.model.deltas = ["Zwei Wochen vorher [1], einscannen [2]."]

    events = harness.run(scope_page_id=page_id(3))

    assert "Urlaub beantragt man zwei Wochen vorher." in harness.prompt()
    assert "Belege bitte einscannen." in harness.prompt()
    assert final(events)["citations"][1] == {
        "number": 2,
        "pageId": page_id(3),
        "headingPath": [],
        "attachmentId": attachment_id(1),
        "fileName": "reise.pdf",
        "pdfPage": 2,
    }


def test_ask_ac32_restricted_page_in_an_open_space_is_not_in_the_prompt(harness: Harness):
    sentence = "Zwei Stellen in der Verwaltung entfallen."
    harness.search.hits = [
        hit(1, text=f"{sentence} Die Bereichsleitungen werden intern besetzt.", score=0.95),
        hit(2, text="Die Kernarbeitszeit ist von 9 bis 15 Uhr.", score=0.5),
    ]
    harness.bridge.viewable = {page_id(2)}

    harness.run(question=sentence, space_ids=[SPACE_A])

    assert "Die Bereichsleitungen werden intern besetzt." not in harness.prompt()
    assert "Die Kernarbeitszeit ist von 9 bis 15 Uhr." in harness.prompt()


def test_ask_ac33_page_moved_out_of_a_readable_space_is_not_in_the_prompt(harness: Harness):
    harness.search.hits = [hit(1, SPACE_A, score=0.9), hit(2, SPACE_A, score=0.6)]
    harness.bridge.viewable = {page_id(2)}

    harness.run(space_ids=[SPACE_A])

    assert page_ids_in_prompt(harness, [1, 2]) == {2}


def test_ask_ac34_trashed_page_still_in_the_index_is_not_in_the_prompt(harness: Harness):
    harness.search.hits = [hit(1, score=0.9)]
    harness.bridge.viewable = set()

    events = harness.run(space_ids=[SPACE_A])

    assert events == [{"type": "no_source"}]
    assert harness.model.calls == []


SEED_PAGES = load_seed_pages()
AC35_QUESTIONS = (
    "Wer beantwortet Rückfragen zur Reisekostenabrechnung?",
    "Wann ist die Kernarbeitszeit?",
    "Zwei Stellen in der Verwaltung entfallen.",
    "Welche Gehaltsbänder gelten für die Abteilungsleitung?",
    "Wie pflege ich eine Orchidee?",
)


def seed_hits(user: str, stale_space: str | None) -> list[SearchHit]:
    hits: list[SearchHit] = []
    for page in SEED_PAGES:
        score = 0.5 if page.viewable_by(user) else 0.99
        for position, text in enumerate(page.section_texts()):
            hits.append(
                SearchHit(
                    page_id=page.page_id,
                    title=page.title,
                    space_id=stale_space or page.space_id,
                    heading_path=[f"Teil {position}"],
                    text=text,
                    score=score,
                    attachment_id=None,
                    file_name=None,
                    pdf_page=None,
                )
            )
    return hits


def denied_pages(user: str) -> list[SeedPage]:
    return [page for page in SEED_PAGES if not page.viewable_by(user)]


def test_ask_ac35_the_seed_matrix_denies_every_user_but_gf_some_pages():
    assert len(SEED_PAGES) >= 28
    assert denied_pages("GF") == []
    for user in ("PL", "VT", "WS"):
        assert any(page.canary for page in denied_pages(user))
    assert any(page.space_dir == "allgemein" for page in denied_pages("WS"))


@pytest.mark.parametrize("stale", [False, True], ids=["index-spaces", "stale-index-spaces"])
@pytest.mark.parametrize("question", AC35_QUESTIONS)
@pytest.mark.parametrize("user", SEED_USERS)
def test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt(
    redis_client: Redis, user: str, question: str, stale: bool
):
    spaces = member_space_ids(user)
    harness = Harness(redis=redis_client)
    harness.search.hits = seed_hits(user, spaces[0] if stale else None)
    harness.bridge.viewable = {page.page_id for page in SEED_PAGES if page.viewable_by(user)}

    events = harness.run(question=question, space_ids=spaces)

    assert final(events)["type"] == "citations"
    assert len(harness.model.calls) == 1
    prompt_sources = harness.prompt().replace(question, "")
    for page in denied_pages(user):
        assert page.canary is None or page.canary not in harness.prompt()
        for text in page.section_texts():
            assert text not in prompt_sources, (user, page.title)


def test_ask_ac36_passing_sections_below_the_threshold_give_no_source_without_the_model(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [hit(1, score=0.4499), hit(2, score=0.2), hit(3, score=-0.5)]
    harness.bridge.viewable = {page_id(1), page_id(2), page_id(3)}

    events = harness.run()

    assert events == [{"type": "no_source"}]
    assert harness.model.calls == []
    [line] = ask_lines(ask_log)
    assert (line["candidates"], line["passing"], line["outcome"]) == ("3", "0", "no_source")


def test_ask_ac36_a_score_exactly_at_the_threshold_is_kept(harness: Harness):
    harness.search.hits = [hit(1, score=THRESHOLD), hit(2, score=0.44)]
    harness.bridge.viewable = {page_id(1), page_id(2)}

    harness.run()

    assert page_ids_in_prompt(harness, [1, 2]) == {1}


def test_ask_ac36_only_the_best_eight_passing_sections_reach_the_model(harness: Harness):
    harness.search.hits = [hit(number, score=0.5 + number / 100) for number in range(1, 13)]
    harness.bridge.viewable = {page_id(number) for number in range(1, 13) if number != 12}

    harness.run()

    assert MAX_SOURCES == 8
    assert page_ids_in_prompt(harness, range(1, 13)) == set(range(4, 12))
    assert "[1] Seite 11" in harness.prompt()


def test_ask_ac37_candidates_that_all_fail_the_filter_give_no_source_without_the_model(
    harness: Harness,
):
    harness.search.hits = [hit(1, score=0.9), hit(2, SPACE_B, score=0.8)]

    events = harness.run()

    assert events == [{"type": "no_source"}]
    assert len(harness.bridge.requests) == 1
    assert harness.model.calls == []
    assert harness.stored() == []


def test_ask_ac38_a_user_without_spaces_gets_no_source_without_search_filter_or_model(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [hit(1, score=0.9)]
    harness.bridge.viewable = {page_id(1)}

    events = harness.run(space_ids=[])

    assert events == [{"type": "no_source"}]
    assert harness.search.calls == []
    assert harness.bridge.requests == []
    assert harness.model.calls == []
    [line] = ask_lines(ask_log)
    assert (line["candidates"], line["outcome"]) == ("0", "no_source")


def test_ask_ac38_a_space_scope_for_a_user_without_spaces_gets_no_source(harness: Harness):
    events = harness.run(space_ids=[], space_id=SPACE_A)

    assert events == [{"type": "no_source"}]
    assert harness.search.calls == []


def test_ask_ac48_the_search_uses_the_previous_question_and_the_current_one(harness: Harness):
    first = "Wie hoch ist die Kilometerpauschale?"
    follow_up = "Und für Hotelübernachtungen?"
    section_of_p = hit(5, text="Die Kilometerpauschale beträgt 0,30 Euro.")
    harness.search.by_text = lambda text: [section_of_p] if "Kilometerpauschale" in text else []
    harness.bridge.viewable = {page_id(5)}

    confirm_answer(harness, harness.run(question=first))
    harness.run(question=follow_up)

    assert harness.search.calls[0][0] == first
    assert harness.search.calls[1][0] == f"{first}\n{follow_up}"
    assert harness.search.calls[1][3] == SEARCH_LIMIT == 20
    assert "Die Kilometerpauschale beträgt 0,30 Euro." in harness.prompt()
    assert harness.model.calls[1][-1]["content"].endswith(follow_up)


def test_ask_ac46_the_second_prompt_holds_the_first_question_and_its_answer(harness: Harness):
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = ["Erste ", "Antwort [1]."]

    confirm_answer(harness, harness.run(question="Erste Frage?"))
    harness.run(question="Zweite Frage?")

    second = harness.model.calls[1]
    assert second[1] == {"role": "user", "content": "Erste Frage?"}
    assert second[2] == {"role": "assistant", "content": "Erste Antwort [1]."}


def test_ask_ac16_an_answered_question_ends_with_citations_and_is_stored(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [
        hit(1, score=0.9, heading_path=["A", "B"]),
        hit(2, score=0.8),
        hit(3, score=0.7),
    ]
    harness.bridge.viewable = {page_id(1), page_id(2), page_id(3)}
    harness.model.deltas = ["Erst [3", "], dann [1] und [9]."]

    events = harness.run(question="Was gilt?")

    assert [event["text"] for event in events[:-1]] == ["Erst ", "[1], dann [2] und ."]
    turn_id = final(events)["turnId"]
    assert final(events) == {
        "type": "citations",
        "turnId": turn_id,
        "citations": [
            {
                "number": 1,
                "pageId": page_id(3),
                "headingPath": [],
                "attachmentId": None,
                "fileName": None,
                "pdfPage": None,
            },
            {
                "number": 2,
                "pageId": page_id(1),
                "headingPath": ["A", "B"],
                "attachmentId": None,
                "fileName": None,
                "pdfPage": None,
            },
        ],
    }
    assert harness.stored() == []
    harness.conversations.confirm(USER_ID, CONVERSATION_ID, turn_id)
    assert harness.stored() == [
        Turn("Was gilt?", "Erst [1], dann [2] und .", [page_id(1), page_id(2), page_id(3)])
    ]
    [line] = ask_lines(ask_log)
    assert line["outcome"] == "answered"


def test_ask_ac56_an_answer_the_wiki_did_not_confirm_is_not_in_the_next_prompt(
    harness: Harness,
):
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = ["Zurückgezogene Antwort [1]."]
    harness.run(question="Erste Frage?")
    harness.model.deltas = ["Bestätigte Antwort [1]."]
    confirm_answer(harness, harness.run(question="Zweite Frage?"))

    harness.run(question="Dritte Frage?")

    prompt = harness.prompt()
    assert "Zurückgezogene Antwort" not in prompt
    assert "Erste Frage?" not in prompt
    assert {"role": "user", "content": "Zweite Frage?"} in harness.model.calls[-1]
    assert {"role": "assistant", "content": "Bestätigte Antwort [1]."} in harness.model.calls[-1]


def test_ask_ac55_a_history_answer_whose_source_page_fails_is_dropped_and_its_question_kept(
    harness: Harness,
):
    remember(harness, Turn("Alte Frage?", "Geheime Antwort [1]", [page_id(1)]))
    remember(harness, Turn("Zweite Frage?", "Offene Antwort [1]", [page_id(2), page_id(1)]))
    remember(harness, Turn("Dritte Frage?", "Erlaubte Antwort [1]", [page_id(2)]))
    harness.search.hits = [hit(2)]
    harness.bridge.viewable = {page_id(2)}

    harness.run(question="Neue Frage?")

    messages = harness.model.calls[0]
    contents = [message["content"] for message in messages]
    assert "Alte Frage?" in contents
    assert "Zweite Frage?" in contents
    assert "Geheime Antwort [1]" not in harness.prompt()
    assert "Offene Antwort [1]" not in harness.prompt()
    assert {"role": "assistant", "content": "Erlaubte Antwort [1]"} in messages
    assert [message["role"] for message in messages] == [
        "system",
        "user",
        "user",
        "user",
        "assistant",
        "user",
    ]


def test_ask_ac55_history_of_another_user_is_not_loaded(harness: Harness):
    remember(harness, Turn("Fremde Frage?", "Fremde Antwort [1]", [page_id(1)]), OTHER_USER_ID)
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}

    harness.run(question="Eigene Frage?")

    assert "Fremde" not in harness.prompt()
    assert harness.search.calls[0][0] == "Eigene Frage?"


def history_key() -> str:
    return conversation_key(USER_ID, CONVERSATION_ID)


def test_ask_ac53_a_question_that_ends_in_no_source_extends_the_expiry(harness: Harness):
    remember(harness, Turn("Alte Frage?", "Alte Antwort [1]", [page_id(1)]))
    harness.redis.expire(history_key(), 100)
    harness.search.hits = []

    assert harness.run() == [{"type": "no_source"}]

    assert harness.redis.ttl(history_key()) == HISTORY_TTL_SECONDS


def test_ask_ac53_a_question_that_fails_extends_the_expiry(harness: Harness):
    remember(harness, Turn("Alte Frage?", "Alte Antwort [1]", [page_id(1)]))
    harness.redis.expire(history_key(), 100)
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.failure = ModelUnavailable("HTTP 503")

    harness.run()

    assert harness.redis.ttl(history_key()) == HISTORY_TTL_SECONDS


def test_ask_ac53_a_question_outside_every_space_extends_the_expiry(harness: Harness):
    remember(harness, Turn("Alte Frage?", "Alte Antwort [1]", [page_id(1)]))
    harness.redis.expire(history_key(), 100)

    harness.run(space_ids=[])

    assert harness.redis.ttl(history_key()) == HISTORY_TTL_SECONDS


def test_ask_ac53_a_question_does_not_create_the_conversation(harness: Harness):
    harness.search.hits = []

    harness.run()

    assert harness.redis.exists(history_key()) == 0


def test_ask_ac56_an_answer_without_a_valid_citation_is_no_source_and_not_stored(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = ["Ohne Quelle [7]."]

    events = harness.run()

    assert events == [{"type": "delta", "text": "Ohne Quelle ."}, {"type": "no_source"}]
    assert harness.stored() == []
    [line] = ask_lines(ask_log)
    assert line["outcome"] == "no_source"


def test_ask_ac56_a_failed_answer_shows_the_error_after_its_text_and_is_not_stored(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = ["Teil [1] "]
    harness.model.failure = ModelUnavailable("ReadTimeout")

    events = harness.run()

    assert events == [
        {"type": "delta", "text": "Teil [1] "},
        {"type": "error", "code": "model_unavailable"},
    ]
    assert harness.stored() == []
    [line] = ask_lines(ask_log)
    assert line["outcome"] == "model_failed"


def test_ask_ac56_a_model_that_fails_before_any_text_logs_no_first_text_time(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = []
    harness.model.failure = ModelUnavailable("ConnectError")

    events = harness.run()

    assert events == [{"type": "error", "code": "model_unavailable"}]
    [line] = ask_lines(ask_log)
    assert (line["first_text_ms"], line["outcome"]) == ("none", "model_failed")


@pytest.mark.parametrize(
    "failure",
    [
        refuse,
        server_error,
        answer(401, "user_token_expired"),
        answer(503, "assistant_disabled"),
        answer(400, "too_many_page_ids"),
        lambda: httpx.Response(200, json={"pageIds": "all"}),
        lambda: httpx.Response(200, content=b"not json"),
    ],
    ids=["refused", "5xx", "expired-token", "disabled", "4xx", "malformed", "not-json"],
)
def test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model(
    harness: Harness, ask_log: pytest.LogCaptureFixture, failure: Callable[[], httpx.Response]
):
    harness.search.hits = [hit(1)]
    harness.bridge.failure = failure

    events = harness.run()

    assert events == [{"type": "error", "code": "model_unavailable"}]
    assert harness.model.calls == []
    assert harness.stored() == []
    [line] = ask_lines(ask_log)
    assert (line["candidates"], line["passing"], line["outcome"]) == ("1", "0", "filter_failed")


@pytest.mark.parametrize(
    "failure",
    [
        psycopg.OperationalError("connection to server lost"),
        psycopg.errors.UndefinedTable("relation does not exist"),
        EmbeddingFailed("stub-embedding-model"),
    ],
    ids=["lost-database", "database-error", "embedding"],
)
def test_ask_ac74_a_failing_search_gives_model_unavailable_and_logs_model_failed(
    harness: Harness, ask_log: pytest.LogCaptureFixture, failure: Exception
):
    harness.search.failure = failure

    events = harness.run()

    assert events == [{"type": "error", "code": "model_unavailable"}]
    assert harness.bridge.requests == []
    assert harness.model.calls == []
    [line] = ask_lines(ask_log)
    assert (line["candidates"], line["passing"], line["outcome"]) == ("0", "0", "model_failed")


def test_ask_ac13_closing_the_events_after_the_first_delta_closes_the_model_stream(
    harness: Harness, ask_log: pytest.LogCaptureFixture
):
    harness.search.hits = [hit(1)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = ["Erster Teil [1] ", "zweiter Teil ", "dritter Teil."]

    events = harness.events()
    assert next(events) == {"type": "delta", "text": "Erster Teil [1] "}
    events.close()

    assert harness.model.closed
    assert harness.model.yielded == 1
    assert harness.stored() == []
    [line] = ask_lines(ask_log)
    assert line["outcome"] == "stopped"


def test_ask_ac74_the_log_line_holds_conversation_mode_model_counts_and_first_text_time(
    redis_client: Redis, ask_log: pytest.LogCaptureFixture
):
    harness = Harness(redis=redis_client)
    harness.model = StubModel(["Text [1]."], clock=harness.clock, seconds_per_delta=1.25)
    harness.search.hits = [hit(1), hit(2), hit(3, score=0.1)]
    harness.bridge.viewable = {page_id(1), page_id(3)}

    harness.run()

    [line] = ask_lines(ask_log)
    assert line.groupdict() == {
        "conversation": CONVERSATION_ID,
        "mode": MODE,
        "model": MODEL_NAME,
        "candidates": "3",
        "passing": "1",
        "first_text_ms": "1250",
        "outcome": "answered",
    }


SECRET_QUESTION = "Wie lautet das Kennwort Zweiströmeland?"
SECRET_PAGE_TEXT = "Der Code für das Baustellentor lautet Eisenriegel."
SECRET_ANSWER = "Der Code steht im Container [1]."


def run_outcome(harness: Harness, outcome: str) -> None:
    harness.search.hits = [hit(1, text=SECRET_PAGE_TEXT)]
    harness.bridge.viewable = {page_id(1)}
    harness.model.deltas = [SECRET_ANSWER, " Weitere Zeile."]
    if outcome == "no_source":
        harness.search.hits = [hit(1, text=SECRET_PAGE_TEXT, score=0.1)]
    if outcome == "model_failed":
        harness.model.failure = ModelUnavailable("HTTP 503")
    if outcome == "filter_failed":
        harness.bridge.failure = server_error
    events = harness.events(question=SECRET_QUESTION)
    if outcome == "stopped":
        next(events)
        events.close()
        return
    list(events)


OUTCOMES = ("answered", "no_source", "stopped", "model_failed", "filter_failed")


@pytest.mark.parametrize("outcome", OUTCOMES)
def test_ask_ac74_each_outcome_logs_exactly_one_line_naming_it(
    harness: Harness, ask_log: pytest.LogCaptureFixture, outcome: str
):
    run_outcome(harness, outcome)

    [line] = ask_lines(ask_log)
    assert line["outcome"] == outcome
    assert line["conversation"] == CONVERSATION_ID
    assert (line["mode"], line["model"]) == (MODE, MODEL_NAME)


@pytest.mark.parametrize("outcome", OUTCOMES)
def test_ask_ac75_log_lines_hold_no_question_answer_page_text_title_or_token(
    harness: Harness, ask_log: pytest.LogCaptureFixture, outcome: str
):
    run_outcome(harness, outcome)

    logged = "\n".join(
        f"{record.getMessage()} {record.args!r} {record.__dict__!r}" for record in ask_log.records
    )
    assert ask_log.records
    for secret in (
        SECRET_QUESTION,
        "Zweiströmeland",
        SECRET_PAGE_TEXT,
        "Eisenriegel",
        "Container",
        "Seite 1",
        USER_TOKEN,
    ):
        assert secret not in logged


def test_ask_ac29_filter_pages_posts_the_page_ids_with_both_tokens():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"pageIds": [page_id(2)]})

    assert mock_client(handler).filter_pages([page_id(1), page_id(2)], USER_TOKEN) == [page_id(2)]
    [request] = seen
    assert request.url.path == FILTER_PAGES_PATH == "/api/ai-bridge/internal/filter-pages"
    assert request.headers[USER_TOKEN_HEADER] == USER_TOKEN
    assert USER_TOKEN_HEADER == "X-User-Token"
    assert request.headers["X-Service-Token"]
    assert json.loads(request.content) == {"pageIds": [page_id(1), page_id(2)]}


def test_ask_ac30_filter_pages_sends_the_space_id_only_when_given():
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"pageIds": []})

    client = mock_client(handler)
    client.filter_pages([page_id(1)], USER_TOKEN, SPACE_B)
    client.filter_pages([page_id(1)], USER_TOKEN)

    assert bodies == [{"pageIds": [page_id(1)], "spaceId": SPACE_B}, {"pageIds": [page_id(1)]}]


def test_ask_ac29_filter_pages_without_ids_sends_no_request():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    assert mock_client(handler).filter_pages([], USER_TOKEN) == []


def test_ask_ac29_filter_pages_refuses_more_than_500_ids_without_sending():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no request expected")

    client = mock_client(handler)
    assert MAX_FILTER_PAGE_IDS == 500
    with pytest.raises(ValueError, match="at most 500"):
        client.filter_pages([page_id(number) for number in range(501)], USER_TOKEN)


@pytest.mark.parametrize(
    ("failure", "error_class"),
    [
        (refuse, BridgeUnavailable),
        (server_error, BridgeUnavailable),
        (answer(503, "assistant_disabled"), BridgeRefused),
        (answer(401, "user_token_invalid"), BridgeError),
        (lambda: httpx.Response(200, json={"pageIds": [1]}), BridgeError),
        (lambda: httpx.Response(200, json=["x"]), BridgeError),
    ],
    ids=["refused", "5xx", "disabled", "user-token", "non-string-id", "not-an-object"],
)
def test_ask_ac70_filter_pages_maps_failures_to_bridge_errors(
    failure: Callable[[], httpx.Response], error_class: type[BridgeError]
):
    with pytest.raises(error_class):
        mock_client(lambda request: failure()).filter_pages([page_id(1)], USER_TOKEN)


def test_ask_ac31_search_index_refuses_a_page_id_that_is_not_a_uuid():
    embedder = HashingEmbedder()
    with pytest.raises(ValueError, match="page_id"):
        search_index(
            IndexStore.__new__(IndexStore), embedder, "Urlaub", [SPACE_A], page_id="page-1"
        )
    assert embedder.calls == []


def pdf_section(embedder: HashingEmbedder, position: int, text: str) -> StoredSection:
    [vector] = embedder.embed([text])
    return StoredSection(position, [], text, vector, attachment_id(position), "a.pdf", 1)


@pytest.mark.integration
def test_ask_ac31_store_search_with_a_page_id_returns_only_that_page_and_its_pdfs(
    store: IndexStore, embedder: HashingEmbedder, tmp_path: Path
):
    index_page(store, embedder, make_entry(1), ["Urlaub im Sommer"])
    page_two = make_entry(2)
    assert store.replace_page(
        page_two,
        [
            StoredSection(
                0, ["Antrag"], "Urlaub im Winter", embedder.embed(["Urlaub im Winter"])[0]
            ),
            pdf_section(embedder, 1, "Urlaub laut Vertrag"),
        ],
    )
    index_page(store, embedder, make_entry(3, space_id=SPACE_B), ["Urlaub im Herbst"])
    index_page(store, embedder, make_entry(4, embedding_model="other"), ["Urlaub im Mai"])

    hits = search_index(
        store, embedder, "Urlaub", [SPACE_A, SPACE_B], limit=50, page_id=page_two.page_id
    )

    assert {(hit.page_id, hit.text) for hit in hits} == {
        (page_id(2), "Urlaub im Winter"),
        (page_id(2), "Urlaub laut Vertrag"),
    }
    assert {hit.attachment_id for hit in hits} == {None, attachment_id(1)}
    assert search_index(store, embedder, "Urlaub", [SPACE_B], page_id=page_id(2)) == []
    assert search_index(store, embedder, "Urlaub", [SPACE_A], page_id=page_id(4)) == []
    unscoped = search_index(store, embedder, "Urlaub", [SPACE_A, SPACE_B], limit=50)
    assert {hit.page_id for hit in unscoped} == {page_id(1), page_id(2), page_id(3)}
