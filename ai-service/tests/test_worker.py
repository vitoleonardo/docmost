import logging
import os
import socket
import subprocess
import sys
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fakeredis
import psycopg
import pytest
from redis import Redis

import ai_service.worker as worker_module
from ai_service import reconcile_command
from ai_service.index_store import IndexStore
from ai_service.jobs import enqueue_job
from ai_service.migrations_check import MIGRATION_COMMAND
from ai_service.settings import WorkerSettings
from ai_service.worker import RECONCILE_INTERVAL_SECONDS, Runtime, Worker
from tests.conftest import BRIDGE_KEY, SERVICE_CREDENTIAL, TEST_REDIS_URL
from tests.fake_bridge import WIKI_URL, FakeBridge, refuse, seed_shaped_bridge
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import WORKSPACE_A, index_page, make_entry, migrated_index_store, page_id
from tests.test_db_role import ADMIN_URL, AI_URL
from tests.test_migrations import fresh_ai_schema, migrate
from tests.test_settings import IsolatedWorkerSettings

ENTRY_MODULES = ["ai_service.worker", "ai_service.reconcile_command"]
SETTING_NAMES = [
    "AI_BRIDGE_SECRET",
    "AI_SERVICE_TOKEN",
    "REDIS_URL",
    "AI_DATABASE_URL",
    "AI_WIKI_URL",
    "AI_EMBEDDING_MODEL",
]
UNKNOWN_MODEL = "no-such-org/no-such-embedding-model"
BLOCK_MS = 10


@dataclass
class FakeClock:
    now: float = 0.0
    sleeps: list[float] = field(default_factory=list)

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@dataclass
class RecordingConnect:
    opened: list[psycopg.Connection] = field(default_factory=list)

    def __call__(self) -> psycopg.Connection:
        conn = psycopg.connect(AI_URL, autocommit=True)
        self.opened.append(conn)
        return conn

    def close_all(self) -> None:
        for conn in self.opened:
            conn.close()


def worker_settings(**overrides: Any) -> WorkerSettings:
    values: dict[str, Any] = {
        "ai_bridge_secret": BRIDGE_KEY,
        "ai_service_token": SERVICE_CREDENTIAL,
        "redis_url": TEST_REDIS_URL,
        "ai_database_url": AI_URL,
        "ai_wiki_url": WIKI_URL,
        **overrides,
    }
    return IsolatedWorkerSettings(**values)


def run_entry(module: str, cwd: Path, **settings: str) -> subprocess.CompletedProcess[str]:
    environment = {key: value for key, value in os.environ.items() if key not in SETTING_NAMES}
    return subprocess.run(
        [sys.executable, "-m", module],
        cwd=cwd,
        env={**environment, **settings},
        capture_output=True,
        text=True,
        timeout=60,
    )


def all_settings(**overrides: str) -> dict[str, str]:
    return {
        "AI_BRIDGE_SECRET": BRIDGE_KEY,
        "AI_SERVICE_TOKEN": SERVICE_CREDENTIAL,
        "REDIS_URL": TEST_REDIS_URL,
        "AI_DATABASE_URL": AI_URL,
        "AI_WIKI_URL": WIKI_URL,
        **overrides,
    }


def closed_port_url() -> str:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    return f"http://127.0.0.1:{port}"


def indexed_ids(store: IndexStore) -> list[str]:
    return [entry.page_id for entry in store.list_entries()]


def warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [record.getMessage() for record in caplog.records if record.levelno == logging.WARNING]


@pytest.fixture
def store(tmp_path: Path) -> Iterator[IndexStore]:
    with migrated_index_store(tmp_path) as index_store:
        yield index_store


@pytest.fixture
def bridge() -> FakeBridge:
    return seed_shaped_bridge()


@pytest.fixture
def redis() -> Redis:
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def connect() -> Iterator[RecordingConnect]:
    recording = RecordingConnect()
    yield recording
    recording.close_all()


@pytest.fixture
def make_worker(
    bridge: FakeBridge, redis: Redis, clock: FakeClock, connect: RecordingConnect
) -> Callable[..., Worker]:
    def make(connect_to: Callable[[], psycopg.Connection] = connect) -> Worker:
        runtime = Runtime(worker_settings(), HashingEmbedder(), bridge.client(), connect_to)
        return Worker(runtime, redis, clock=clock, sleep=clock.sleep, block_ms=BLOCK_MS)

    return make


@pytest.fixture
def patched_start_up(monkeypatch: pytest.MonkeyPatch, bridge: FakeBridge) -> Callable[..., None]:
    def patch(**overrides: Any) -> None:
        monkeypatch.setattr(worker_module, "load_settings", lambda: worker_settings(**overrides))
        monkeypatch.setattr(worker_module, "load_embedder", lambda model_name: HashingEmbedder())

    monkeypatch.setattr(worker_module, "open_bridge", lambda settings: bridge.client())
    return patch


def reconcile_count(bridge: FakeBridge) -> int:
    return bridge.list_requests.count(None)


@pytest.mark.integration
def test_index_ac39_worker_reconciles_again_600_s_after_the_last_one_finished(
    make_worker: Callable[..., Worker],
    bridge: FakeBridge,
    store: IndexStore,
    redis: Redis,
    clock: FakeClock,
):
    reconcile_seconds = 100.0

    def take_time() -> None:
        clock.now += reconcile_seconds

    bridge.page_size = 10
    bridge.after_list_read = take_time
    worker = make_worker()

    worker.run_once()
    assert reconcile_count(bridge) == 1
    assert indexed_ids(store) == bridge.listed_ids()
    first_finished = clock.now

    enqueue_job(redis, "page-deleted", {"pageIds": [page_id(1)], "workspaceId": WORKSPACE_A})
    clock.now = first_finished + RECONCILE_INTERVAL_SECONDS - 1
    worker.run_once()
    assert reconcile_count(bridge) == 1
    assert page_id(1) not in indexed_ids(store)

    clock.now = first_finished + RECONCILE_INTERVAL_SECONDS
    worker.run_once()
    assert reconcile_count(bridge) == 2
    assert indexed_ids(store) == bridge.listed_ids()

    worker.run_once()
    assert reconcile_count(bridge) == 2


@pytest.mark.integration
def test_worker_keeps_running_when_a_reconcile_is_aborted_and_retries_at_the_next_interval(
    make_worker: Callable[..., Worker],
    bridge: FakeBridge,
    store: IndexStore,
    clock: FakeClock,
    caplog: pytest.LogCaptureFixture,
):
    bridge.failing_list_part = 1
    bridge.list_failure = refuse
    worker = make_worker()

    worker.run_once()
    assert store.list_entries() == []
    assert any("ConnectError" in line for line in warnings(caplog))

    bridge.failing_list_part = None
    worker.run_once()
    assert store.list_entries() == []

    clock.now += RECONCILE_INTERVAL_SECONDS
    worker.run_once()
    assert indexed_ids(store) == bridge.listed_ids()


@pytest.mark.integration
@pytest.mark.parametrize("dropped", [[0], [1], [0, 1]], ids=["store", "lock", "both"])
def test_worker_reopens_its_connections_after_the_database_dropped_them(
    make_worker: Callable[..., Worker],
    connect: RecordingConnect,
    store: IndexStore,
    redis: Redis,
    clock: FakeClock,
    caplog: pytest.LogCaptureFixture,
    dropped: list[int],
):
    worker = make_worker()
    worker.run_once()
    assert len(connect.opened) == 2
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        for index in dropped:
            admin.execute(
                "SELECT pg_terminate_backend(%s)", (connect.opened[index].info.backend_pid,)
            )
    enqueue_job(redis, "page-deleted", {"pageIds": [page_id(1)], "workspaceId": WORKSPACE_A})

    worker.run_once()
    assert page_id(1) in indexed_ids(store)
    assert clock.sleeps == [10]

    worker.run_once()
    assert len(connect.opened) == 4
    assert page_id(1) not in indexed_ids(store)
    assert any("reconnect" in line for line in warnings(caplog))


def test_worker_waits_and_retries_when_the_database_cannot_be_reached(
    make_worker: Callable[..., Worker], clock: FakeClock, caplog: pytest.LogCaptureFixture
):
    def unreachable() -> psycopg.Connection:
        raise psycopg.OperationalError("connection refused")

    worker = make_worker(connect_to=unreachable)
    worker.run_once()
    worker.run_once()

    assert clock.sleeps == [10, 10]
    assert any("OperationalError" in line for line in warnings(caplog))


@pytest.mark.integration
def test_index_ac40_the_reconcile_command_fixes_the_difference_and_exits_0(
    patched_start_up: Callable[..., None],
    bridge: FakeBridge,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
):
    index_page(store, HashingEmbedder(), make_entry(9), ["Diese Seite gibt es nicht mehr"])
    patched_start_up()
    caplog.set_level(logging.INFO)

    reconcile_command.main()

    assert indexed_ids(store) == bridge.listed_ids()
    assert "Reconcile finished: 5 indexed, 1 removed, 0 rescoped" in [
        record.getMessage() for record in caplog.records
    ]


@pytest.mark.integration
def test_index_ac79_unreachable_bridge_exits_1_naming_the_bridge_address(
    monkeypatch: pytest.MonkeyPatch, store: IndexStore, capsys: pytest.CaptureFixture[str]
):
    url = closed_port_url()
    monkeypatch.setattr(worker_module, "load_settings", lambda: worker_settings(ai_wiki_url=url))
    monkeypatch.setattr(worker_module, "load_embedder", lambda model_name: HashingEmbedder())

    with pytest.raises(SystemExit) as exit_info:
        reconcile_command.main()

    assert exit_info.value.code == 1
    assert f"Wiki bridge unreachable at {url}" in capsys.readouterr().err
    assert store.list_entries() == []


@pytest.mark.parametrize("module", ENTRY_MODULES)
def test_index_ac76_start_without_ai_wiki_url_exits_naming_it(module: str, tmp_path: Path):
    settings = all_settings()
    del settings["AI_WIKI_URL"]

    run = run_entry(module, tmp_path, **settings)

    assert run.returncode == 1
    assert run.stderr.strip() == "AI_WIKI_URL is not set"


def test_index_ac76_invalid_settings_are_named_without_their_value(tmp_path: Path):
    settings = all_settings(AI_SERVICE_TOKEN="short-token-value")
    del settings["AI_WIKI_URL"]

    run = run_entry("ai_service.worker", tmp_path, **settings)

    assert run.returncode == 1
    assert "AI_WIKI_URL is not set" in run.stderr
    assert "AI_SERVICE_TOKEN is invalid" in run.stderr
    assert "short-token-value" not in run.stderr


@pytest.mark.integration
@pytest.mark.parametrize("module", ENTRY_MODULES)
def test_index_ac74_start_on_an_unmigrated_schema_exits_naming_the_migration_command(
    module: str, tmp_path: Path
):
    with fresh_ai_schema(tmp_path):
        run = run_entry(module, tmp_path, **all_settings())

    assert run.returncode == 1
    assert MIGRATION_COMMAND in run.stderr
    assert "Traceback" not in run.stderr


@pytest.mark.integration
@pytest.mark.parametrize("module", ENTRY_MODULES)
def test_index_ac77_start_with_a_model_that_cannot_load_exits_naming_the_model(
    module: str, tmp_path: Path
):
    with fresh_ai_schema(tmp_path):
        migrate()
        run = run_entry(module, tmp_path, **all_settings(AI_EMBEDDING_MODEL=UNKNOWN_MODEL))

    assert run.returncode == 1
    assert UNKNOWN_MODEL in run.stderr
    assert "Traceback" not in run.stderr
