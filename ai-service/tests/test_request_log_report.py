import socket
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest

from ai_service.request_log import REQUEST_LOG_RETENTION, RequestLogStore, RequestRecord
from ai_service.request_log_report import render_report
from tests.test_db_role import AI_URL
from tests.test_migrations import fresh_ai_schema, migrate

NOW = datetime(2026, 10, 30, 14, 5, tzinfo=UTC)
PSEUDONYM = "ab" * 32
WORKSPACE = "0192f000-0000-7000-8000-0000000000f3"
LOCAL_SENTENCE = "Local mode costs 0 USD: hardware and energy are not counted."
EMPTY_PERIOD = "No requests in the last 30 days."
TABLE_COLUMNS = 12


def record(
    task: str = "ask",
    mode: str = "local",
    model: str = "qwen3:8b",
    status: str = "answered",
    latency_ms: int = 1000,
    prompt_tokens: int | None = 100,
    completion_tokens: int | None = 10,
    cost_usd: Decimal | None = Decimal(0),
    created_at: datetime = NOW,
    row_id: str = "0192f000-0000-7000-8000-000000000001",
) -> RequestRecord:
    return RequestRecord(
        id=row_id,
        created_at=created_at,
        task=task,  # pyright: ignore[reportArgumentType]
        mode=mode,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        latency_ms=latency_ms,
        cost_usd=cost_usd,
        status=status,
        user_pseudonym=PSEUDONYM,
        workspace_id=WORKSPACE,
    )


def table_rows(report: str) -> list[list[str]]:
    lines = [line for line in report.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in line.strip("|").split("|")] for line in lines[2:]]


def test_reqlog_ac38_report_holds_the_local_mode_sentence():
    report = render_report([record()], NOW)
    assert LOCAL_SENTENCE in report.splitlines()


def test_reqlog_ac38_header_lines_use_german_dates_and_a_thirty_day_period():
    lines = render_report([record()], NOW).splitlines()
    assert lines[:5] == [
        "# Request log",
        "",
        "- Date: 30.10.2026",
        "- Period: 30.09.2026 to 30.10.2026",
        "",
    ]
    assert lines[5] == LOCAL_SENTENCE


def test_reqlog_ac38_table_has_the_twelve_columns_in_the_spec_order():
    report = render_report([record()], NOW)
    header = [line for line in report.splitlines() if line.startswith("|")][0]
    cells = [cell.strip() for cell in header.strip("|").split("|")]
    assert len(cells) == TABLE_COLUMNS
    assert cells[:5] == ["Task", "Mode", "Model", "Requests", "Failed requests"]
    assert cells[-2:] == ["Cost (USD)", "Cost per 1,000 requests (USD)"]


def test_reqlog_ac39_counts_requests_and_failed_requests_per_task_mode_and_model():
    rows = [
        record(row_id="1"),
        record(row_id="2"),
        record(row_id="3", status="model_failed"),
    ]
    [row] = table_rows(render_report(rows, NOW))
    assert row[:5] == ["ask", "local", "qwen3:8b", "3", "1"]


def test_reqlog_ac40_median_and_95th_percentile_interpolate_between_ranks():
    rows = [record(row_id=str(n), latency_ms=n * 100) for n in range(1, 21)]
    [row] = table_rows(render_report(rows, NOW))
    assert row[6:8] == ["1050", "1905"]


def test_reqlog_ac40_percentile_of_a_single_request_is_its_latency():
    [row] = table_rows(render_report([record(latency_ms=777)], NOW))
    assert row[6:8] == ["777", "777"]


def test_reqlog_ac40_percentile_rounds_half_up_to_whole_milliseconds():
    rows = [record(row_id="1", latency_ms=100), record(row_id="2", latency_ms=101)]
    [row] = table_rows(render_report(rows, NOW))
    assert row[6] == "101"


def test_reqlog_ac40_failed_requests_count_in_the_percentiles():
    rows = [
        record(row_id="1", latency_ms=100),
        record(row_id="2", latency_ms=300, status="error"),
    ]
    [row] = table_rows(render_report(rows, NOW))
    assert row[6] == "200"


def api_agent_rows() -> list[RequestRecord]:
    priced = [
        record(row_id=str(n), task="agent", mode="api", model="claude-test", cost_usd=Decimal(cost))
        for n, cost in enumerate(["0.01", "0.02", "0.03"])
    ]
    unpriced = record(
        row_id="9",
        task="agent",
        mode="api",
        model="claude-test",
        prompt_tokens=None,
        completion_tokens=None,
        cost_usd=None,
    )
    return [*priced, unpriced]


def test_reqlog_ac41_cost_sum_cost_per_thousand_and_requests_without_token_count():
    [row] = table_rows(render_report(api_agent_rows(), NOW))
    assert (row[3], row[5], row[10], row[11]) == ("4", "1", "0.06", "20")


def test_reqlog_ac41_token_sums_leave_out_empty_counts():
    [row] = table_rows(render_report(api_agent_rows(), NOW))
    assert row[8:10] == ["300", "30"]


def test_reqlog_ac41_cost_is_an_empty_cell_when_no_row_has_a_cost():
    rows = [record(mode="api", cost_usd=None, prompt_tokens=None, completion_tokens=None)]
    [row] = table_rows(render_report(rows, NOW))
    assert row[8:] == ["-", "-", "-", "-"]


def test_reqlog_ac41_costs_have_up_to_six_decimals_without_trailing_zeros():
    rows = [
        record(row_id="1", mode="api", cost_usd=Decimal("0.000001")),
        record(row_id="2", mode="api", cost_usd=Decimal("0.0081")),
    ]
    [row] = table_rows(render_report(rows, NOW))
    assert (row[10], row[11]) == ("0.008101", "4.0505")


def test_reqlog_ac41_zero_cost_is_written_as_zero():
    [row] = table_rows(render_report([record()], NOW))
    assert (row[10], row[11]) == ("0", "0")


def test_reqlog_ac42_no_rows_gives_the_empty_line_and_no_table():
    report = render_report([], NOW)
    assert EMPTY_PERIOD in report.splitlines()
    assert LOCAL_SENTENCE in report.splitlines()
    assert "|" not in report


def test_reqlog_ac43_report_holds_no_pseudonym_and_no_workspace_id():
    report = render_report([record()], NOW)
    assert PSEUDONYM not in report
    assert WORKSPACE not in report


def test_reqlog_ac55_context_too_small_extraction_counts_as_failed():
    rows = [
        record(task="extraction", status="context_too_small", row_id="1"),
        record(task="extraction", status="extracted", row_id="2"),
    ]
    [row] = table_rows(render_report(rows, NOW))
    assert row[:5] == ["extraction", "local", "qwen3:8b", "2", "1"]


@pytest.mark.parametrize("status", ["model_failed", "filter_failed", "context_too_small", "error"])
def test_reqlog_ac39_every_failed_status_counts_as_failed(status: str):
    [row] = table_rows(render_report([record(status=status)], NOW))
    assert row[4] == "1"


@pytest.mark.parametrize("status", ["answered", "no_source", "stopped", "cancelled", "finished"])
def test_reqlog_ac39_other_statuses_do_not_count_as_failed(status: str):
    [row] = table_rows(render_report([record(status=status)], NOW))
    assert row[4] == "0"


def test_reqlog_ac39_rows_are_sorted_by_task_mode_and_model():
    rows = [
        record(task="extraction", row_id="1"),
        record(task="ask", mode="local", model="b", row_id="2"),
        record(task="ask", mode="api", model="z", row_id="3"),
        record(task="ask", mode="local", model="a", row_id="4"),
    ]
    keys = [tuple(row[:3]) for row in table_rows(render_report(rows, NOW))]
    assert keys == [
        ("ask", "api", "z"),
        ("ask", "local", "a"),
        ("ask", "local", "b"),
        ("extraction", "local", "qwen3:8b"),
    ]


@pytest.fixture(scope="module")
def database(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    with fresh_ai_schema(tmp_path_factory.mktemp("request-log-report")):
        migrate()
        yield


@pytest.fixture
def seeded(database: None) -> Iterator[None]:
    with psycopg.connect(AI_URL, autocommit=True) as conn:
        conn.execute("DELETE FROM ai.request_log")
        store = RequestLogStore(conn)
        too_old = datetime.now(UTC) - REQUEST_LOG_RETENTION - timedelta(minutes=1)
        store.insert(record(row_id="0192f000-0000-7000-8000-0000000000a1", created_at=too_old))
        store.insert(
            replace(
                record(row_id="0192f000-0000-7000-8000-0000000000a2"),
                created_at=datetime.now(UTC).replace(minute=0, second=0, microsecond=0),
                model="fresh-model",
            )
        )
        yield
        conn.execute("DELETE FROM ai.request_log")


def closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.mark.integration
def test_reqlog_ac42_main_writes_the_report_and_leaves_out_rows_older_than_thirty_days(
    seeded: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    from ai_service.request_log_report import main

    target = tmp_path / "reports" / "request-log.md"
    monkeypatch.setenv("AI_DATABASE_URL", AI_URL)
    monkeypatch.setenv("REQUEST_LOG_REPORT_PATH", str(target))
    main()
    report = target.read_text()
    assert "fresh-model" in report
    assert len(table_rows(report)) == 1
    assert [path.name for path in target.parent.iterdir()] == ["request-log.md"]


@pytest.mark.integration
def test_reqlog_ac54_unreachable_database_exits_naming_it_and_keeps_the_report(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    from ai_service.request_log_report import main

    target = tmp_path / "request-log.md"
    target.write_bytes(b"# Request log\nearlier report\n")
    unreachable = f"postgresql://reader:hunter2-secret@127.0.0.1:{closed_port()}/docmost_ai_gone"
    monkeypatch.setenv("AI_DATABASE_URL", unreachable)
    monkeypatch.setenv("REQUEST_LOG_REPORT_PATH", str(target))
    with pytest.raises(SystemExit) as stopped:
        main()
    message = capsys.readouterr().err
    assert stopped.value.code not in (0, None)
    assert "docmost_ai_gone" in message
    assert "127.0.0.1" in message
    assert "hunter2-secret" not in message
    assert target.read_bytes() == b"# Request log\nearlier report\n"
    assert [path.name for path in tmp_path.iterdir()] == ["request-log.md"]
