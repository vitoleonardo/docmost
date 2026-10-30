import json
from collections.abc import Callable, Iterable, Iterator
from typing import Any, cast

import httpx

SEED_EMAILS = {
    "GF": "joerg.ostmoor@ostmooimooi.example.com",
    "PL": "sabine.kettler@ostmooimooi.example.com",
    "VT": "tobias.renner@ostmooimooi.example.com",
    "WS": "lukas.brehm@ostmooimooi.example.com",
}
LOGIN_THROTTLE_SECONDS = 61
LIST_PAGE_SIZE = 100

Sleep = Callable[[float], None]


class StartFailed(Exception):
    pass


def log_in(client: httpx.Client, email: str, password: str, sleep: Sleep) -> httpx.Response:
    credentials = {"email": email, "password": password}
    response = client.post("/api/auth/login", json=credentials)
    if response.status_code == 429:
        sleep(LOGIN_THROTTLE_SECONDS)
        response = client.post("/api/auth/login", json=credentials)
    return response


def post_data(client: httpx.Client, path: str, body: dict[str, Any]) -> dict[str, Any]:
    response = client.post(path, json=body)
    response.raise_for_status()
    return cast(dict[str, Any], response.json()["data"])


def list_space_pages(client: httpx.Client, space_id: str) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        body: dict[str, Any] = {"spaceId": space_id, "limit": LIST_PAGE_SIZE}
        if cursor:
            body["cursor"] = cursor
        data = post_data(client, "/api/pages/recent", body)
        pages.extend(data["items"])
        if not data["meta"]["hasNextPage"]:
            return pages
        cursor = data["meta"]["nextCursor"]


def parse_sse_events(lines: Iterable[str]) -> Iterator[dict[str, Any]]:
    for line in lines:
        if line.startswith("data:"):
            yield json.loads(line.removeprefix("data:").strip())
