import hmac
import logging
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import astuple, dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from functools import partial
from hashlib import sha256
from typing import Literal

import psycopg

from ai_service.prices import PRICES, Price, request_cost

Task = Literal["ask", "extraction", "agent"]

REQUEST_LOG_RETENTION = timedelta(days=30)
WRITE_TIMEOUT_SECONDS = 5
LOGGER = logging.getLogger("ai_service.request_log")
UTC_NOW = partial(datetime.now, UTC)


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
        with self._conn.transaction():
            self._conn.execute(
                """
                INSERT INTO ai.request_log (id, created_at, task, mode, model, prompt_tokens,
                    completion_tokens, latency_ms, cost_usd, status, user_pseudonym, workspace_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                astuple(record),
            )

    def delete_older_than(self, cutoff: datetime) -> int:
        with self._conn.transaction():
            deleted = self._conn.execute(
                "DELETE FROM ai.request_log WHERE created_at < %s", (cutoff,)
            ).rowcount
        return deleted


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
        wall_clock: Callable[[], datetime] = UTC_NOW,
        clock: Callable[[], float] = time.monotonic,
        logger: logging.Logger = LOGGER,
    ) -> None:
        self._database_url = database_url
        self._secret = secret
        self._mode = mode
        self._model = model
        self._prices = prices
        self._wall_clock = wall_clock
        self._clock = clock
        self._logger = logger

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
            record = self.record(timer, status, tally)
            with psycopg.connect(
                self._database_url,
                autocommit=True,
                connect_timeout=WRITE_TIMEOUT_SECONDS,
                options=f"-c statement_timeout={WRITE_TIMEOUT_SECONDS * 1000}",
            ) as conn:
                RequestLogStore(conn).insert(record)
        except Exception as error:
            self._logger.warning(
                "request log write failed task=%s error=%s", timer.task, type(error).__name__
            )
