import os
import time
import uuid
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
import pytest
from redis import Redis

from ai_service.ask import AskPipeline, AskRequest, FilterPages
from ai_service.conversations import ConversationStore
from ai_service.index_store import SearchHit
from ai_service.search import search_index
from ai_service.settings import AskSettings
from ai_service.wiki_session import SEED_EMAILS, parse_sse_events
from ai_service.wiki_session import log_in as log_in_with_retry
from tests.conftest import WORKSPACE_ID, RecordingRequestLog
from tests.test_ask import StubModel
from tests.test_stack import (
    GIVE_UP_SECONDS,
    POLL_SECONDS,
    WRITABLE_SPACE_PAGE_TITLE,
    Stack,
    stack,
    throwaway_page,
    wait_until_found,
)

__all__ = ["stack"]

pytestmark = [pytest.mark.integration, pytest.mark.stack]

BRIDGE_SECRET_VARIABLE = "STACK_BRIDGE_SECRET"
SEED_PASSWORD = os.environ.get("STACK_SEED_PASSWORD", "seed-demo-password")
THRESHOLD = float(AskSettings.model_fields["ai_relevance_threshold"].default)
FIRST_TEXT_LIMIT_SECONDS = 10
MOVE_WAIT_SECONDS = 30
MIN_SECTION_LENGTH = 40
NO_SOURCE_EVENTS = [{"type": "no_source"}]

RESTRUCTURING_TITLE = "Umstrukturierung 2027"
SALARY_TITLE = "Gehaltsbänder Führungsebene"
GF_ONLY_PAGE_TITLE = SALARY_TITLE
RESTRUCTURING_QUESTION = "Zwei Stellen in der Verwaltung entfallen."
TRAVEL_QUESTION = "Wer beantwortet Rückfragen zur Reisekostenabrechnung?"
CORE_HOURS_QUESTION = "Wann ist die Kernarbeitszeit?"
SALARY_QUESTION = "Welche Gehaltsbänder gelten für die Abteilungsleitung?"
ORCHID_QUESTION = "Wie pflege ich eine Orchidee?"
ONBOARDING_QUESTIONS = (
    "Wie läuft die Einarbeitung neuer Mitarbeitender ab?",
    "Wie beantrage ich Urlaub über das Personalportal?",
)


def sign_user_token(
    user_id: str, workspace_id: str, space_ids: Sequence[str], bridge_secret: str
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "sub": user_id,
            "workspaceId": workspace_id,
            "spaceIds": list(space_ids),
            "aud": "ai-service",
            "type": "user",
            "iat": now,
            "exp": now + 300,
        },
        bridge_secret,
        algorithm="HS256",
    )


@dataclass(frozen=True)
class Member:
    key: str
    user_id: str
    workspace_id: str
    space_ids: list[str]
    session: httpx.Client
    bridge_secret: str

    @property
    def token(self) -> str:
        return sign_user_token(self.user_id, self.workspace_id, self.space_ids, self.bridge_secret)

    def may_view(self, page_id: str) -> bool:
        response = self.session.post("/api/pages/info", json={"pageId": page_id})
        if response.status_code != 200:
            return False
        return response.json()["data"].get("deletedAt") is None


@dataclass(frozen=True)
class WikiAnswer:
    events: list[dict[str, Any]]
    seconds_to_first_text: float | None

    @property
    def text(self) -> str:
        return "".join(event["text"] for event in self.events if event["type"] == "delta")

    @property
    def final(self) -> dict[str, Any]:
        return self.events[-1]


@dataclass(frozen=True)
class PipelineRun:
    events: list[dict[str, Any]]
    candidates: list[SearchHit]
    model: StubModel

    @property
    def sources_block(self) -> str:
        if not self.model.calls:
            return ""
        question_message = self.model.calls[-1][-1]["content"]
        return question_message.rsplit("\n\nFrage: ", 1)[0]


@dataclass(frozen=True)
class StatePages:
    moved_id: str
    moved_sentence: str
    trashed_id: str
    trashed_sentence: str


def log_in(wiki_url: str, key: str, bridge_secret: str, password: str = SEED_PASSWORD) -> Member:
    session = httpx.Client(
        base_url=wiki_url, timeout=httpx.Timeout(180, connect=10), follow_redirects=False
    )
    response = log_in_with_retry(session, SEED_EMAILS[key], password, time.sleep)
    assert response.status_code == 200, response.text
    user = session.post("/api/users/me").json()["data"]["user"]
    spaces = session.post("/api/spaces", json={}).json()["data"]["items"]
    return Member(
        key=key,
        user_id=user["id"],
        workspace_id=user["workspaceId"],
        space_ids=[space["id"] for space in spaces],
        session=session,
        bridge_secret=bridge_secret,
    )


@pytest.fixture(scope="module")
def members(stack: Stack) -> Iterator[dict[str, Member]]:
    bridge_secret = os.environ.get(BRIDGE_SECRET_VARIABLE)
    if not bridge_secret:
        pytest.fail(f"no running stack configured, set {BRIDGE_SECRET_VARIABLE}")
    logged_in = {key: log_in(stack.wiki_url, key, bridge_secret) for key in SEED_EMAILS}
    yield logged_in
    for member in logged_in.values():
        member.session.close()


def page_titled(stack: Stack, title: str) -> str:
    [page_id] = [
        identifier for identifier, content in stack.contents.items() if content.title == title
    ]
    return page_id


def space_of(stack: Stack, title: str) -> str:
    return stack.contents[page_titled(stack, title)].space_id


def indexed_texts(stack: Stack, page_id: str) -> list[str]:
    return [section.text for section in stack.store.sections_of(page_id)]


def ask_wiki(member: Member, question: str) -> WikiAnswer:
    events: list[dict[str, Any]] = []
    first_text: float | None = None
    started = time.monotonic()
    body = {"question": question, "conversationId": str(uuid.uuid4())}
    with member.session.stream("POST", "/api/ai/ask", json=body) as response:
        assert response.status_code == 200, response.read()
        for event in parse_sse_events(response.iter_lines()):
            if event["type"] == "delta" and first_text is None:
                first_text = time.monotonic() - started
            events.append(event)
    return WikiAnswer(events, first_text)


def run_pipeline(
    stack: Stack,
    member: Member,
    question: str,
    redis: Redis,
    filter_pages: FilterPages | None = None,
) -> PipelineRun:
    candidates: list[SearchHit] = []

    def search(
        text: str, space_ids: Sequence[str], page_id: str | None, limit: int
    ) -> list[SearchHit]:
        hits = search_index(stack.store, stack.embedder, text, space_ids, limit, page_id)
        candidates.extend(hits)
        return hits

    model = StubModel()
    pipeline = AskPipeline(
        search=search,
        filter_pages=filter_pages or stack.bridge.filter_pages,
        model=model,
        conversations=ConversationStore(redis),
        threshold=THRESHOLD,
        inference_mode="local",
        request_log=RecordingRequestLog(),
    )
    request = AskRequest(question=question, conversation_id=str(uuid.uuid4()))
    events = list(
        pipeline.ask(request, member.user_id, WORKSPACE_ID, member.space_ids, member.token)
    )
    return PipelineRun(events, candidates, model)


def sections_in_prompt(stack: Stack, run: PipelineRun, page_id: str) -> list[str]:
    return [
        text
        for text in indexed_texts(stack, page_id)
        if len(text) >= MIN_SECTION_LENGTH and text in run.sources_block
    ]


def allow_every_page(
    page_ids: Sequence[str], user_token: str, space_id: str | None = None
) -> list[str]:
    return list(page_ids)


@contextmanager
def indexed_throwaway_page(
    stack: Stack, member: Member, space_id: str, sentence: str, token: str
) -> Iterator[str]:
    with throwaway_page(member.session, space_id, token) as page_id:
        response = member.session.post(
            "/api/pages/update",
            json={
                "pageId": page_id,
                "content": f"## Nachtrag {token}\n\n{sentence}",
                "operation": "append",
                "format": "markdown",
            },
        )
        assert response.status_code == 200, response.text
        found_at = wait_until_found(stack, sentence, page_id, token)
        assert found_at is not None, f"page not searchable after {GIVE_UP_SECONDS} s"
        yield page_id


def wait_until_index_entry(
    stack: Stack, page_id: str, reached: Callable[[str | None], bool], seconds: float
) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        entry = stack.store.get_entry(page_id)
        if reached(None if entry is None else entry.space_id):
            return
        time.sleep(POLL_SECONDS)


@pytest.fixture(scope="module")
def state_pages(stack: Stack, members: dict[str, Member]) -> Iterator[StatePages]:
    owner = members["GF"]
    open_space = space_of(stack, WRITABLE_SPACE_PAGE_TITLE)
    closed_space = space_of(stack, GF_ONLY_PAGE_TITLE)
    moved_token = uuid.uuid4().hex[:8]
    trashed_token = uuid.uuid4().hex[:8]
    moved_sentence = (
        "Der Hausmeister gießt die Ficus-Pflanzen im Foyer dienstags vor acht Uhr,"
        f" Kennung {moved_token}."
    )
    trashed_sentence = (
        "Die Hauspost wird freitags um vierzehn Uhr im Erdgeschoss ausgegeben,"
        f" Kennung {trashed_token}."
    )
    with (
        indexed_throwaway_page(stack, owner, open_space, moved_sentence, moved_token) as moved_id,
        indexed_throwaway_page(
            stack, owner, open_space, trashed_sentence, trashed_token
        ) as trashed_id,
    ):
        moved = owner.session.post(
            "/api/pages/move-to-space", json={"pageId": moved_id, "spaceId": closed_space}
        )
        assert moved.status_code == 200, moved.text
        wait_until_index_entry(
            stack, moved_id, lambda space: space == closed_space, MOVE_WAIT_SECONDS
        )
        with stack.store.writer_lock():
            stack.store.rescope([moved_id], open_space)

        entry = stack.store.get_entry(trashed_id)
        assert entry is not None
        sections = stack.store.sections_of(trashed_id)
        deleted = owner.session.post("/api/pages/delete", json={"pageId": trashed_id})
        assert deleted.status_code == 200, deleted.text
        wait_until_index_entry(stack, trashed_id, lambda space: space is None, MOVE_WAIT_SECONDS)
        with stack.store.writer_lock():
            stack.store.replace_page(entry, sections)

        try:
            yield StatePages(moved_id, moved_sentence, trashed_id, trashed_sentence)
        finally:
            with stack.store.writer_lock():
                stack.store.remove_pages([trashed_id])


def test_ask_ac32_a_restricted_page_in_an_open_space_gives_no_section_in_the_prompt(
    stack: Stack, members: dict[str, Member], redis_client: Redis
):
    restricted = page_titled(stack, RESTRUCTURING_TITLE)
    workstudent = members["WS"]
    assert stack.contents[restricted].space_id in workstudent.space_ids
    assert not workstudent.may_view(restricted)

    run = run_pipeline(stack, workstudent, RESTRUCTURING_QUESTION, redis_client)

    assert restricted in {hit.page_id for hit in run.candidates}
    assert sections_in_prompt(stack, run, restricted) == []
    assert "CANARY-3F9A21C7" not in run.sources_block


def test_ask_ac32_control_without_the_filter_the_restricted_sections_reach_the_prompt(
    stack: Stack, members: dict[str, Member], redis_client: Redis
):
    restricted = page_titled(stack, RESTRUCTURING_TITLE)

    run = run_pipeline(stack, members["WS"], RESTRUCTURING_QUESTION, redis_client, allow_every_page)

    assert sections_in_prompt(stack, run, restricted) != []


def test_ask_ac33_a_page_moved_out_of_a_readable_space_gives_no_section_in_the_prompt(
    stack: Stack, members: dict[str, Member], state_pages: StatePages, redis_client: Redis
):
    workstudent = members["WS"]
    open_space = space_of(stack, WRITABLE_SPACE_PAGE_TITLE)
    entry = stack.store.get_entry(state_pages.moved_id)
    assert entry is not None and entry.space_id == open_space
    assert stack.bridge.page_content(state_pages.moved_id).space_id != open_space
    assert not workstudent.may_view(state_pages.moved_id)

    run = run_pipeline(stack, workstudent, state_pages.moved_sentence, redis_client)

    assert state_pages.moved_id in {hit.page_id for hit in run.candidates}
    assert sections_in_prompt(stack, run, state_pages.moved_id) == []


def test_ask_ac34_a_trashed_page_still_in_the_index_gives_no_section_in_the_prompt(
    stack: Stack, members: dict[str, Member], state_pages: StatePages, redis_client: Redis
):
    workstudent = members["WS"]
    assert stack.store.get_entry(state_pages.trashed_id) is not None
    assert not members["GF"].may_view(state_pages.trashed_id)

    run = run_pipeline(stack, workstudent, state_pages.trashed_sentence, redis_client)

    assert state_pages.trashed_id in {hit.page_id for hit in run.candidates}
    assert sections_in_prompt(stack, run, state_pages.trashed_id) == []


@pytest.mark.parametrize("user", sorted(SEED_EMAILS))
def test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt(
    stack: Stack,
    members: dict[str, Member],
    state_pages: StatePages,
    redis_client: Redis,
    user: str,
):
    member = members[user]
    questions = [
        TRAVEL_QUESTION,
        CORE_HOURS_QUESTION,
        RESTRUCTURING_QUESTION,
        state_pages.moved_sentence,
        state_pages.trashed_sentence,
        SALARY_QUESTION,
        ORCHID_QUESTION,
    ]
    every_page = [*stack.contents, state_pages.moved_id, state_pages.trashed_id]
    denied = [page_id for page_id in every_page if not member.may_view(page_id)]
    assert (len(denied) > 1) == (user != "GF")
    assert state_pages.trashed_id in denied
    assert (state_pages.moved_id in denied) == (user != "GF")

    leaks: list[tuple[str, str]] = []
    denied_candidates: set[str] = set()
    for question in questions:
        run = run_pipeline(stack, member, question, redis_client)
        denied_candidates.update(hit.page_id for hit in run.candidates if hit.page_id in denied)
        leaks.extend(
            (question, page_id) for page_id in denied if sections_in_prompt(stack, run, page_id)
        )

    assert denied_candidates
    assert leaks == []


def test_ask_ac39_gehaltsbaender_for_ws_gives_the_no_source_answer(
    stack: Stack, members: dict[str, Member]
):
    answer = ask_wiki(members["WS"], SALARY_QUESTION)

    assert answer.events == NO_SOURCE_EVENTS


@pytest.mark.parametrize("user", sorted(SEED_EMAILS))
def test_ask_ac40_orchid_question_gives_the_same_no_source_answer(
    stack: Stack, members: dict[str, Member], user: str
):
    answer = ask_wiki(members[user], ORCHID_QUESTION)

    assert answer.events == NO_SOURCE_EVENTS


def test_ask_ac41_gf_gets_the_salary_band_with_the_gehaltsbaender_page_as_source(
    stack: Stack, members: dict[str, Member]
):
    answer = ask_wiki(members["GF"], SALARY_QUESTION)

    assert answer.final["type"] == "sources", answer.events
    assert "75.000" in answer.text
    assert any("Gehaltsbänder" in source["title"] for source in answer.final["sources"])
    assert "<think" not in answer.text and "</think" not in answer.text


@pytest.mark.parametrize("question", ONBOARDING_QUESTIONS)
def test_ask_ac57_the_first_answer_text_appears_within_10_seconds(
    stack: Stack, members: dict[str, Member], question: str
):
    ask_wiki(members["GF"], CORE_HOURS_QUESTION)

    answer = ask_wiki(members["GF"], question)

    assert answer.seconds_to_first_text is not None, answer.events
    print(f"ASK-AC57 first text: {answer.seconds_to_first_text:.2f} s")
    assert answer.seconds_to_first_text <= FIRST_TEXT_LIMIT_SECONDS
    assert "<think" not in answer.text and "</think" not in answer.text
