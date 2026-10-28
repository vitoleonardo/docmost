import json
import logging
import threading
import time
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass, field

import fakeredis
import httpx
import psycopg
import pytest
from redis import Redis

from ai_service.bridge_client import PAGE_CONTENT_PATH
from ai_service.index_lock import index_writer_lock
from ai_service.index_store import IndexStore, StoredSection
from ai_service.indexer import Indexer
from ai_service.jobs import (
    FORWARDED_JOB_FIELDS,
    JOB_STREAM,
    JobConsumer,
    WriterLock,
    enqueue_job,
)
from ai_service.search import search_index
from tests.conftest import FakeClock, warnings
from tests.fake_bridge import TOKEN, mock_client, refuse
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import (
    SPACE_A,
    SPACE_B,
    SPACE_C,
    UPDATED_AT,
    WORKSPACE_A,
    WORKSPACE_B,
    attachment_id,
    index_page,
    indexed_ids,
    make_entry,
    page_id,
)
from tests.test_contract import CONTRACT
from tests.test_db_role import AI_URL

GROUP = "indexer"
SECRET_TITLE = "Geheimtitel Quartalszahlen"
SECRET_TEXT = "Vertrauliche Umsatzzahlen stehen nur hier"
BLOCK_MS = 10


class WorkerStopped(BaseException):
    pass


@dataclass
class WikiPage:
    space_id: str = SPACE_A
    workspace_id: str = WORKSPACE_A
    title: str = "Urlaubsregeln"
    markdown: str = "# Antrag\n\nUrlaub beantragt man zwei Wochen vorher."


@dataclass
class FakeWiki:
    pages: dict[str, WikiPage] = field(default_factory=dict)
    failure: Callable[[], httpx.Response] | None = None
    requests: list[str] = field(default_factory=list)
    on_request: Callable[[], None] | None = None

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == PAGE_CONTENT_PATH
        requested = json.loads(request.content)["pageId"]
        self.requests.append(requested)
        if self.on_request is not None:
            self.on_request()
        if self.failure is not None:
            return self.failure()
        page = self.pages.get(requested)
        if page is None:
            return httpx.Response(404, json={"code": "page_not_found", "message": "gone"})
        return httpx.Response(
            200,
            json={
                "id": requested,
                "title": page.title,
                "spaceId": page.space_id,
                "workspaceId": page.workspace_id,
                "updatedAt": UPDATED_AT.isoformat(),
                "markdown": page.markdown,
                "attachments": [],
            },
        )


def time_out() -> httpx.Response:
    raise httpx.ReadTimeout("no answer")


def answer(status: int, code: str) -> Callable[[], httpx.Response]:
    return lambda: httpx.Response(status, json={"code": code, "message": "failure"})


def crash() -> httpx.Response:
    raise WorkerStopped()


@pytest.fixture
def server() -> fakeredis.FakeServer:
    return fakeredis.FakeServer()


@pytest.fixture
def redis(server: fakeredis.FakeServer) -> Redis:
    return fakeredis.FakeRedis(server=server, decode_responses=True)


@pytest.fixture
def wiki() -> FakeWiki:
    return FakeWiki()


ConsumerFactory = Callable[..., JobConsumer]


@pytest.fixture
def make_consumer(
    redis: Redis, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder, clock: FakeClock
) -> ConsumerFactory:
    def make(
        redis_client: Redis = redis,
        index_store: IndexStore = store,
        writer_lock: WriterLock = nullcontext,
    ) -> JobConsumer:
        indexer = Indexer(mock_client(wiki.handle), index_store, embedder)
        return JobConsumer(redis_client, indexer, index_store, writer_lock, sleep=clock.sleep)

    return make


@pytest.fixture
def consumer(make_consumer: ConsumerFactory) -> JobConsumer:
    return make_consumer()


def pending_count(redis: Redis) -> int:
    return redis.xpending(JOB_STREAM, GROUP)["pending"]


def page_job(*numbers: int) -> dict[str, object]:
    return {"pageIds": [page_id(number) for number in numbers], "workspaceId": WORKSPACE_A}


def seed(
    store: IndexStore,
    embedder: HashingEmbedder,
    number: int,
    space_id: str = SPACE_A,
    workspace_id: str = WORKSPACE_A,
    with_pdf: bool = False,
) -> None:
    entry = make_entry(number, space_id=space_id, workspace_id=workspace_id)
    texts = [f"Abschnitt {number} der Seite {number}", f"Zweiter Absatz {number}"]
    sections = index_page(store, embedder, entry, texts)
    if not with_pdf:
        return
    pdf_text = f"PDF Inhalt {number}"
    pdf = StoredSection(
        len(sections),
        [],
        pdf_text,
        embedder.embed([pdf_text])[0],
        attachment_id(number),
        "a.pdf",
        1,
    )
    assert store.replace_page(entry, [*sections, pdf])


def test_index_ac54_required_fields_per_job_equal_the_contract_table():
    table = {name: list(fields) for name, fields in FORWARDED_JOB_FIELDS.items()}
    assert table == CONTRACT["jobs"]["forwarded"]


@pytest.mark.integration
def test_index_ac24_soft_deleted_parent_and_child_leave_the_index(
    consumer: JobConsumer, redis: Redis, store: IndexStore, embedder: HashingEmbedder
):
    for number in (1, 2, 3):
        seed(store, embedder, number)
    enqueue_job(redis, "page-soft-deleted", page_job(1, 2))

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(3)]
    assert store.sections_of(page_id(1)) == []
    assert store.sections_of(page_id(2)) == []
    assert pending_count(redis) == 0


@pytest.mark.integration
def test_index_ac25_restored_page_is_indexed_with_its_sections(
    consumer: JobConsumer, redis: Redis, store: IndexStore, wiki: FakeWiki
):
    wiki.pages[page_id(1)] = WikiPage()
    enqueue_job(redis, "page-restored", page_job(1))

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(1)]
    assert [section.text for section in store.sections_of(page_id(1))] == [
        "Urlaub beantragt man zwei Wochen vorher."
    ]


@pytest.mark.integration
def test_index_ac26_permanently_deleted_page_leaves_the_index(
    consumer: JobConsumer, redis: Redis, store: IndexStore, embedder: HashingEmbedder
):
    seed(store, embedder, 1)
    seed(store, embedder, 2)
    enqueue_job(redis, "page-deleted", page_job(1))

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(2)]
    assert store.sections_of(page_id(1)) == []


@pytest.mark.integration
def test_index_ac27_moved_parent_and_child_get_the_new_space(
    consumer: JobConsumer, redis: Redis, store: IndexStore, embedder: HashingEmbedder
):
    seed(store, embedder, 1)
    seed(store, embedder, 2)
    data = {**page_job(1, 2), "spaceId": SPACE_B}
    enqueue_job(redis, "page-moved-to-space", data)

    assert consumer.process_next(BLOCK_MS)

    assert [entry.space_id for entry in store.list_entries()] == [SPACE_B, SPACE_B]
    for number in (1, 2):
        question = f"Abschnitt {number} der Seite {number}"
        old_space = search_index(store, embedder, question, [SPACE_A])
        new_space = search_index(store, embedder, question, [SPACE_B])
        assert old_space == []
        assert page_id(number) in [hit.page_id for hit in new_space]


@pytest.mark.integration
def test_index_ac28_space_deleted_removes_its_pages_and_pdf_sections_only(
    consumer: JobConsumer, redis: Redis, store: IndexStore, embedder: HashingEmbedder
):
    seed(store, embedder, 1, SPACE_A, with_pdf=True)
    seed(store, embedder, 2, SPACE_A)
    seed(store, embedder, 3, SPACE_B, with_pdf=True)
    enqueue_job(redis, "space-deleted", {"spaceId": SPACE_A, "workspaceId": WORKSPACE_A})

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(3)]
    assert store.sections_of(page_id(1)) == []
    assert store.sections_of(page_id(2)) == []
    assert [section.attachment_id for section in store.sections_of(page_id(3))] == [
        None,
        None,
        attachment_id(3),
    ]


@pytest.mark.integration
def test_index_ac29_workspace_deleted_removes_its_pages_and_pdf_sections_only(
    consumer: JobConsumer, redis: Redis, store: IndexStore, embedder: HashingEmbedder
):
    seed(store, embedder, 1, SPACE_A, WORKSPACE_A, with_pdf=True)
    seed(store, embedder, 2, SPACE_B, WORKSPACE_A)
    seed(store, embedder, 3, SPACE_C, WORKSPACE_B, with_pdf=True)
    enqueue_job(redis, "workspace-deleted", {"workspaceId": WORKSPACE_A})

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(3)]
    assert store.sections_of(page_id(1)) == []
    assert store.sections_of(page_id(2)) == []
    assert len(store.sections_of(page_id(3))) == 3


@pytest.mark.integration
def test_index_ac30_content_update_naming_several_pages_indexes_each(
    consumer: JobConsumer, redis: Redis, store: IndexStore, wiki: FakeWiki
):
    for number in (1, 2, 3):
        wiki.pages[page_id(number)] = WikiPage(markdown=f"Text der Seite Nummer {number}")
    enqueue_job(redis, "page-content-updated", page_job(1, 2, 3))

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(1), page_id(2), page_id(3)]
    for number in (1, 2, 3):
        texts = [section.text for section in store.sections_of(page_id(number))]
        assert texts == [f"Text der Seite Nummer {number}"]


@pytest.mark.integration
@pytest.mark.parametrize(
    "fields",
    [
        {"name": "page-renamed", "data": json.dumps({"pageIds": [], "workspaceId": WORKSPACE_A})},
        {"name": "page-created", "data": "{not json"},
        {"name": "page-deleted", "data": json.dumps({"workspaceId": WORKSPACE_A})},
        {"name": "page-deleted", "data": json.dumps({"pageIds": "x", "workspaceId": WORKSPACE_A})},
        {"name": "page-deleted", "data": json.dumps({"pageIds": [1], "workspaceId": WORKSPACE_A})},
        {"name": "page-deleted", "data": json.dumps({"pageIds": []})},
        {"name": "space-deleted", "data": json.dumps({"spaceId": 7, "workspaceId": WORKSPACE_A})},
        {"name": "workspace-deleted", "data": json.dumps([WORKSPACE_A])},
        {"name": "workspace-deleted"},
    ],
    ids=[
        "unknown-name",
        "invalid-json",
        "missing-page-ids",
        "page-ids-not-a-list",
        "page-id-not-a-string",
        "missing-workspace-id",
        "space-id-not-a-string",
        "data-not-an-object",
        "data-missing",
    ],
)
def test_index_ac54_invalid_job_is_acked_with_a_warning_and_the_next_job_runs(
    consumer: JobConsumer,
    redis: Redis,
    store: IndexStore,
    embedder: HashingEmbedder,
    caplog: pytest.LogCaptureFixture,
    fields: dict[str, str],
):
    seed(store, embedder, 1)
    seed(store, embedder, 2)
    before = store.list_entries()
    entry_id = str(redis.xadd(JOB_STREAM, {**fields, "receivedAt": UPDATED_AT.isoformat()}))

    assert consumer.process_next(BLOCK_MS)

    assert store.list_entries() == before
    assert pending_count(redis) == 0
    assert [line for line in warnings(caplog) if fields["name"] in line and entry_id in line]

    enqueue_job(redis, "page-deleted", page_job(2))
    assert consumer.process_next(BLOCK_MS)
    assert indexed_ids(store) == [page_id(1)]


@pytest.mark.integration
def test_index_ac54_entry_without_name_is_acked_with_a_warning(
    consumer: JobConsumer, redis: Redis, caplog: pytest.LogCaptureFixture
):
    entry_id = str(redis.xadd(JOB_STREAM, {"data": "{}"}))

    assert consumer.process_next(BLOCK_MS)

    assert pending_count(redis) == 0
    assert [line for line in warnings(caplog) if entry_id in line]


@pytest.mark.integration
def test_process_next_returns_false_when_no_job_arrives(consumer: JobConsumer):
    assert not consumer.process_next(BLOCK_MS)


@pytest.mark.integration
def test_a_second_consumer_on_the_same_stream_reuses_the_group(
    make_consumer: ConsumerFactory, redis: Redis
):
    make_consumer()
    make_consumer()

    assert [group["name"] for group in redis.xinfo_groups(JOB_STREAM)] == [GROUP]


@pytest.mark.integration
def test_index_ac55_refused_connection_keeps_the_job_pending_with_a_warning(
    consumer: JobConsumer,
    redis: Redis,
    store: IndexStore,
    wiki: FakeWiki,
    clock: FakeClock,
    caplog: pytest.LogCaptureFixture,
):
    wiki.pages[page_id(1)] = WikiPage()
    wiki.failure = refuse
    entry_id = enqueue_job(redis, "page-created", page_job(1))

    assert consumer.process_next(BLOCK_MS)

    assert pending_count(redis) == 1
    assert indexed_ids(store) == []
    assert clock.sleeps == [10]
    assert [
        line
        for line in warnings(caplog)
        if "page-created" in line and entry_id in line and "bridge not reachable" in line
    ]


@pytest.mark.integration
def test_index_ac56_job_runs_within_15_s_after_the_bridge_answers_again(
    consumer: JobConsumer, redis: Redis, store: IndexStore, wiki: FakeWiki, clock: FakeClock
):
    wiki.pages[page_id(1)] = WikiPage()
    wiki.failure = refuse
    attempts: list[tuple[float, bool]] = []

    def record_attempt() -> None:
        attempts.append((clock.now, wiki.failure is None))

    def bridge_back() -> None:
        wiki.failure = None

    wiki.on_request = record_attempt
    clock.on_sleep = bridge_back
    enqueue_job(redis, "page-created", page_job(1))

    assert consumer.process_next(BLOCK_MS)
    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(1)]
    assert pending_count(redis) == 0
    assert [succeeds for _, succeeds in attempts] == [False, True]
    assert attempts[1][0] - attempts[0][0] <= 15


@pytest.mark.integration
@pytest.mark.parametrize(
    ("failure", "cause"),
    [
        (time_out, "bridge did not answer in time"),
        (answer(500, "internal_error"), "bridge answered 500"),
        (answer(503, "assistant_disabled"), "bridge answered 503 assistant_disabled"),
        (answer(401, "service_token_invalid"), "bridge answered 401 service_token_invalid"),
    ],
    ids=["timeout", "server-error", "assistant-disabled", "service-token-invalid"],
)
def test_index_ac57_unavailable_bridge_is_retried_every_10_s(
    consumer: JobConsumer,
    redis: Redis,
    store: IndexStore,
    wiki: FakeWiki,
    clock: FakeClock,
    caplog: pytest.LogCaptureFixture,
    failure: Callable[[], httpx.Response],
    cause: str,
):
    wiki.pages[page_id(1)] = WikiPage()
    wiki.failure = failure
    enqueue_job(redis, "page-content-updated", page_job(1))

    for _ in range(4):
        assert consumer.process_next(BLOCK_MS)

    assert clock.sleeps == [10, 10, 10, 10]
    assert wiki.requests == [page_id(1)] * 4
    assert pending_count(redis) == 1
    assert indexed_ids(store) == []
    assert len([line for line in warnings(caplog) if cause in line]) == 4


@pytest.mark.integration
def test_unreachable_ai_database_keeps_the_job_pending_and_retries_every_10_s(
    make_consumer: ConsumerFactory,
    redis: Redis,
    clock: FakeClock,
    caplog: pytest.LogCaptureFixture,
):
    closed = psycopg.connect(AI_URL, autocommit=True)
    closed.close()
    consumer = make_consumer(index_store=IndexStore(closed))
    entry_id = enqueue_job(redis, "page-deleted", page_job(1))

    assert consumer.process_next(BLOCK_MS)
    assert consumer.process_next(BLOCK_MS)

    assert clock.sleeps == [10, 10]
    assert pending_count(redis) == 1
    assert [line for line in warnings(caplog) if entry_id in line and "OperationalError" in line]


@pytest.mark.integration
def test_index_ac58_other_error_is_tried_3_times_then_skipped_and_the_next_job_runs(
    consumer: JobConsumer,
    redis: Redis,
    store: IndexStore,
    embedder: HashingEmbedder,
    wiki: FakeWiki,
    clock: FakeClock,
    caplog: pytest.LogCaptureFixture,
):
    seed(store, embedder, 2)
    wiki.pages[page_id(1)] = WikiPage()
    wiki.failure = answer(400, "invalid_request")
    entry_id = enqueue_job(redis, "page-created", page_job(1))
    enqueue_job(redis, "page-deleted", page_job(2))

    assert consumer.process_next(BLOCK_MS)

    assert wiki.requests == [page_id(1)] * 3
    assert clock.sleeps == []
    assert pending_count(redis) == 0
    skipped = [
        line
        for line in warnings(caplog)
        if "skipped" in line and "page-created" in line and entry_id in line
    ]
    assert len(skipped) == 1
    assert "BridgeError" in skipped[0]

    assert consumer.process_next(BLOCK_MS)
    assert indexed_ids(store) == []


@pytest.mark.integration
def test_index_ac58_a_failed_attempt_followed_by_a_success_indexes_the_page(
    consumer: JobConsumer,
    redis: Redis,
    store: IndexStore,
    wiki: FakeWiki,
    caplog: pytest.LogCaptureFixture,
):
    wiki.pages[page_id(1)] = WikiPage()
    wiki.failure = answer(400, "invalid_request")

    def recover_on_second_request() -> None:
        if len(wiki.requests) == 2:
            wiki.failure = None

    wiki.on_request = recover_on_second_request
    enqueue_job(redis, "page-created", page_job(1))

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(1)]
    assert len(wiki.requests) == 2
    assert pending_count(redis) == 0
    assert len([line for line in warnings(caplog) if "BridgeError" in line]) == 1


@pytest.mark.integration
def test_index_ac59_job_taken_before_a_stop_is_processed_after_the_restart(
    make_consumer: ConsumerFactory,
    server: fakeredis.FakeServer,
    store: IndexStore,
    wiki: FakeWiki,
):
    first_redis = fakeredis.FakeRedis(server=server, decode_responses=True)
    wiki.pages[page_id(1)] = WikiPage()
    wiki.failure = crash
    enqueue_job(first_redis, "page-created", page_job(1))
    with pytest.raises(WorkerStopped):
        make_consumer(redis_client=first_redis).process_next(BLOCK_MS)
    first_redis.close()

    wiki.failure = None
    second_redis = fakeredis.FakeRedis(server=server, decode_responses=True)
    restarted = make_consumer(redis_client=second_redis)

    assert pending_count(second_redis) == 1
    assert restarted.process_next(BLOCK_MS)
    assert indexed_ids(store) == [page_id(1)]
    assert pending_count(second_redis) == 0


@pytest.mark.integration
def test_index_ac59_pending_job_runs_before_newer_jobs(
    consumer: JobConsumer, redis: Redis, store: IndexStore, embedder: HashingEmbedder
):
    seed(store, embedder, 1)
    seed(store, embedder, 2)
    enqueue_job(redis, "page-deleted", page_job(1))
    redis.xreadgroup(GROUP, "worker", {JOB_STREAM: ">"}, count=1)
    enqueue_job(redis, "page-deleted", page_job(2))

    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(2)]
    assert pending_count(redis) == 0


@pytest.mark.integration
@pytest.mark.parametrize("name", ["page-created", "page-content-updated", "page-restored"])
def test_index_ac60_job_processed_twice_lists_the_page_and_its_sections_once(
    consumer: JobConsumer, redis: Redis, store: IndexStore, wiki: FakeWiki, name: str
):
    wiki.pages[page_id(1)] = WikiPage(markdown="# A\n\nErster Absatz.\n\n# B\n\nZweiter Absatz.")
    for _ in range(2):
        enqueue_job(redis, name, page_job(1))

    assert consumer.process_next(BLOCK_MS)
    assert consumer.process_next(BLOCK_MS)

    assert indexed_ids(store) == [page_id(1)]
    assert [section.text for section in store.sections_of(page_id(1))] == [
        "Erster Absatz.",
        "Zweiter Absatz.",
    ]
    assert pending_count(redis) == 0


@pytest.mark.integration
def test_index_ac73_job_log_lines_name_job_entry_and_page_ids_without_content(
    consumer: JobConsumer,
    redis: Redis,
    wiki: FakeWiki,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.DEBUG)
    markdown = f"# {SECRET_TITLE}\n\n{SECRET_TEXT}"
    wiki.pages[page_id(1)] = WikiPage(title=SECRET_TITLE, markdown=markdown)
    wiki.failure = refuse
    failed_id = enqueue_job(redis, "page-created", page_job(1))
    consumer.process_next(BLOCK_MS)
    wiki.failure = answer(400, "invalid_request")
    consumer.process_next(BLOCK_MS)
    wiki.failure = None
    processed_id = enqueue_job(redis, "page-created", page_job(1))
    consumer.process_next(BLOCK_MS)

    lines = [record.getMessage() for record in caplog.records]
    for line in lines:
        assert SECRET_TITLE not in line
        assert SECRET_TEXT not in line
        assert TOKEN not in line
    processed = [line for line in lines if processed_id in line]
    assert processed == [f"job processed page-created {processed_id} pages {page_id(1)}"]
    assert [line for line in lines if failed_id in line and "retry" in line]
    assert [line for line in lines if failed_id in line and "skipped" in line]


@pytest.mark.integration
def test_index_writer_lock_held_elsewhere_delays_the_job_until_released(
    make_consumer: ConsumerFactory,
    redis: Redis,
    store: IndexStore,
    embedder: HashingEmbedder,
):
    seed(store, embedder, 1)
    with (
        psycopg.connect(AI_URL, autocommit=True) as holder_conn,
        psycopg.connect(AI_URL, autocommit=True) as consumer_lock_conn,
    ):
        consumer = make_consumer(writer_lock=lambda: index_writer_lock(consumer_lock_conn))
        enqueue_job(redis, "page-deleted", page_job(1))
        results: list[bool] = []
        worker = threading.Thread(target=lambda: results.append(consumer.process_next(BLOCK_MS)))
        with index_writer_lock(holder_conn):
            worker.start()
            time.sleep(0.5)
            assert worker.is_alive()
            assert indexed_ids(store) == [page_id(1)]
        worker.join(timeout=5)

        assert not worker.is_alive()
        assert results == [True]
        assert indexed_ids(store) == []
        advisory = holder_conn.execute(
            "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'"
        ).fetchone()
        assert advisory == (0,)
