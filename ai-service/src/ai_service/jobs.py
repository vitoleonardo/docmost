import json
import logging
import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, cast

import psycopg
from redis import Redis, ResponseError

from ai_service.bridge_client import BridgeUnavailable

if TYPE_CHECKING:
    from ai_service.index_store import IndexStore
    from ai_service.indexer import Indexer

JOB_STREAM = "ai-service:jobs"
CONSUMER_GROUP = "indexer"
CONSUMER_NAME = "worker"
RETRY_DELAY_SECONDS = 10
MAX_ATTEMPTS = 3
OWN_PENDING_ID = "0"
NEW_ENTRIES_ID = ">"

FORWARDED_JOB_FIELDS: dict[str, tuple[str, ...]] = {
    "page-created": ("pageIds", "workspaceId"),
    "page-content-updated": ("pageIds", "workspaceId"),
    "page-soft-deleted": ("pageIds", "workspaceId"),
    "page-restored": ("pageIds", "workspaceId"),
    "page-deleted": ("pageIds", "workspaceId"),
    "page-moved-to-space": ("pageIds", "spaceId", "workspaceId"),
    "space-deleted": ("spaceId", "workspaceId"),
    "workspace-deleted": ("workspaceId",),
}

LOGGER = logging.getLogger("ai_service.jobs")

WriterLock = Callable[[], AbstractContextManager[object]]
RETRYABLE_ERRORS = (BridgeUnavailable, psycopg.OperationalError)


def enqueue_job(redis: Redis, name: str, data: dict[str, object]) -> str:
    entry: dict[Any, Any] = {
        "name": name,
        "data": json.dumps(data),
        "receivedAt": datetime.now(UTC).isoformat(),
    }
    return cast(str, redis.xadd(JOB_STREAM, entry))


class InvalidJob(Exception):
    pass


@dataclass(frozen=True)
class Job:
    entry_id: str
    name: str
    data: dict[str, Any]

    @property
    def page_ids(self) -> list[str]:
        return self.data.get("pageIds", [])


def is_valid_field(field: str, value: object) -> bool:
    if field == "pageIds":
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    return isinstance(value, str)


def parse_job(entry_id: str, fields: dict[str, str]) -> Job:
    name = fields.get("name", "")
    required = FORWARDED_JOB_FIELDS.get(name)
    if required is None:
        raise InvalidJob("unknown job name")
    try:
        data = json.loads(fields.get("data", ""))
    except json.JSONDecodeError as error:
        raise InvalidJob("data is not valid JSON") from error
    if not isinstance(data, dict):
        raise InvalidJob("data is not an object")
    for field in required:
        if field not in data:
            raise InvalidJob(f"data misses {field}")
        if not is_valid_field(field, data[field]):
            raise InvalidJob(f"data has an invalid {field}")
    return Job(entry_id, name, data)


def describe_error(error: Exception) -> str:
    if isinstance(error, BridgeUnavailable):
        return error.cause
    return type(error).__name__


class JobConsumer:
    def __init__(
        self,
        redis: Redis,
        indexer: Indexer,
        store: IndexStore,
        writer_lock: WriterLock,
        sleep: Callable[[float], None] = time.sleep,
        logger: logging.Logger = LOGGER,
    ) -> None:
        self._redis = redis
        self._indexer = indexer
        self._store = store
        self._writer_lock = writer_lock
        self._sleep = sleep
        self._logger = logger
        self._handlers: dict[str, Callable[[dict[str, Any]], None]] = {
            "page-created": self._index_pages,
            "page-content-updated": self._index_pages,
            "page-restored": self._index_pages,
            "page-soft-deleted": lambda data: store.remove_pages(data["pageIds"]),
            "page-deleted": lambda data: store.remove_pages(data["pageIds"]),
            "page-moved-to-space": lambda data: store.rescope(data["pageIds"], data["spaceId"]),
            "space-deleted": lambda data: store.remove_space(data["spaceId"]),
            "workspace-deleted": lambda data: store.remove_workspace(data["workspaceId"]),
        }
        self._create_group()

    def process_next(self, block_ms: int) -> bool:
        entry = self._read(OWN_PENDING_ID, None) or self._read(NEW_ENTRIES_ID, block_ms or None)
        if entry is None:
            return False
        entry_id, fields = entry
        try:
            job = parse_job(entry_id, fields)
        except InvalidJob as invalid:
            self._logger.warning(
                "job skipped %s %s: %s", fields.get("name", "<no name>"), entry_id, invalid
            )
            self._ack(entry_id)
            return True
        self._run(job)
        return True

    def _run(self, job: Job) -> None:
        last_error = ""
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                with self._writer_lock():
                    self._handlers[job.name](job.data)
            except RETRYABLE_ERRORS as error:
                self._logger.warning(
                    "job retry %s %s in %d s: %s",
                    job.name,
                    job.entry_id,
                    RETRY_DELAY_SECONDS,
                    describe_error(error),
                )
                self._sleep(RETRY_DELAY_SECONDS)
                return
            except Exception as error:
                last_error = describe_error(error)
                self._logger.warning(
                    "job attempt %d of %d failed %s %s: %s",
                    attempt,
                    MAX_ATTEMPTS,
                    job.name,
                    job.entry_id,
                    last_error,
                )
                continue
            self._log_processed(job)
            self._ack(job.entry_id)
            return
        self._logger.warning(
            "job skipped %s %s after %d attempts: %s",
            job.name,
            job.entry_id,
            MAX_ATTEMPTS,
            last_error,
        )
        self._ack(job.entry_id)

    def _index_pages(self, data: dict[str, Any]) -> None:
        for page_id in data["pageIds"]:
            self._indexer.index_page(page_id)

    def _log_processed(self, job: Job) -> None:
        if "pageIds" in job.data:
            self._logger.info(
                "job processed %s %s pages %s", job.name, job.entry_id, " ".join(job.page_ids)
            )
            return
        self._logger.info("job processed %s %s", job.name, job.entry_id)

    def _create_group(self) -> None:
        try:
            self._redis.xgroup_create(JOB_STREAM, CONSUMER_GROUP, id="0", mkstream=True)
        except ResponseError as error:
            if "BUSYGROUP" not in str(error):
                raise

    def _read(self, start_id: str, block_ms: int | None) -> tuple[str, dict[str, str]] | None:
        reply: Any = self._redis.xreadgroup(
            CONSUMER_GROUP, CONSUMER_NAME, {JOB_STREAM: start_id}, count=1, block=block_ms
        )
        for _stream, entries in reply or []:
            for entry_id, fields in entries:
                return entry_id, fields or {}
        return None

    def _ack(self, entry_id: str) -> None:
        self._redis.xack(JOB_STREAM, CONSUMER_GROUP, entry_id)
