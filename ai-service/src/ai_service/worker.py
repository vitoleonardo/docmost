import logging
import sys
import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from types import TracebackType
from typing import NoReturn

import psycopg
from pydantic import ValidationError
from redis import Redis

from ai_service.bridge_client import BridgeClient
from ai_service.db_check import RoleNotIsolatedError, check_database_role
from ai_service.embedding import Embedder, EmbeddingModelError, FastEmbedEmbedder
from ai_service.index_lock import index_writer_lock
from ai_service.index_store import IndexStore
from ai_service.indexer import Indexer
from ai_service.jobs import RETRY_DELAY_SECONDS, JobConsumer
from ai_service.migrations_check import MigrationsMissingError, assert_migrated
from ai_service.reconcile import ReconcileAborted, ReconcileResult, reconcile
from ai_service.settings import WorkerSettings

RECONCILE_INTERVAL_SECONDS = 600
JOB_BLOCK_MS = 1000
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"
LOGGER = logging.getLogger("ai_service.worker")

Connect = Callable[[], psycopg.Connection]


def load_settings() -> WorkerSettings:
    return WorkerSettings()  # pyright: ignore[reportCallIssue]


def load_embedder(model_name: str) -> Embedder:
    return FastEmbedEmbedder(model_name)


def open_bridge(settings: WorkerSettings) -> BridgeClient:
    return BridgeClient(settings.ai_wiki_url, settings.ai_service_token)


def describe_settings_error(error: ValidationError) -> str:
    lines: list[str] = []
    for problem in error.errors():
        name = str(problem["loc"][0]).upper()
        if problem["type"] == "missing":
            lines.append(f"{name} is not set")
        else:
            lines.append(f"{name} is invalid: {problem['msg']}")
    return "\n".join(lines)


def exit_with(message: str, error: BaseException) -> NoReturn:
    print(message, file=sys.stderr)
    raise SystemExit(1) from error


def configure_logging() -> None:
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    logging.getLogger("httpx").setLevel(logging.WARNING)


@dataclass(frozen=True)
class Runtime:
    settings: WorkerSettings
    embedder: Embedder
    bridge: BridgeClient
    connect: Connect


def start_up() -> Runtime:
    try:
        settings = load_settings()
    except ValidationError as error:
        exit_with(describe_settings_error(error), error)
    try:
        check_database_role(settings.ai_database_url)
    except RoleNotIsolatedError as error:
        exit_with(str(error), error)

    def connect() -> psycopg.Connection:
        return psycopg.connect(settings.ai_database_url, autocommit=True)

    with connect() as conn:
        try:
            assert_migrated(conn)
        except MigrationsMissingError as error:
            exit_with(str(error), error)
    try:
        embedder = load_embedder(settings.ai_embedding_model)
    except EmbeddingModelError as error:
        exit_with(str(error), error)
    return Runtime(settings, embedder, open_bridge(settings), connect)


class IndexSession:
    def __init__(self, runtime: Runtime) -> None:
        self._runtime = runtime
        self._store_conn = runtime.connect()
        try:
            self._lock_conn = runtime.connect()
        except psycopg.OperationalError:
            self._store_conn.close()
            raise
        self.store = IndexStore(self._store_conn)
        self.indexer = Indexer(runtime.bridge, self.store, runtime.embedder)

    def writer_lock(self) -> AbstractContextManager[None]:
        return index_writer_lock(self._lock_conn)

    @property
    def closed(self) -> bool:
        return self._store_conn.closed or self._lock_conn.closed

    def reconcile(self) -> ReconcileResult:
        return reconcile(
            self._runtime.bridge,
            self.store,
            self.indexer,
            self._runtime.embedder.model_name,
            self.writer_lock,
        )

    def close(self) -> None:
        self._store_conn.close()
        self._lock_conn.close()

    def __enter__(self) -> IndexSession:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


class Worker:
    def __init__(
        self,
        runtime: Runtime,
        redis: Redis,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        block_ms: int = JOB_BLOCK_MS,
        logger: logging.Logger = LOGGER,
    ) -> None:
        self._runtime = runtime
        self._redis = redis
        self._clock = clock
        self._sleep = sleep
        self._block_ms = block_ms
        self._logger = logger
        self._active: tuple[IndexSession, JobConsumer] | None = None
        self._last_reconcile: float | None = None

    def run(self) -> None:
        try:
            while True:
                self.run_once()
        finally:
            self._close()

    def run_once(self) -> None:
        active = self._active or self._open()
        if active is None:
            return
        session, consumer = active
        try:
            if self._reconcile_due():
                self._reconcile(session)
            consumer.process_next(self._block_ms)
        except psycopg.OperationalError as error:
            self._wait_for_database(error)
        if session.closed:
            self._logger.warning("AI database connection lost, reconnecting")
            self._close()

    def _open(self) -> tuple[IndexSession, JobConsumer] | None:
        try:
            session = IndexSession(self._runtime)
        except psycopg.OperationalError as error:
            self._wait_for_database(error)
            return None
        consumer = JobConsumer(
            self._redis, session.indexer, session.store, session.writer_lock, sleep=self._sleep
        )
        self._active = (session, consumer)
        return self._active

    def _close(self) -> None:
        if self._active is not None:
            self._active[0].close()
        self._active = None

    def _wait_for_database(self, error: psycopg.OperationalError) -> None:
        self._logger.warning(
            "AI database unreachable, next attempt in %d s: %s",
            RETRY_DELAY_SECONDS,
            type(error).__name__,
        )
        self._sleep(RETRY_DELAY_SECONDS)

    def _reconcile_due(self) -> bool:
        if self._last_reconcile is None:
            return True
        return self._clock() - self._last_reconcile >= RECONCILE_INTERVAL_SECONDS

    def _reconcile(self, session: IndexSession) -> None:
        try:
            session.reconcile()
        except ReconcileAborted:
            self._logger.info("Next reconcile in %d s", RECONCILE_INTERVAL_SECONDS)
        finally:
            self._last_reconcile = self._clock()


def main() -> None:
    configure_logging()
    runtime = start_up()
    redis: Redis = Redis.from_url(runtime.settings.redis_url, decode_responses=True)
    try:
        Worker(runtime, redis).run()
    except KeyboardInterrupt:
        LOGGER.info("Worker stopped")


if __name__ == "__main__":
    main()
