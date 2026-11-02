import os
import re
import time
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import psycopg
import pytest
from redis import Redis

from ai_service.ask import (
    MAX_SOURCES,
    AskPipeline,
    AskRequest,
    FilterPages,
    SearchSections,
    in_scope,
    scope_space_ids,
)
from ai_service.bridge_client import BridgeClient, PageContent
from ai_service.conversations import ConversationStore
from ai_service.embedding import Embedder, FastEmbedEmbedder
from ai_service.index_store import IndexStore, SearchHit
from ai_service.indexer import Indexer, IndexOutcome
from ai_service.prompt import build_messages, format_source
from ai_service.search import search_index
from ai_service.wiki_session import SEED_EMAILS
from tests.conftest import WORKSPACE_ID, RecordingRequestLog
from tests.hashing_embedder import HashingEmbedder
from tests.seed_matrix import (
    CANARIES_PATH,
    LEAK_QUESTIONS_PATH,
    SEED_USERS,
    SPACE_DIRS,
    SPACE_MEMBERS,
    SeedPage,
    load_entries,
    load_seed_pages,
    sentences_of,
)
from tests.test_ask import StubModel
from tests.test_stack import POLL_SECONDS, list_all_pages
from tests.test_stack_ask import (
    MIN_SECTION_LENGTH,
    MOVE_WAIT_SECONDS,
    SEED_PASSWORD,
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
)
SEED_PASSWORD_VARIABLE = "LEAK_SEED_PASSWORD"
EMBEDDING_MODEL_VARIABLE = "LEAK_EMBEDDING_MODEL"
WORKER_RUNNING_VARIABLE = "LEAK_WORKER_RUNNING"
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
RECORDED_QUESTION = "Was steht in den Quellen?"
PASSED_THE_FILTER = "passed the filter"
HEADER_PROBE_NUMBER = 424242
HEADER_PROBE_TITLE = "header-probe-title"

LeakFinding = tuple[str, str]
SpaceMember = tuple[str, str, str]
WikiItem = dict[str, Any]


def section_hit(
    page_id: str,
    title: str,
    text: str,
    space_id: str = "",
    file_name: str | None = None,
    pdf_page: int | None = None,
) -> SearchHit:
    return SearchHit(
        page_id=page_id,
        title=title,
        space_id=space_id,
        heading_path=[],
        text=text,
        score=VIEWABLE_SCORE,
        attachment_id=None if file_name is None else f"attachment-{page_id}",
        file_name=file_name,
        pdf_page=pdf_page,
    )


def source_header_pattern() -> re.Pattern[str]:
    probe = section_hit("", HEADER_PROBE_TITLE, "")
    header = format_source(HEADER_PROBE_NUMBER, probe).split("\n", 1)[0]
    assert str(HEADER_PROBE_NUMBER) in header and HEADER_PROBE_TITLE in header, header
    pattern = (
        re.escape(header)
        .replace(str(HEADER_PROBE_NUMBER), r"\d+")
        .replace(re.escape(HEADER_PROBE_TITLE), "(.*)")
    )
    return re.compile(f"(?m)^{pattern}$")


SOURCE_HEADER = source_header_pattern()


def source_blocks(sources_block: str) -> list[tuple[str, str]]:
    blocks = SOURCE_HEADER.split(sources_block)[1:]
    return [(title, body) for title, body in zip(blocks[::2], blocks[1::2], strict=True)]


def leak_questions() -> list[str]:
    return [entry["question"] for entry in load_entries(LEAK_QUESTIONS_PATH)]


@dataclass(frozen=True)
class LeakRun(PipelineRun):
    filter_calls: list[list[str]] = field(default_factory=list)
    sent_sources: int = 0

    @property
    def passing_page_ids(self) -> set[str]:
        return {page_id for passing in self.filter_calls for page_id in passing}


def sent_source_count(
    candidates: Sequence[SearchHit],
    filter_calls: Sequence[Sequence[str]],
    space_ids: Sequence[str],
    page_id: str | None,
    threshold: float,
) -> int:
    if not filter_calls:
        return 0
    passing = set(filter_calls[0])
    sendable = [
        hit
        for hit in candidates
        if hit.page_id in passing and hit.score >= threshold and in_scope(hit, space_ids, page_id)
    ]
    return min(len(sendable), MAX_SOURCES)


def prompt_run(
    hits: Sequence[SearchHit],
    history: Sequence[tuple[str, str | None]] = (),
    sent_sources: int | None = None,
) -> LeakRun:
    model = StubModel()
    model.calls.append(build_messages(RECORDED_QUESTION, hits, history))
    sent = len(hits) if sent_sources is None else sent_sources
    return LeakRun([], [], model, sent_sources=sent)


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

    def add_member(self, user: str, space_dir: str) -> None:
        self.members[user].add(space_dir)

    def move_page(self, page_id: str, space_id: str) -> None:
        self.page_spaces[page_id] = space_id

    def trash_page(self, page_id: str) -> None:
        self.trashed.add(page_id)

    def restore_page(self, page_id: str) -> None:
        self.trashed.discard(page_id)

    def pages_in(self, space_dir: str) -> set[str]:
        return {
            page_id
            for page_id, space_id in self.page_spaces.items()
            if self.space_dirs[space_id] == space_dir
        }


@dataclass(frozen=True)
class PageState:
    space_id: str
    parent_page_id: str | None
    trashed: bool


@dataclass(frozen=True)
class WikiSnapshot:
    spaces: dict[str, str]
    space_members: dict[str, frozenset[SpaceMember]]
    group_members: dict[str, frozenset[str]]
    pages: dict[str, PageState]
    index: dict[str, str]

    def index_problems(self) -> list[str]:
        problems = [
            f"{page_id} is in the trash and in the index"
            for page_id, state in self.pages.items()
            if state.trashed and page_id in self.index
        ]
        problems.extend(
            f"{page_id} has no index entry in its space {state.space_id}"
            for page_id, state in self.pages.items()
            if not state.trashed and self.index.get(page_id) != state.space_id
        )
        problems.extend(
            f"{page_id} is in the index but not in the wiki"
            for page_id in self.index.keys() - self.pages.keys()
        )
        return problems

    def member_spaces(self, user_id: str) -> set[str]:
        groups = {
            group_id for group_id, user_ids in self.group_members.items() if user_id in user_ids
        }
        return {
            self.spaces[space_id]
            for space_id, members in self.space_members.items()
            for kind, member_id, _ in members
            if (kind, member_id) == ("user", user_id) or (kind == "group" and member_id in groups)
        }


@dataclass
class LeakDetector:
    titles: dict[str, str]
    canaries: dict[str, str]
    access: AccessModel
    section_texts: dict[str, list[str]] = field(default_factory=dict)

    def leaks(self, user: str, run: LeakRun) -> list[LeakFinding]:
        passed_denied = [
            (self.titles[page_id], PASSED_THE_FILTER)
            for page_id in sorted(run.passing_page_ids)
            if page_id in self.titles and not self.access.may_view(user, page_id)
        ]
        if not run.model.calls:
            return passed_denied
        prompt = run.model.calls[-1]
        viewable_titles = {self.titles[page_id] for page_id in self.access.viewable_pages(user)}
        sources = source_blocks(run.sources_block)
        assert len(sources) == run.sent_sources, (
            f"parsed {len(sources)} source blocks, the pipeline sent {run.sent_sources}"
        )
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


@dataclass(kw_only=True)
class LeakStack(LeakDetector):
    bridge: BridgeClient
    store: IndexStore
    embedder: Embedder
    redis: Redis
    owner: Member
    bridge_secret: str
    user_ids: dict[str, str]
    space_ids: dict[str, str]
    threshold: float

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

    def sections_in_prompt(self, run: PipelineRun, page_id: str) -> list[str]:
        return [
            text
            for text in self.section_texts[page_id]
            if len(text) >= MIN_SECTION_LENGTH and text in run.sources_block
        ]

    def post(self, path: str, body: WikiItem) -> WikiItem:
        response = self.owner.session.post(path, json=body)
        assert response.status_code == 200, f"{path} {body}: {response.status_code} {response.text}"
        return response.json() if response.content else {}

    def listed(self, path: str, body: WikiItem) -> list[WikiItem]:
        data = self.post(path, {**body, "limit": LIST_LIMIT})["data"]
        assert not data["meta"]["hasNextPage"], f"{path} {body} lists more than {LIST_LIMIT} items"
        return data["items"]

    def group_id(self, name: str) -> str:
        [group_id] = [
            group["id"] for group in self.listed("/api/groups", {}) if group["name"] == name
        ]
        return group_id

    def space_role(self, user: str, space_dir: str) -> str:
        [role] = [
            member["role"]
            for member in self.listed("/api/spaces/members", {"spaceId": self.space_ids[space_dir]})
            if member["type"] == "user" and member["id"] == self.user_ids[user]
        ]
        return role

    def page_state(self, page_id: str) -> PageState:
        page = self.post("/api/pages/info", {"pageId": page_id})["data"]
        return PageState(page["spaceId"], page["parentPageId"], page["deletedAt"] is not None)

    def snapshot(self) -> WikiSnapshot:
        spaces = {space["id"]: space["name"] for space in self.listed("/api/spaces", {})}
        pages = {page.id: self.page_state(page.id) for page in list_all_pages(self.bridge)}
        for space_id in spaces:
            for page in self.listed("/api/pages/trash", {"spaceId": space_id}):
                pages[page["id"]] = PageState(page["spaceId"], page["parentPageId"], True)
        return WikiSnapshot(
            spaces=spaces,
            space_members={
                space_id: frozenset(
                    (member["type"], member["id"], member["role"])
                    for member in self.listed("/api/spaces/members", {"spaceId": space_id})
                )
                for space_id in spaces
            },
            group_members={
                group["id"]: frozenset(
                    user["id"]
                    for user in self.listed("/api/groups/members", {"groupId": group["id"]})
                )
                for group in self.listed("/api/groups", {})
            },
            pages=pages,
            index={entry.page_id: entry.space_id for entry in self.store.list_entries()},
        )

    def wait_for_worker(self, page_id: str, reached: Callable[[str | None], bool]) -> None:
        if os.environ.get(WORKER_RUNNING_VARIABLE) != "1":
            return
        deadline = time.monotonic() + MOVE_WAIT_SECONDS
        while not reached(
            None if (entry := self.store.get_entry(page_id)) is None else entry.space_id
        ):
            assert time.monotonic() < deadline, f"worker did not update {page_id}"
            time.sleep(POLL_SECONDS)

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
            request_log=RecordingRequestLog(),
        )
        request = AskRequest(
            question=question,
            conversation_id=conversation_id or str(uuid.uuid4()),
            space_id=space_id,
            page_id=page_id,
        )
        user_id = self.user_ids[user]
        events = list(
            pipeline.ask(
                request, user_id, WORKSPACE_ID, self.token_space_ids(user), self.token(user)
            )
        )
        errors = [event for event in events if event["type"] == "error"]
        assert errors == [], f"{user} asking {question!r}: {errors}"
        for event in events:
            if event["type"] == "citations":
                conversations.confirm(user_id, request.conversation_id, event["turnId"])
        sent = sent_source_count(
            candidates,
            filter_calls,
            scope_space_ids(self.token_space_ids(user), space_id),
            page_id,
            self.threshold,
        )
        return LeakRun(events, candidates, model, filter_calls, sent)


@contextmanager
def removed_from_space(stack: LeakStack, user: str, space_dir: str) -> Iterator[None]:
    space_id = stack.space_ids[space_dir]
    user_id = stack.user_ids[user]
    role = stack.space_role(user, space_dir)
    try:
        stack.post("/api/spaces/members/remove", {"spaceId": space_id, "userId": user_id})
        stack.access.remove_member(user, space_dir)
        yield
    finally:
        stack.post(
            "/api/spaces/members/add",
            {"spaceId": space_id, "role": role, "userIds": [user_id], "groupIds": []},
        )
        stack.access.add_member(user, space_dir)


@contextmanager
def removed_from_group(
    stack: LeakStack, user: str, group_name: str, space_dir: str
) -> Iterator[None]:
    group_id = stack.group_id(group_name)
    user_id = stack.user_ids[user]
    try:
        stack.post("/api/groups/members/remove", {"groupId": group_id, "userId": user_id})
        stack.access.remove_member(user, space_dir)
        yield
    finally:
        stack.post("/api/groups/members/add", {"groupId": group_id, "userIds": [user_id]})
        stack.access.add_member(user, space_dir)


@contextmanager
def moved_with_stale_index(stack: LeakStack, page_id: str, space_dir: str) -> Iterator[None]:
    old_space_id = stack.access.page_spaces[page_id]
    new_space_id = stack.space_ids[space_dir]
    try:
        stack.post("/api/pages/move-to-space", {"pageId": page_id, "spaceId": new_space_id})
        stack.access.move_page(page_id, new_space_id)
        stack.wait_for_worker(page_id, lambda space_id: space_id == new_space_id)
        with stack.store.writer_lock():
            stack.store.rescope([page_id], old_space_id)
        yield
    finally:
        if stack.page_state(page_id).space_id != old_space_id:
            stack.post("/api/pages/move-to-space", {"pageId": page_id, "spaceId": old_space_id})
        stack.access.move_page(page_id, old_space_id)
        assert stack.index_page(page_id) == IndexOutcome.INDEXED, page_id


@contextmanager
def trashed_with_stale_index(stack: LeakStack, page_id: str) -> Iterator[None]:
    entry = stack.store.get_entry(page_id)
    assert entry is not None, f"{page_id} is not indexed"
    sections = stack.store.sections_of(page_id)
    try:
        stack.post("/api/pages/delete", {"pageId": page_id})
        stack.access.trash_page(page_id)
        stack.wait_for_worker(page_id, lambda space_id: space_id is None)
        with stack.store.writer_lock():
            assert stack.store.replace_page(entry, sections), page_id
        yield
    finally:
        stack.post("/api/pages/restore", {"pageId": page_id})
        stack.access.restore_page(page_id)
        assert stack.index_page(page_id) == IndexOutcome.INDEXED, page_id


def required_variables() -> dict[str, str]:
    missing = [name for name in LEAK_VARIABLES if not os.environ.get(name)]
    if missing:
        pytest.fail(f"no leak-check stack configured, set {', '.join(missing)}")
    variables = {name: os.environ[name] for name in LEAK_VARIABLES}
    variables[SEED_PASSWORD_VARIABLE] = os.environ.get(SEED_PASSWORD_VARIABLE) or SEED_PASSWORD
    return variables


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


def seed_mismatches(
    contents: Mapping[str, PageContent],
    space_ids: Mapping[str, str],
    seed_pages: Sequence[SeedPage],
) -> list[str]:
    problems: list[str] = []
    matched: set[str] = set()
    for content in contents.values():
        seeds = [seed for seed in seed_pages if sentences_of(seed.markdown)[0] in content.markdown]
        if len(seeds) != 1:
            problems.append(f"{content.title!r} matches {len(seeds)} seed pages")
            continue
        [seed] = seeds
        if seed.page_id in matched:
            problems.append(
                f"{content.title!r} is a second wiki page for the seed page {seed.title}"
            )
        matched.add(seed.page_id)
        if content.space_id != space_ids[seed.space_dir]:
            problems.append(
                f"{content.title!r} is in the space {content.space_id}, "
                f"the seed puts it in {seed.space_dir}"
            )
        if seed.canary is not None and content.title != seed.title:
            problems.append(f"{content.title!r} has another title than the seed: {seed.title}")
    problems.extend(
        f"the seed page {seed.space_dir}/{seed.title} is not in the wiki"
        for seed in seed_pages
        if seed.page_id not in matched
    )
    return problems


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
    mismatches = seed_mismatches(contents, space_ids, load_seed_pages())
    assert mismatches == [], f"the wiki does not hold the seed pages: {mismatches}"
    assert {page.id: page.space_id for page in listed} == {
        page_id: content.space_id for page_id, content in contents.items()
    }, "the page list and the page contents disagree on the spaces"
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
