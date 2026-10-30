import hmac
import logging
import os
import queue
import socket
import threading
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import astuple, dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from typing import Literal

import psycopg

from ai_service.prices import PRICES, Price, request_cost

Task = Literal["ask", "extraction", "agent"]

REQUEST_LOG_RETENTION = timedelta(days=30)
WRITE_TIMEOUT_SECONDS = 5
QUEUE_ROWS = 1_000
WRITER_NAME = "request-log-writer"
LOGGER = logging.getLogger("ai_service.request_log")


def utc_now() -> datetime:
    return datetime.now(UTC)


class QueueFull(Exception):
    pass


class RequestLogClosed(Exception):
    pass


def pseudonym(secret: str, user_id: str) -> str:
    return hmac.new(secret.encode(), user_id.encode(), sha256).hexdigest()


class TokenTally:
    def __init__(self) -> None:
        self._prompt: int | None = 0
        self._completion: int | None = 0

    def add(self, prompt: int | None, completion: int | None) -> None:
        self._prompt = None if self._prompt is None or prompt is None else self._prompt + prompt
        self._completion = (
            None
            if self._completion is None or completion is None
            else self._completion + completion
        )

    def mark_unknown(self) -> None:
        self.add(None, None)

    @property
    def prompt_tokens(self) -> int | None:
        return self._prompt

    @property
    def completion_tokens(self) -> int | None:
        return self._completion


@dataclass(frozen=True)
class RequestRecord:
    id: str
    created_at: datetime
    task: Task
    mode: str
    model: str
    prompt_tokens: int | None
    completion_tokens: int | None
    latency_ms: int
    cost_usd: Decimal | None
    status: str
    user_pseudonym: str
    workspace_id: str


class RequestLogStore:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert(self, record: RequestRecord) -> None:
        self._conn.execute(
            """
            INSERT INTO ai.request_log (id, created_at, task, mode, model, prompt_tokens,
                completion_tokens, latency_ms, cost_usd, status, user_pseudonym, workspace_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            astuple(record),
        )

    def rows_since(self, cutoff: datetime) -> list[RequestRecord]:
        with self._conn.transaction():
            rows = self._conn.execute(
                """
                SELECT id, created_at, task, mode, model, prompt_tokens, completion_tokens,
                    latency_ms, cost_usd, status, user_pseudonym, workspace_id
                FROM ai.request_log WHERE created_at >= %s
                """,
                (cutoff,),
            ).fetchall()
        return [RequestRecord(*row) for row in rows]

    def delete_older_than(self, cutoff: datetime) -> int:
        with self._conn.transaction():
            deleted = self._conn.execute(
                "DELETE FROM ai.request_log WHERE created_at < %s", (cutoff,)
            ).rowcount
        return deleted


class WriteDeadline:
    def __init__(self, conn: psycopg.Connection, seconds: float) -> None:
        self._conn = conn
        self._lock = threading.Lock()
        self._ended = False
        self._timer = threading.Timer(max(seconds, 0.0), self._expire)
        self._timer.daemon = True
        self._timer.start()

    def end(self) -> None:
        with self._lock:
            self._ended = True
        self._timer.cancel()

    def _expire(self) -> None:
        with self._lock:
            if self._ended:
                return
            with socket.socket(fileno=os.dup(self._conn.fileno())) as sock:
                sock.shutdown(socket.SHUT_RDWR)


@dataclass(frozen=True)
class RequestTimer:
    task: Task
    user_id: str
    workspace_id: str
    accepted_at: datetime
    started: float


class RequestLog:
    def __init__(
        self,
        database_url: str,
        secret: str,
        mode: str,
        model: str,
        prices: Sequence[Price] = PRICES,
        wall_clock: Callable[[], datetime] = utc_now,
        clock: Callable[[], float] = time.monotonic,
        logger: logging.Logger = LOGGER,
        queue_rows: int = QUEUE_ROWS,
        write_timeout: float = WRITE_TIMEOUT_SECONDS,
        connect_timeout: int = WRITE_TIMEOUT_SECONDS,
    ) -> None:
        self._database_url = database_url
        self._secret = secret
        self._mode = mode
        self._model = model
        self._prices = prices
        self._wall_clock = wall_clock
        self._clock = clock
        self._logger = logger
        self._write_timeout = write_timeout
        self._connect_timeout = connect_timeout
        self._rows: queue.Queue[RequestRecord | threading.Event | None] = queue.Queue(queue_rows)
        self._lock = threading.Lock()
        self._accepting = True
        self._writer: threading.Thread | None = None

    def start(self, task: Task, user_id: str, workspace_id: str) -> RequestTimer:
        return RequestTimer(
            task=task,
            user_id=user_id,
            workspace_id=workspace_id,
            accepted_at=self._wall_clock().astimezone(UTC),
            started=self._clock(),
        )

    def record(self, timer: RequestTimer, status: str, tally: TokenTally) -> RequestRecord:
        prompt_tokens = tally.prompt_tokens
        completion_tokens = tally.completion_tokens
        return RequestRecord(
            id=str(uuid.uuid4()),
            created_at=timer.accepted_at.replace(minute=0, second=0, microsecond=0),
            task=timer.task,
            mode=self._mode,
            model=self._model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=round((self._clock() - timer.started) * 1000),
            cost_usd=request_cost(
                self._prices,
                self._mode,
                self._model,
                timer.accepted_at.date(),
                prompt_tokens,
                completion_tokens,
            ),
            status=status,
            user_pseudonym=pseudonym(self._secret, timer.user_id),
            workspace_id=timer.workspace_id,
        )

    def finish(self, timer: RequestTimer, status: str, tally: TokenTally) -> None:
        try:
            self._enqueue(self.record(timer, status, tally))
        except Exception as error:
            self._failed(timer.task, error)

    def flush(self, timeout: float) -> bool:
        with self._lock:
            writer = self._writer
            accepting = self._accepting
        if not accepting:
            return False
        if writer is None:
            return True
        deadline = time.monotonic() + timeout
        written = threading.Event()
        try:
            self._rows.put(written, timeout=timeout)
        except queue.Full:
            return False
        return written.wait(max(deadline - time.monotonic(), 0))

    def close(self, timeout: float) -> None:
        with self._lock:
            self._accepting = False
            writer = self._writer
        if writer is None:
            return
        deadline = time.monotonic() + timeout
        try:
            self._rows.put(None, timeout=timeout)
        except queue.Full:
            return
        writer.join(max(deadline - time.monotonic(), 0))

    def _enqueue(self, record: RequestRecord) -> None:
        with self._lock:
            if not self._accepting:
                raise RequestLogClosed
            if self._writer is None:
                self._writer = threading.Thread(
                    target=self._write_rows, name=WRITER_NAME, daemon=True
                )
                self._writer.start()
            try:
                self._rows.put_nowait(record)
            except queue.Full:
                raise QueueFull from None

    def _write_rows(self) -> None:
        while (item := self._rows.get()) is not None:
            if isinstance(item, threading.Event):
                item.set()
                continue
            try:
                self._write(item)
            except Exception as error:
                self._failed(item.task, error)

    def _write(self, record: RequestRecord) -> None:
        ends_at = time.monotonic() + self._write_timeout
        conn = psycopg.connect(
            self._database_url,
            autocommit=True,
            connect_timeout=self._connect_timeout,
            options=f"-c statement_timeout={WRITE_TIMEOUT_SECONDS * 1000}",
        )
        deadline = WriteDeadline(conn, ends_at - time.monotonic())
        try:
            RequestLogStore(conn).insert(record)
        finally:
            deadline.end()
            conn.close()

    def _failed(self, task: Task, error: Exception) -> None:
        self._logger.warning(
            "request log write failed task=%s error=%s", task, type(error).__name__
        )
