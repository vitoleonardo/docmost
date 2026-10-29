import os
import re
import uuid
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field

import psycopg
import pytest
from redis import Redis

from ai_service.ask import AskPipeline, AskRequest, FilterPages, SearchSections
from ai_service.bridge_client import BridgeClient
from ai_service.conversations import ConversationStore
from ai_service.embedding import Embedder, FastEmbedEmbedder
from ai_service.index_store import IndexStore, SearchHit
from ai_service.indexer import Indexer, IndexOutcome
from ai_service.search import search_index
from tests.hashing_embedder import HashingEmbedder
from tests.seed_matrix import (
    CANARIES_PATH,
    LEAK_QUESTIONS_PATH,
    SEED_USERS,
    SPACE_DIRS,
    SPACE_MEMBERS,
    load_entries,
)
from tests.test_ask import StubModel
from tests.test_stack import list_all_pages
from tests.test_stack_ask import (
    MIN_SECTION_LENGTH,
    SEED_EMAILS,
    THRESHOLD,
    Member,
    PipelineRun,
    log_in,
    sign_user_token,
)

LEAK_VARIABLES = (
    "LEAK_WIKI_URL",
    "LEAK_SERVICE_TOKEN",
    "LEAK_BRIDGE_SECRET",
    "LEAK_AI_DATABASE_URL",
    "LEAK_REDIS_URL",
    "LEAK_SEED_PASSWORD",
)
EMBEDDING_MODEL_VARIABLE = "LEAK_EMBEDDING_MODEL"
SPACE_NAMES = {
    "allgemein": "Allgemein",
    "hr": "HR",
    "vertrieb": "Vertrieb",
    "projekte": "Projekte",
    "it": "IT",
    "geschaeftsfuehrung": "Geschäftsführung",
}
LIST_LIMIT = 100
DENIED_SCORE = 1.0
VIEWABLE_SCORE = 0.9
EVERY_CANDIDATE_THRESHOLD = -1.0
SOURCE_HEADER = re.compile(r"(?m)^\[\d+\] (.*)$")

LeakFinding = tuple[str, str]


def source_blocks(sources_block: str) -> list[tuple[str, str]]:
    blocks = SOURCE_HEADER.split(sources_block)[1:]
    return [(title, body) for title, body in zip(blocks[::2], blocks[1::2], strict=True)]


def leak_questions() -> list[str]:
    return [entry["question"] for entry in load_entries(LEAK_QUESTIONS_PATH)]


@dataclass(frozen=True)
class LeakRun(PipelineRun):
    filter_calls: list[list[str]] = field(default_factory=list)

    @property
    def passing_page_ids(self) -> set[str]:
        return {page_id for passing in self.filter_calls for page_id in passing}


@dataclass
class AccessModel:
    space_dirs: dict[str, str]
    page_spaces: dict[str, str]
    denied_users: dict[str, frozenset[str]]
    members: dict[str, set[str]] = field(
        default_factory=lambda: {user: set(SPACE_MEMBERS[user]) for user in SEED_USERS}
    )
    trashed: set[str] = field(default_factory=set)

    def may_view(self, user: str, page_id: str) -> bool:
        if page_id in self.trashed:
            return False
        space_dir = self.space_dirs[self.page_spaces[page_id]]
        return space_dir in self.members[user] and user not in self.denied_users[page_id]

    def viewable_pages(self, user: str) -> list[str]:
        return [page_id for page_id in self.page_spaces if self.may_view(user, page_id)]

    def member_space_ids(self, user: str) -> list[str]:
        return [
            space_id
            for space_id, space_dir in self.space_dirs.items()
            if space_dir in self.members[user]
        ]

    def remove_member(self, user: str, space_dir: str) -> None:
        self.members[user].discard(space_dir)

    def move_page(self, page_id: str, space_id: str) -> None:
        self.page_spaces[page_id] = space_id

    def trash_page(self, page_id: str) -> None:
        self.trashed.add(page_id)


@dataclass
class LeakStack:
    bridge: BridgeClient
    store: IndexStore
    embedder: Embedder
    redis: Redis
    owner: Member
    bridge_secret: str
    user_ids: dict[str, str]
    space_ids: dict[str, str]
    titles: dict[str, str]
    canaries: dict[str, str]
    access: AccessModel
    threshold: float
    section_texts: dict[str, list[str]] = field(default_factory=dict)

    @property
    def workspace_id(self) -> str:
        return self.owner.workspace_id

    def token_space_ids(self, user: str) -> list[str]:
        return [
            self.space_ids[space_dir]
            for space_dir in SPACE_DIRS
            if space_dir in SPACE_MEMBERS[user]
        ]

    def token(self, user: str) -> str:
        return sign_user_token(
            self.user_ids[user], self.workspace_id, self.token_space_ids(user), self.bridge_secret
        )

    def page_titled(self, title: str) -> str:
        [page_id] = [page_id for page_id, page_title in self.titles.items() if page_title == title]
        return page_id

    def index_page(self, page_id: str) -> IndexOutcome:
        with self.store.writer_lock():
            outcome = Indexer(self.bridge, self.store, self.embedder).index_page(page_id)
        self.refresh_sections(page_id)
        return outcome

    def refresh_sections(self, page_id: str) -> None:
        self.section_texts[page_id] = [section.text for section in self.store.sections_of(page_id)]

    def index_search(
        self, text: str, space_ids: Sequence[str], page_id: str | None, limit: int
    ) -> list[SearchHit]:
        return search_index(self.store, self.embedder, text, space_ids, limit, page_id)

    def every_section_search(self, user: str) -> SearchSections:
        hits = [
            SearchHit(
                page_id=entry.page_id,
                title=entry.title,
                space_id=entry.space_id,
                heading_path=section.heading_path,
                text=section.text,
                score=VIEWABLE_SCORE if self.access.may_view(user, entry.page_id) else DENIED_SCORE,
                attachment_id=section.attachment_id,
                file_name=section.file_name,
                pdf_page=section.pdf_page,
            )
            for entry in self.store.list_entries()
            for section in self.store.sections_of(entry.page_id)
        ]

        def search(
            text: str, space_ids: Sequence[str], page_id: str | None, limit: int
        ) -> list[SearchHit]:
            return list(hits)

        return search

    def ask(
        self,
        user: str,
        question: str,
        *,
        space_id: str | None = None,
        page_id: str | None = None,
        conversation_id: str | None = None,
        search: SearchSections | None = None,
        filter_pages: FilterPages | None = None,
    ) -> LeakRun:
        candidates: list[SearchHit] = []
        searching = search or self.index_search

        def recording_search(
            text: str, space_ids: Sequence[str], scope_page_id: str | None, limit: int
        ) -> list[SearchHit]:
            hits = searching(text, space_ids, scope_page_id, limit)
            candidates.extend(hits)
            return hits

        filter_calls: list[list[str]] = []
        filtering = filter_pages or self.bridge.filter_pages

        def recording_filter(
            page_ids: Sequence[str], user_token: str, scope_space_id: str | None
        ) -> list[str]:
            passing = filtering(page_ids, user_token, scope_space_id)
            filter_calls.append(list(passing))
            return passing

        model = StubModel()
        conversations = ConversationStore(self.redis)
        pipeline = AskPipeline(
            search=recording_search,
            filter_pages=recording_filter,
            model=model,
            conversations=conversations,
            threshold=self.threshold,
            inference_mode="local",
        )
        request = AskRequest(
            question=question,
            conversation_id=conversation_id or str(uuid.uuid4()),
            space_id=space_id,
            page_id=page_id,
        )
        user_id = self.user_ids[user]
        events = list(pipeline.ask(request, user_id, self.token_space_ids(user), self.token(user)))
        errors = [event for event in events if event["type"] == "error"]
        assert errors == [], f"{user} asking {question!r}: {errors}"
        for event in events:
            if event["type"] == "citations":
                conversations.confirm(user_id, request.conversation_id, event["turnId"])
        return LeakRun(events, candidates, model, filter_calls)

    def leaks(self, user: str, run: PipelineRun) -> list[LeakFinding]:
        passed_denied: list[LeakFinding] = []
        if isinstance(run, LeakRun):
            passed_denied = [
                (self.titles[page_id], "passed the filter")
                for page_id in sorted(run.passing_page_ids)
                if page_id in self.titles and not self.access.may_view(user, page_id)
            ]
        if not run.model.calls:
            return passed_denied
        prompt = run.model.calls[-1]
        viewable_titles = {self.titles[page_id] for page_id in self.access.viewable_pages(user)}
        sources = source_blocks(run.sources_block)
        searched = "\n".join(
            [body for title, body in sources if title not in viewable_titles]
            + [message["content"] for message in prompt if message["role"] == "assistant"]
        )
        source_titles = {title for title, _ in sources}
        whole_prompt = "\n".join(message["content"] for message in prompt)
        found: list[LeakFinding] = passed_denied
        for page_id, texts in self.section_texts.items():
            if self.access.may_view(user, page_id):
                continue
            title = self.titles[page_id]
            if title in source_titles:
                found.append((title, title))
            found.extend(
                (title, text)
                for text in texts
                if len(text) >= MIN_SECTION_LENGTH and text in searched
            )
            canary = self.canaries.get(page_id)
            if canary is not None and canary in whole_prompt:
                found.append((title, canary))
        return found


def required_variables() -> dict[str, str]:
    missing = [name for name in LEAK_VARIABLES if not os.environ.get(name)]
    if missing:
        pytest.fail(f"no leak-check stack configured, set {', '.join(missing)}")
    return {name: os.environ[name] for name in LEAK_VARIABLES}


def active_embedder() -> Embedder:
    model = os.environ.get(EMBEDDING_MODEL_VARIABLE)
    return FastEmbedEmbedder(model) if model else HashingEmbedder()


def threshold_for(embedder: Embedder) -> float:
    return EVERY_CANDIDATE_THRESHOLD if isinstance(embedder, HashingEmbedder) else THRESHOLD


def user_ids_by_key(owner: Member) -> dict[str, str]:
    response = owner.session.post("/api/workspace/members", json={"limit": LIST_LIMIT})
    assert response.status_code == 200, response.text
    by_email = {item["email"]: item["id"] for item in response.json()["data"]["items"]}
    return {key: by_email[email] for key, email in SEED_EMAILS.items()}


def space_ids_by_dir(owner: Member) -> dict[str, str]:
    response = owner.session.post("/api/spaces", json={"limit": LIST_LIMIT})
    assert response.status_code == 200, response.text
    by_name = {item["name"]: item["id"] for item in response.json()["data"]["items"]}
    return {space_dir: by_name[name] for space_dir, name in SPACE_NAMES.items()}


@pytest.fixture(scope="module")
def leak_stack() -> Iterator[LeakStack]:
    variables = required_variables()
    owner = log_in(
        variables["LEAK_WIKI_URL"],
        "GF",
        variables["LEAK_BRIDGE_SECRET"],
        variables["LEAK_SEED_PASSWORD"],
    )
    bridge = BridgeClient(variables["LEAK_WIKI_URL"], variables["LEAK_SERVICE_TOKEN"])
    space_ids = space_ids_by_dir(owner)
    listed = list_all_pages(bridge)
    contents = {page.id: bridge.page_content(page.id) for page in listed}
    titles = {page_id: content.title for page_id, content in contents.items()}
    canary_entries = load_entries(CANARIES_PATH)
    canary_by_title = {entry["title"]: entry for entry in canary_entries}
    assert canary_by_title.keys() <= set(titles.values()), "a canary page is missing in the wiki"
    space_dirs = {space_id: space_dir for space_dir, space_id in space_ids.items()}
    access = AccessModel(
        space_dirs=space_dirs,
        page_spaces={page.id: page.space_id for page in listed},
        denied_users={
            page_id: frozenset(canary_by_title.get(title, {}).get("deniedUsers", []))
            for page_id, title in titles.items()
        },
    )
    unknown_spaces = {page.space_id for page in listed} - space_dirs.keys()
    assert not unknown_spaces, f"pages in spaces outside the seed matrix: {unknown_spaces}"
    redis: Redis = Redis.from_url(variables["LEAK_REDIS_URL"], decode_responses=True)
    with psycopg.connect(variables["LEAK_AI_DATABASE_URL"], autocommit=True) as conn:
        store = IndexStore(conn)
        embedder = active_embedder()
        stack = LeakStack(
            bridge=bridge,
            store=store,
            embedder=embedder,
            redis=redis,
            owner=owner,
            bridge_secret=variables["LEAK_BRIDGE_SECRET"],
            user_ids=user_ids_by_key(owner),
            space_ids=space_ids,
            titles=titles,
            canaries={
                page_id: canary_by_title[title]["canary"]
                for page_id, title in titles.items()
                if title in canary_by_title
            },
            access=access,
            threshold=threshold_for(embedder),
        )
        with store.writer_lock():
            store.remove_pages([entry.page_id for entry in store.list_entries()])
        for page in listed:
            assert stack.index_page(page.id) == IndexOutcome.INDEXED, titles[page.id]
        too_short = [
            titles[page_id]
            for page_id in titles
            if not all(access.may_view(user, page_id) for user in SEED_USERS)
            and not any(len(text) >= MIN_SECTION_LENGTH for text in stack.section_texts[page_id])
        ]
        assert too_short == [], f"denied pages without a detectable section: {too_short}"
        try:
            yield stack
        finally:
            owner.session.close()
            redis.close()
