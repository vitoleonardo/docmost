import os
import tempfile
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from math import floor
from pathlib import Path

import psycopg
from psycopg.conninfo import conninfo_to_dict
from pydantic import ValidationError

from ai_service.prices import COST_PRECISION
from ai_service.request_log import (
    REQUEST_LOG_RETENTION,
    UTC_NOW,
    RequestLogStore,
    RequestRecord,
)
from ai_service.settings import RequestLogReportSettings
from ai_service.worker import configure_logging, describe_settings_error, exit_with

FAILED_STATUSES = frozenset({"model_failed", "filter_failed", "context_too_small", "error"})
EMPTY_CELL = "-"
CONNECT_TIMEOUT_SECONDS = 10
COLUMNS = [
    "Task",
    "Mode",
    "Model",
    "Requests",
    "Failed requests",
    "Requests without token count",
    "Median latency (ms)",
    "95th percentile latency (ms)",
    "Prompt tokens",
    "Completion tokens",
    "Cost (USD)",
    "Cost per 1,000 requests (USD)",
]
LOCAL_MODE_NOTE = "Local mode costs 0 USD: hardware and energy are not counted."
NO_REQUESTS = "No requests in the last 30 days."


def percentile(values: Sequence[int], fraction: Decimal) -> int:
    ordered = sorted(values)
    position = fraction * (len(ordered) - 1)
    lower = floor(position)
    value = Decimal(ordered[lower])
    if lower + 1 < len(ordered):
        value += (position - lower) * (ordered[lower + 1] - ordered[lower])
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def format_cost(cost: Decimal) -> str:
    rounded = cost.quantize(COST_PRECISION, rounding=ROUND_HALF_UP)
    return format(rounded.normalize(), "f")


def table_row(key: tuple[str, str, str], rows: Sequence[RequestRecord]) -> str:
    latencies = [row.latency_ms for row in rows]
    prompts = [row.prompt_tokens for row in rows if row.prompt_tokens is not None]
    completions = [row.completion_tokens for row in rows if row.completion_tokens is not None]
    costs = [row.cost_usd for row in rows if row.cost_usd is not None]
    cost_cells = [EMPTY_CELL, EMPTY_CELL]
    if costs:
        total = sum(costs, Decimal(0))
        cost_cells = [format_cost(total), format_cost(total / len(costs) * 1000)]
    without_counts = sum(row.prompt_tokens is None or row.completion_tokens is None for row in rows)
    cells = [
        *key,
        str(len(rows)),
        str(sum(row.status in FAILED_STATUSES for row in rows)),
        str(without_counts),
        str(percentile(latencies, Decimal("0.5"))),
        str(percentile(latencies, Decimal("0.95"))),
        str(sum(prompts)) if prompts else EMPTY_CELL,
        str(sum(completions)) if completions else EMPTY_CELL,
        *cost_cells,
    ]
    return "| " + " | ".join(cells) + " |"


def render_report(rows: Sequence[RequestRecord], now: datetime) -> str:
    period_start = (now - REQUEST_LOG_RETENTION).date()
    lines = [
        "# Request log",
        "",
        f"- Date: {now.strftime('%d.%m.%Y')}",
        f"- Period: {period_start.strftime('%d.%m.%Y')} to {now.strftime('%d.%m.%Y')}",
        "",
        LOCAL_MODE_NOTE,
        "",
    ]
    if not rows:
        return "\n".join([*lines, NO_REQUESTS]) + "\n"
    groups: dict[tuple[str, str, str], list[RequestRecord]] = defaultdict(list)
    for row in rows:
        groups[(row.task, row.mode, row.model)].append(row)
    lines.append("| " + " | ".join(COLUMNS) + " |")
    lines.append("|" + "|".join("---" for _ in COLUMNS) + "|")
    lines.extend(table_row(key, groups[key]) for key in sorted(groups))
    return "\n".join(lines) + "\n"


def replace_file(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, encoding="utf-8", suffix=".tmp"
    ) as staged:
        staged.write(text)
    os.replace(staged.name, path)


def describe_database(database_url: str) -> str:
    target = conninfo_to_dict(database_url)
    return f"database {target.get('dbname', '')} on host {target.get('host', '')}"


def main() -> None:
    configure_logging()
    try:
        settings = RequestLogReportSettings()  # pyright: ignore[reportCallIssue]
    except ValidationError as error:
        exit_with(describe_settings_error(error), error)
    now = UTC_NOW()
    try:
        with psycopg.connect(
            settings.ai_database_url, connect_timeout=CONNECT_TIMEOUT_SECONDS
        ) as conn:
            rows = RequestLogStore(conn).rows_since(now - REQUEST_LOG_RETENTION)
    except psycopg.Error as error:
        exit_with(
            f"Cannot read the request log from {describe_database(settings.ai_database_url)}: "
            f"{type(error).__name__}",
            error,
        )
    replace_file(settings.request_log_report_path, render_report(rows, now))


if __name__ == "__main__":
    main()
