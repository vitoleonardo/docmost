import logging
import threading
import time
from collections.abc import Callable
from contextlib import nullcontext

import fakeredis
import httpx
import psycopg
import pytest

from ai_service.index_lock import index_writer_lock
from ai_service.index_store import IndexStore, PageEntry
from ai_service.indexer import Indexer
from ai_service.jobs import JobConsumer, WriterLock, enqueue_job
from ai_service.reconcile import ReconcileAborted, ReconcileResult, reconcile
from tests.conftest import warnings
from tests.fake_bridge import (
    EMPTY_PAGE,
    PDF_FILE_NAME,
    PDF_ID,
    PDF_PAGE,
    TEXT_PAGES,
    TRASHED_PAGE,
    FakeBridge,
    WikiPage,
    bad_request,
    refuse,
    seed_shaped_bridge,
    server_error,
)
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import (
    SPACE_A,
    SPACE_B,
    SPACE_C,
    WORKSPACE_A,
    later,
    page_id,
)
from tests.test_db_role import AI_URL

pytestmark = pytest.mark.integration

LOCK_WAIT_SECONDS = 0.5


@pytest.fixture
def bridge() -> FakeBridge:
    return seed_shaped_bridge()


Reconcile = Callable[..., ReconcileResult]


@pytest.fixture
def run_reconcile(bridge: FakeBridge, store: IndexStore, embedder: HashingEmbedder) -> Reconcile:
    def run(
        model_embedder: HashingEmbedder = embedder,
        index_store: IndexStore = store,
        lock: WriterLock | None = None,
    ) -> ReconcileResult:
        client = bridge.client()
        indexer = Indexer(client, index_store, model_embedder)
        writer_lock = index_store.writer_lock if lock is None else lock
        return reconcile(client, index_store, indexer, model_embedder.model_name, writer_lock)

    return run


def entry_fields(entries: list[PageEntry]) -> list[tuple[str, str, str, object]]:
    return [(e.page_id, e.title, e.space_id, e.page_updated_at) for e in entries]


def index_snapshot(store: IndexStore) -> list[object]:
    return [
        (
            entry,
            [
                (s.position, s.heading_path, s.text, s.attachment_id)
                for s in store.sections_of(entry.page_id)
            ],
        )
        for entry in store.list_entries()
    ]


def space_of(store: IndexStore, number: int) -> str | None:
    entry = store.get_entry(page_id(number))
    return None if entry is None else entry.space_id


def messages(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records]


def test_index_ac2_empty_index_lists_exactly_the_page_list_with_its_fields(
    run_reconcile: Reconcile,
    bridge: FakeBridge,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.INFO)
    result = run_reconcile()

    expected = [
        (
            identifier,
            bridge.pages[identifier].title,
            bridge.pages[identifier].space_id,
            bridge.pages[identifier].updated_at,
        )
        for identifier in bridge.listed_ids()
    ]
    assert entry_fields(store.list_entries()) == expected
    assert page_id(TRASHED_PAGE) not in [entry.page_id for entry in store.list_entries()]
    assert {entry.space_id for entry in store.list_entries()} == {SPACE_A, SPACE_B, SPACE_C}
    assert all(entry.workspace_id == WORKSPACE_A for entry in store.list_entries())
    assert len(bridge.list_requests) == 3
    assert result == ReconcileResult(indexed=5, removed=0, rescoped=0)
    assert "Reconcile finished: 5 indexed, 0 removed, 0 rescoped" in messages(caplog)


def test_index_ac3_every_page_with_text_has_a_section_and_an_empty_page_none(
    run_reconcile: Reconcile, store: IndexStore
):
    run_reconcile()

    for number in TEXT_PAGES:
        text_sections = [s for s in store.sections_of(page_id(number)) if s.attachment_id is None]
        assert text_sections, number
    assert store.sections_of(page_id(EMPTY_PAGE)) == []
    assert store.get_entry(page_id(EMPTY_PAGE)) is not None


def test_index_ac4_every_text_pdf_has_sections_with_attachment_file_and_page(
    run_reconcile: Reconcile, store: IndexStore
):
    run_reconcile()

    pdf_sections = [s for s in store.sections_of(page_id(PDF_PAGE)) if s.attachment_id is not None]
    assert {(s.attachment_id, s.file_name) for s in pdf_sections} == {(PDF_ID, PDF_FILE_NAME)}
    assert sorted(s.pdf_page for s in pdf_sections if s.pdf_page is not None) == [1, 2]


def test_index_ac33_a_page_with_another_update_time_is_indexed_again(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore
):
    run_reconcile()
    page = bridge.pages[page_id(1)]
    page.title = "Urlaubsregeln neu"
    page.markdown = "Urlaub beantragt man jetzt vier Wochen vorher."
    page.updated_at = later(60)
    bridge.reset_requests()

    result = run_reconcile()

    entry = store.get_entry(page_id(1))
    assert entry is not None
    assert (entry.title, entry.page_updated_at) == ("Urlaubsregeln neu", later(60))
    assert [s.text for s in store.sections_of(page_id(1))] == [
        "Urlaub beantragt man jetzt vier Wochen vorher."
    ]
    assert bridge.content_requests == [page_id(1)]
    assert result == ReconcileResult(indexed=1, removed=0, rescoped=0)


def test_index_ac34_a_listed_page_missing_from_the_index_is_indexed(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore
):
    run_reconcile()
    bridge.pages[page_id(7)] = WikiPage(SPACE_C, "Neue Seite", "Ganz neuer Inhalt.", later(30))
    bridge.reset_requests()

    result = run_reconcile()

    entry = store.get_entry(page_id(7))
    assert entry is not None
    assert entry.space_id == SPACE_C
    assert [s.text for s in store.sections_of(page_id(7))] == ["Ganz neuer Inhalt."]
    assert bridge.content_requests == [page_id(7)]
    assert result == ReconcileResult(indexed=1, removed=0, rescoped=0)


def test_index_ac35_an_indexed_page_no_longer_listed_leaves_the_index(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore
):
    run_reconcile()
    bridge.pages[page_id(2)].listed = False
    bridge.reset_requests()

    result = run_reconcile()

    assert store.get_entry(page_id(2)) is None
    assert store.sections_of(page_id(2)) == []
    assert bridge.content_requests == []
    assert result == ReconcileResult(indexed=0, removed=1, rescoped=0)


def test_index_ac36_a_space_only_change_rescopes_without_requesting_content(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore, embedder: HashingEmbedder
):
    run_reconcile()
    sections_before = store.sections_of(page_id(4))
    bridge.pages[page_id(4)].space_id = SPACE_C
    bridge.pages[page_id(1)].space_id = SPACE_C
    bridge.reset_requests()
    embedder.calls.clear()

    result = run_reconcile()

    assert space_of(store, 4) == SPACE_C
    assert space_of(store, 1) == SPACE_C
    assert store.sections_of(page_id(4)) == sections_before
    assert bridge.content_requests == []
    assert embedder.calls == []
    assert result == ReconcileResult(indexed=0, removed=0, rescoped=2)


def test_index_ac37_pages_of_another_model_are_indexed_again_with_the_active_one(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore, embedder: HashingEmbedder
):
    run_reconcile(model_embedder=HashingEmbedder(model_name="old-model", dims=64))
    bridge.reset_requests()

    result = run_reconcile(model_embedder=embedder)

    assert {entry.embedding_model for entry in store.list_entries()} == {embedder.model_name}
    assert sorted(bridge.content_requests) == bridge.listed_ids()
    assert all(len(s.embedding) == embedder.dims for s in store.sections_of(page_id(1)))
    assert result == ReconcileResult(indexed=5, removed=0, rescoped=0)


def test_index_ac38_a_matching_index_requests_no_content_and_embeds_nothing(
    run_reconcile: Reconcile,
    bridge: FakeBridge,
    store: IndexStore,
    embedder: HashingEmbedder,
    caplog: pytest.LogCaptureFixture,
):
    run_reconcile()
    before = index_snapshot(store)
    bridge.reset_requests()
    embedder.calls.clear()
    caplog.set_level(logging.INFO)

    result = run_reconcile()

    assert bridge.content_requests == []
    assert bridge.attachment_requests == []
    assert embedder.calls == []
    assert index_snapshot(store) == before
    assert result == ReconcileResult(indexed=0, removed=0, rescoped=0)
    assert "Reconcile finished: 0 indexed, 0 removed, 0 rescoped" in messages(caplog)


@pytest.mark.parametrize("failure", [server_error, refuse], ids=["500", "refused"])
def test_index_ac78_a_failed_page_list_request_leaves_the_index_unchanged(
    run_reconcile: Reconcile,
    bridge: FakeBridge,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
    failure: Callable[[], httpx.Response],
):
    run_reconcile()
    before = index_snapshot(store)
    bridge.pages[page_id(4)].listed = False
    bridge.pages[page_id(1)].updated_at = later(90)
    bridge.pages[page_id(5)].space_id = SPACE_A
    bridge.reset_requests()
    bridge.failing_list_part = 2
    bridge.list_failure = failure
    caplog.set_level(logging.INFO)

    with pytest.raises(ReconcileAborted):
        run_reconcile()

    assert index_snapshot(store) == before
    assert bridge.content_requests == []
    cause = "bridge answered 500 internal_error" if failure is server_error else "ConnectError"
    assert any(cause in line for line in warnings(caplog))
    assert not any(line.startswith("Reconcile finished") for line in messages(caplog))


def test_index_ac78_a_malformed_page_list_part_leaves_the_index_unchanged(
    run_reconcile: Reconcile,
    bridge: FakeBridge,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
):
    run_reconcile()
    before = index_snapshot(store)
    bridge.pages[page_id(4)].listed = False
    bridge.failing_list_part = 2
    bridge.list_failure = lambda: httpx.Response(200, json={"pages": "x"})
    bridge.list_requests.clear()

    with pytest.raises(ReconcileAborted):
        run_reconcile()

    assert index_snapshot(store) == before
    assert warnings(caplog)


def test_a_page_failing_with_another_error_is_skipped_with_a_warning_and_the_rest_indexed(
    run_reconcile: Reconcile,
    bridge: FakeBridge,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
):
    bridge.content_failures[page_id(1)] = bad_request

    result = run_reconcile()

    assert store.get_entry(page_id(1)) is None
    assert [e.page_id for e in store.list_entries()] == [
        identifier for identifier in bridge.listed_ids() if identifier != page_id(1)
    ]
    assert any(page_id(1) in line for line in warnings(caplog))
    assert result == ReconcileResult(indexed=4, removed=0, rescoped=0)


def test_an_unavailable_bridge_while_indexing_aborts_the_reconcile(
    run_reconcile: Reconcile,
    bridge: FakeBridge,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
):
    bridge.content_failures[page_id(2)] = server_error

    with pytest.raises(ReconcileAborted) as aborted:
        run_reconcile()

    assert aborted.value.cause == "bridge answered 500 internal_error"
    assert [e.page_id for e in store.list_entries()] == [page_id(1)]
    assert bridge.content_requests == [page_id(1), page_id(2)]
    assert any("bridge answered 500" in line for line in warnings(caplog))


def test_a_page_listed_twice_is_indexed_once(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore
):
    bridge.repeated_page = page_id(1)

    result = run_reconcile()

    assert result == ReconcileResult(indexed=5, removed=0, rescoped=0)
    assert [entry.page_id for entry in store.list_entries()] == bridge.listed_ids()
    assert bridge.content_requests.count(page_id(1)) == 1


def start_consumer(
    store_conn: psycopg.Connection,
    bridge: FakeBridge,
    embedder: HashingEmbedder,
    redis: fakeredis.FakeRedis,
) -> threading.Thread:
    job_store = IndexStore(store_conn)
    client = bridge.client()
    consumer = JobConsumer(
        redis,
        Indexer(client, job_store, embedder),
        job_store,
        job_store.writer_lock,
        sleep=lambda seconds: None,
    )
    thread = threading.Thread(target=lambda: consumer.process_next(10))
    thread.start()
    thread.join(LOCK_WAIT_SECONDS)
    return thread


def test_index_ac41_a_page_created_after_the_list_was_read_is_indexed(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore, embedder: HashingEmbedder
):
    run_reconcile()
    redis = fakeredis.FakeRedis(decode_responses=True)
    threads: list[threading.Thread] = []
    with psycopg.connect(AI_URL, autocommit=True) as job_store_conn:

        def create_page_after_list_read() -> None:
            bridge.after_list_read = None
            bridge.pages[page_id(8)] = WikiPage(
                SPACE_B, "Spaet", "Erst nach der Liste angelegt.", later(40)
            )
            enqueue_job(
                redis, "page-created", {"pageIds": [page_id(8)], "workspaceId": WORKSPACE_A}
            )
            threads.append(start_consumer(job_store_conn, bridge, embedder, redis))

        bridge.after_list_read = create_page_after_list_read

        run_reconcile()
        for thread in threads:
            thread.join(timeout=10)

    assert threads and not threads[0].is_alive()
    entry = store.get_entry(page_id(8))
    assert entry is not None
    assert [s.text for s in store.sections_of(page_id(8))] == ["Erst nach der Liste angelegt."]


def test_index_ac42_a_page_moved_after_the_list_was_read_keeps_its_new_space(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore, embedder: HashingEmbedder
):
    run_reconcile()
    redis = fakeredis.FakeRedis(decode_responses=True)
    threads: list[threading.Thread] = []
    with psycopg.connect(AI_URL, autocommit=True) as job_store_conn:

        def move_page_after_list_read() -> None:
            bridge.after_list_read = None
            bridge.pages[page_id(4)].space_id = SPACE_A
            enqueue_job(
                redis,
                "page-moved-to-space",
                {"pageIds": [page_id(4)], "spaceId": SPACE_A, "workspaceId": WORKSPACE_A},
            )
            threads.append(start_consumer(job_store_conn, bridge, embedder, redis))

        bridge.after_list_read = move_page_after_list_read
        run_reconcile()
        for thread in threads:
            thread.join(timeout=10)

    assert threads and not threads[0].is_alive()
    assert space_of(store, 4) == SPACE_A


def test_index_ac80_a_reconcile_waits_while_another_holds_the_writer_lock(
    run_reconcile: Reconcile, bridge: FakeBridge, store: IndexStore
):
    results: list[ReconcileResult] = []
    with (
        psycopg.connect(AI_URL, autocommit=True) as holder_conn,
        psycopg.connect(AI_URL, autocommit=True) as second_conn,
    ):
        second_store = IndexStore(second_conn)
        second = threading.Thread(
            target=lambda: results.append(run_reconcile(index_store=second_store))
        )
        with index_writer_lock(holder_conn):
            second.start()
            time.sleep(LOCK_WAIT_SECONDS)
            assert second.is_alive()
            assert bridge.list_requests == []
            assert store.list_entries() == []
        second.join(timeout=10)

    assert not second.is_alive()
    assert results == [ReconcileResult(indexed=5, removed=0, rescoped=0)]


def test_reconcile_with_a_no_op_lock_still_runs(run_reconcile: Reconcile, store: IndexStore):
    assert run_reconcile(lock=nullcontext).indexed == 5
