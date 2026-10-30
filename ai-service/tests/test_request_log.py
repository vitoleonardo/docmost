import hashlib
import hmac
import logging
import socket
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest

from ai_service.prices import LOCAL_MODE, Price
from ai_service.request_log import (
    QUEUE_ROWS,
    REQUEST_LOG_RETENTION,
    WRITER_NAME,
    RequestLog,
    RequestLogStore,
    RequestRecord,
    TokenTally,
    pseudonym,
)
from tests.conftest import REQUEST_LOG_KEY, FakeClock, HeldRequestLog, warnings
from tests.test_db_role import AI_URL
from tests.test_migrations import fresh_ai_schema, migrate, run_alembic, schemas_holding

USER = "0192f000-0000-7000-8000-0000000000f1"
OTHER_USER = "0192f000-0000-7000-8000-0000000000f2"
WORKSPACE = "0192f000-0000-7000-8000-0000000000f3"
MODEL = "qwen3:8b"
API_MODEL = "claude-test"
ACCEPTED = datetime(2026, 10, 30, 10, 42, 17, tzinfo=UTC)
HOUR = datetime(2026, 10, 30, 10, 0, tzinfo=UTC)
RFC4231_KEY = "Jefe"
RFC4231_DATA = "what do ya want for nothing?"
RFC4231_DIGEST = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
AT_ONCE_SECONDS = 0.5
AGENT_REVISION = "0002_agent_tables"
REQUEST_LOG_COLUMNS = [
    "id",
    "created_at",
    "task",
    "mode",
    "model",
    "prompt_tokens",
    "completion_tokens",
    "latency_ms",
    "cost_usd",
    "status",
    "user_pseudonym",
    "workspace_id",
]
API_ENTRY = Price(
    model=API_MODEL,
    prompt_usd_per_mtok=Decimal("3"),
    completion_usd_per_mtok=Decimal("15"),
    valid_from=date(2026, 10, 1),
    source_url="https://example.test/pricing",
    read_on=date(2026, 10, 1),
)


def recorder(
    database_url: str = AI_URL,
    mode: str = LOCAL_MODE,
    model: str = MODEL,
    accepted: datetime = ACCEPTED,
    clock: FakeClock | None = None,
) -> RequestLog:
    return RequestLog(
        database_url=database_url,
        secret=REQUEST_LOG_KEY,
        mode=mode,
        model=model,
        prices=(API_ENTRY,),
        wall_clock=lambda: accepted,
        clock=clock or FakeClock(),
    )


def tally(*calls: tuple[int | None, int | None]) -> TokenTally:
    counted = TokenTally()
    for prompt, completion in calls:
        counted.add(prompt, completion)
    return counted


def test_reqlog_ac22_pseudonym_matches_the_rfc4231_hmac_sha256_vector():
    assert pseudonym(RFC4231_KEY, RFC4231_DATA) == RFC4231_DIGEST


def test_reqlog_ac22_pseudonym_is_the_hmac_of_the_user_id_keyed_with_the_secret():
    expected = hmac.new(REQUEST_LOG_KEY.encode(), USER.encode(), hashlib.sha256).hexdigest()
    value = pseudonym(REQUEST_LOG_KEY, USER)
    assert value == expected
    assert len(value) == 64
    assert value == value.lower()
    assert USER not in value


def test_reqlog_ac22_record_carries_the_pseudonym_not_the_user_id():
    log = recorder()
    record = log.record(log.start("ask", USER, WORKSPACE), "answered", tally())
    assert record.user_pseudonym == pseudonym(REQUEST_LOG_KEY, USER)


def test_reqlog_ac23_same_user_gets_the_same_pseudonym():
    log = recorder()
    first = log.record(log.start("ask", USER, WORKSPACE), "answered", tally())
    second = log.record(log.start("agent", USER, WORKSPACE), "finished", tally())
    assert first.user_pseudonym == second.user_pseudonym


def test_reqlog_ac24_different_users_get_different_pseudonyms():
    assert pseudonym(REQUEST_LOG_KEY, USER) != pseudonym(REQUEST_LOG_KEY, OTHER_USER)


def test_reqlog_ac24_different_secrets_give_different_pseudonyms():
    assert pseudonym(REQUEST_LOG_KEY, USER) != pseudonym(REQUEST_LOG_KEY + "x", USER)


def test_reqlog_ac48_tally_without_calls_counts_zero():
    counted = TokenTally()
    assert (counted.prompt_tokens, counted.completion_tokens) == (0, 0)


def test_reqlog_ac48_tally_sums_the_calls():
    counted = tally((1_000, 100), (2_000, 200), (3_000, 300))
    assert (counted.prompt_tokens, counted.completion_tokens) == (6_000, 600)


def test_reqlog_ac48_missing_completion_count_empties_only_that_count():
    counted = tally((1_200, None))
    assert (counted.prompt_tokens, counted.completion_tokens) == (1_200, None)


def test_reqlog_ac48_missing_prompt_count_stays_empty_after_later_calls():
    counted = tally((None, 300), (100, 50))
    assert (counted.prompt_tokens, counted.completion_tokens) == (None, 350)


def test_reqlog_ac48_failed_call_empties_both_counts():
    counted = tally((1_000, 100), (1_000, 100))
    counted.mark_unknown()
    counted.add(500, 50)
    assert (counted.prompt_tokens, counted.completion_tokens) == (None, None)


def test_reqlog_ac20_time_is_the_accepted_time_cut_to_the_hour():
    log = recorder()
    record = log.record(log.start("ask", USER, WORKSPACE), "answered", tally())
    assert record.created_at == HOUR


def test_reqlog_ac20_time_is_cut_in_utc():
    local_time = ACCEPTED.astimezone(timezone(timedelta(hours=2)))
    log = recorder(accepted=local_time)
    record = log.record(log.start("ask", USER, WORKSPACE), "answered", tally())
    assert record.created_at == HOUR
    assert record.created_at.utcoffset() == timedelta(0)


def test_reqlog_ac20_latency_is_whole_milliseconds_from_start_to_finish():
    clock = FakeClock(now=100.0)
    log = recorder(clock=clock)
    timer = log.start("ask", USER, WORKSPACE)
    clock.now = 102.5004
    record = log.record(timer, "answered", tally())
    assert record.latency_ms == 2_500


def test_reqlog_ac14_record_holds_the_task_mode_model_status_and_workspace():
    log = recorder()
    record = log.record(log.start("extraction", USER, WORKSPACE), "extracted", tally((10, 2)))
    assert (record.task, record.mode, record.model, record.status, record.workspace_id) == (
        "extraction",
        LOCAL_MODE,
        MODEL,
        "extracted",
        WORKSPACE,
    )
    assert (record.prompt_tokens, record.completion_tokens) == (10, 2)


def test_reqlog_ac14_local_mode_costs_zero():
    log = recorder()
    record = log.record(log.start("ask", USER, WORKSPACE), "answered", tally((None, None)))
    assert record.cost_usd == Decimal(0)


def test_reqlog_ac14_api_mode_cost_uses_the_price_of_the_accepted_day():
    log = recorder(mode="api", model=API_MODEL)
    record = log.record(log.start("ask", USER, WORKSPACE), "answered", tally((1_200, 300)))
    assert record.cost_usd == Decimal("0.0081")


def test_reqlog_ac14_api_mode_with_an_empty_count_has_no_cost():
    log = recorder(mode="api", model=API_MODEL)
    counted = tally((1_200, 300))
    counted.mark_unknown()
    record = log.record(log.start("agent", USER, WORKSPACE), "model_failed", counted)
    assert record.cost_usd is None


def test_reqlog_ac14_each_record_has_its_own_id():
    log = recorder()
    timer = log.start("ask", USER, WORKSPACE)
    assert log.record(timer, "answered", tally()).id != log.record(timer, "answered", tally()).id


def test_reqlog_ac37_retention_is_thirty_days():
    assert REQUEST_LOG_RETENTION == timedelta(days=30)


def writer_threads() -> set[threading.Thread]:
    return {thread for thread in threading.enumerate() if thread.name == WRITER_NAME}


def test_reqlog_ac35_finish_hands_the_row_to_the_writer_and_returns_at_once():
    log = HeldRequestLog()
    started = time.monotonic()
    log.finish(log.start("ask", USER, WORKSPACE), "answered", tally((1_200, 300)))
    elapsed = time.monotonic() - started
    assert log.writing.wait(1)
    log.release.set()
    assert log.flush(1)
    assert elapsed < AT_ONCE_SECONDS
    assert [(r.task, r.status, r.prompt_tokens, r.completion_tokens) for r in log.written] == [
        ("ask", "answered", 1_200, 300)
    ]


def test_reqlog_ac20_latency_ends_when_finish_is_called_not_when_the_row_is_written():
    clock = FakeClock(now=100.0)
    log = HeldRequestLog(clock=clock)
    timer = log.start("ask", USER, WORKSPACE)
    clock.now = 102.5
    log.finish(timer, "answered", tally())
    assert log.writing.wait(1)
    clock.now = 110.0
    log.release.set()
    assert log.flush(1)
    assert [record.latency_ms for record in log.written] == [2_500]


def test_reqlog_ac36_the_queue_holds_1000_rows():
    assert QUEUE_ROWS == 1_000


def test_reqlog_ac36_a_full_queue_drops_the_row_with_one_failure_line_without_blocking(
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.WARNING, logger="ai_service.request_log")
    log = HeldRequestLog(queue_rows=1)
    timer = log.start("ask", USER, WORKSPACE)
    log.finish(timer, "answered", tally())
    assert log.writing.wait(1)
    log.finish(timer, "no_source", tally())
    started = time.monotonic()
    log.finish(timer, "stopped", tally())
    elapsed = time.monotonic() - started
    log.release.set()
    assert log.flush(1)
    assert elapsed < AT_ONCE_SECONDS
    assert warnings(caplog) == ["request log write failed task=ask error=QueueFull"]
    assert [record.status for record in log.written] == ["answered", "no_source"]
    assert USER not in caplog.text
    assert pseudonym(REQUEST_LOG_KEY, USER) not in caplog.text


class FirstWriteFails(HeldRequestLog):
    def __init__(self) -> None:
        super().__init__()
        self.failures = [RuntimeError("Urlaubsregeln")]

    def _write(self, record: RequestRecord) -> None:
        if self.failures:
            raise self.failures.pop()
        self.written.append(record)


def test_reqlog_ac36_a_failing_write_logs_one_line_and_the_writer_goes_on(
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.WARNING, logger="ai_service.request_log")
    log = FirstWriteFails()
    timer = log.start("agent", USER, WORKSPACE)
    log.finish(timer, "finished", tally())
    log.finish(timer, "cancelled", tally())
    assert log.flush(1)
    assert warnings(caplog) == ["request log write failed task=agent error=RuntimeError"]
    assert [record.status for record in log.written] == ["cancelled"]
    assert "Urlaubsregeln" not in caplog.text


def test_reqlog_ac44_close_writes_the_queued_rows_and_stops_the_writer():
    before = writer_threads()
    log = HeldRequestLog()
    timer = log.start("ask", USER, WORKSPACE)
    for status in ("answered", "no_source", "stopped"):
        log.finish(timer, status, tally())
    assert len(writer_threads() - before) == 1
    log.release.set()
    log.close(1)
    assert [record.status for record in log.written] == ["answered", "no_source", "stopped"]
    assert writer_threads() == before


def test_reqlog_ac36_close_gives_up_on_a_hanging_write_within_its_timeout():
    log = HeldRequestLog()
    log.finish(log.start("ask", USER, WORKSPACE), "answered", tally())
    assert log.writing.wait(1)
    started = time.monotonic()
    log.close(0.2)
    elapsed = time.monotonic() - started
    log.release.set()
    assert elapsed < AT_ONCE_SECONDS
    assert log.flush(1)


def test_reqlog_ac36_a_row_after_close_is_dropped_with_one_failure_line(
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.WARNING, logger="ai_service.request_log")
    log = HeldRequestLog()
    log.close(1)
    log.finish(log.start("extraction", USER, WORKSPACE), "extracted", tally())
    assert warnings(caplog) == ["request log write failed task=extraction error=RequestLogClosed"]
    assert log.written == []


def test_reqlog_ac36_close_and_flush_without_any_row_return_at_once():
    before = writer_threads()
    log = HeldRequestLog()
    started = time.monotonic()
    assert log.flush(1)
    log.close(1)
    assert time.monotonic() - started < AT_ONCE_SECONDS
    assert writer_threads() == before


@pytest.fixture(scope="module")
def database(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    with fresh_ai_schema(tmp_path_factory.mktemp("request-log")):
        migrate()
        yield


@pytest.fixture
def raw(database: None) -> Iterator[psycopg.Connection]:
    with psycopg.connect(AI_URL, autocommit=True) as conn:
        conn.execute("DELETE FROM ai.request_log")
        yield conn


def stored_rows(conn: psycopg.Connection) -> list[tuple[object, ...]]:
    return conn.execute(
        """
        SELECT id::text, created_at, task, mode, model, prompt_tokens, completion_tokens,
            latency_ms, cost_usd, status, user_pseudonym, workspace_id::text
        FROM ai.request_log ORDER BY id
        """
    ).fetchall()


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def database_url_on(port: int) -> str:
    return f"postgresql://docmost_ai:test-password@127.0.0.1:{port}/docmost"


@contextmanager
def silent_server() -> Iterator[int]:
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        yield server.getsockname()[1]


@pytest.mark.integration
def test_reqlog_ac14_finish_writes_one_row_with_mode_and_model(raw: psycopg.Connection):
    log = recorder()
    log.finish(log.start("ask", USER, WORKSPACE), "answered", tally((1_200, 300)))
    assert log.flush(6)
    rows = stored_rows(raw)
    assert len(rows) == 1
    _, created_at, task, mode, model, prompt, completion, latency, cost, status, user, space = rows[
        0
    ]
    assert (task, mode, model, status) == ("ask", LOCAL_MODE, MODEL, "answered")
    assert (prompt, completion, latency, cost) == (1_200, 300, 0, Decimal(0))
    assert created_at == HOUR
    assert user == pseudonym(REQUEST_LOG_KEY, USER)
    assert space == WORKSPACE


@pytest.mark.integration
def test_reqlog_ac48_finish_writes_empty_counts_and_empty_cost(raw: psycopg.Connection):
    log = recorder(mode="api", model=API_MODEL)
    log.finish(log.start("agent", USER, WORKSPACE), "model_failed", tally((1_200, None)))
    assert log.flush(6)
    [row] = stored_rows(raw)
    assert (row[5], row[6], row[8]) == (1_200, None, None)


@pytest.mark.integration
def test_reqlog_ac25_table_holds_exactly_the_planned_columns(raw: psycopg.Connection):
    columns = raw.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'ai' AND table_name = 'request_log'
        ORDER BY ordinal_position
        """
    ).fetchall()
    assert [name for (name,) in columns] == REQUEST_LOG_COLUMNS


@pytest.mark.integration
def test_reqlog_ac25_row_holds_no_user_id(raw: psycopg.Connection):
    log = recorder()
    log.finish(log.start("ask", USER, WORKSPACE), "answered", tally((1, 1)))
    assert log.flush(6)
    [row] = stored_rows(raw)
    assert all(USER not in str(value) for value in row)


@pytest.mark.integration
@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("task", "indexing"),
        ("user_pseudonym", USER),
        ("user_pseudonym", "A" * 64),
        ("prompt_tokens", -1),
        ("completion_tokens", -1),
        ("latency_ms", -1),
    ],
)
def test_reqlog_ac25_table_refuses_values_outside_its_checks(
    raw: psycopg.Connection, column: str, value: object
):
    log = recorder()
    record = log.record(log.start("ask", USER, WORKSPACE), "answered", tally())
    with pytest.raises(psycopg.errors.CheckViolation):
        RequestLogStore(raw).insert(replace(record, **{column: value}))


@pytest.mark.integration
def test_reqlog_ac44_two_requests_ending_at_the_same_moment_write_two_rows(
    raw: psycopg.Connection,
):
    log = recorder()
    timers = [log.start("ask", USER, WORKSPACE), log.start("ask", USER, WORKSPACE)]
    barrier = threading.Barrier(len(timers))

    def finish(index: int) -> None:
        barrier.wait()
        log.finish(timers[index], "answered", tally((1, 1)))

    threads = [threading.Thread(target=finish, args=(index,)) for index in range(len(timers))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert log.flush(6)
    rows = stored_rows(raw)
    assert len(rows) == 2
    assert [row[1:] for row in rows][0] == [row[1:] for row in rows][1]


@pytest.mark.integration
def test_reqlog_ac36_write_failure_logs_one_line_without_user_or_pseudonym(
    caplog: pytest.LogCaptureFixture,
):
    log = recorder(database_url=database_url_on(free_port()))
    caplog.set_level(logging.WARNING, logger="ai_service.request_log")
    log.finish(log.start("ask", USER, WORKSPACE), "answered", tally((1_200, 300)))
    assert log.flush(6)
    assert warnings(caplog) == ["request log write failed task=ask error=OperationalError"]
    text = caplog.text
    assert USER not in text
    assert pseudonym(REQUEST_LOG_KEY, USER) not in text
    assert WORKSPACE not in text


@pytest.mark.integration
def test_reqlog_ac53_silent_database_holds_no_request_and_is_given_up_within_six_seconds(
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.WARNING, logger="ai_service.request_log")
    with silent_server() as port:
        log = recorder(database_url=database_url_on(port))
        timer = log.start("extraction", USER, WORKSPACE)
        started = time.monotonic()
        log.finish(timer, "extracted", tally((4_814, 250)))
        returned = time.monotonic() - started
        assert warnings(caplog) == []
        flushed = log.flush(6)
        given_up = time.monotonic() - started
    assert returned < AT_ONCE_SECONDS
    assert flushed
    assert given_up < 6
    [line] = warnings(caplog)
    assert line.startswith("request log write failed task=extraction error=")
    assert USER not in caplog.text
    assert pseudonym(REQUEST_LOG_KEY, USER) not in caplog.text


@pytest.mark.integration
def test_reqlog_ac37_delete_older_than_removes_only_older_rows(raw: psycopg.Connection):
    log = recorder()
    timer = log.start("ask", USER, WORKSPACE)
    cutoff = HOUR - REQUEST_LOG_RETENTION
    store = RequestLogStore(raw)
    old = replace(log.record(timer, "answered", tally()), created_at=cutoff - timedelta(minutes=1))
    kept = replace(log.record(timer, "answered", tally()), created_at=cutoff + timedelta(hours=1))
    store.insert(old)
    store.insert(kept)
    assert store.delete_older_than(cutoff) == 1
    assert [row[0] for row in stored_rows(raw)] == [kept.id]


@pytest.mark.integration
def test_reqlog_ac25_downgrade_drops_the_request_log_and_upgrade_restores_it(tmp_path: Path):
    with fresh_ai_schema(tmp_path):
        migrate()
        assert schemas_holding(["request_log"]) == [("ai", "request_log")]
        downgrade = run_alembic(f"uv run alembic downgrade {AGENT_REVISION}")
        assert downgrade.returncode == 0, downgrade.stderr
        with psycopg.connect(AI_URL) as ai:
            version = ai.execute("SELECT version_num FROM ai.alembic_version").fetchall()
        assert schemas_holding(["request_log"]) == []
        assert schemas_holding(["agent_runs"]) == [("ai", "agent_runs")]
        assert version == [(AGENT_REVISION,)]
        migrate()
        assert schemas_holding(["request_log"]) == [("ai", "request_log")]


def test_reqlog_ac25_record_fields_are_the_table_columns():
    assert list(RequestRecord.__dataclass_fields__) == REQUEST_LOG_COLUMNS
