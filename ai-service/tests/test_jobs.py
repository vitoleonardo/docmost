import json
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from redis import Redis

from ai_service.app import create_app
from ai_service.settings import Settings
from tests.conftest import TEST_REDIS_URL, WORKSPACE_ID, idle_ask_pipeline

STREAM = "ai-service:jobs"


def stream_entries(redis_client: Redis) -> list[Any]:
    return redis_client.xrange(STREAM) or []


def test_bridge_ac29_job_is_accepted_and_stored(
    client: TestClient, redis_client: Redis, service_headers: dict[str, str]
):
    data = {"pageIds": ["p1", "p2"], "workspaceId": WORKSPACE_ID}
    response = client.post(
        "/v1/jobs", headers=service_headers, json={"name": "page-created", "data": data}
    )
    entries = stream_entries(redis_client)
    assert response.status_code == 202
    assert len(entries) == 1
    assert response.json() == {"id": entries[0][0]}
    assert entries[0][1]["name"] == "page-created"
    assert json.loads(entries[0][1]["data"]) == data
    assert entries[0][1]["receivedAt"]


def test_bridge_ac30_each_forwarded_job_is_one_entry(
    client: TestClient, redis_client: Redis, service_headers: dict[str, str]
):
    for name in ["page-content-updated", "space-deleted"]:
        client.post("/v1/jobs", headers=service_headers, json={"name": name, "data": {}})
    assert [entry[1]["name"] for entry in stream_entries(redis_client)] == [
        "page-content-updated",
        "space-deleted",
    ]


def test_bridge_ac71_rejected_job_is_not_stored(client: TestClient, redis_client: Redis):
    client.post("/v1/jobs", json={"name": "page-created", "data": {}})
    assert stream_entries(redis_client) == []


@pytest.mark.parametrize(
    "body",
    [
        {"data": {}},
        {"name": "", "data": {}},
        {"name": "page-created"},
        {"name": "page-created", "data": "text"},
        {"name": 5, "data": {}},
    ],
)
def test_bridge_ac29_invalid_body_is_rejected(
    client: TestClient,
    redis_client: Redis,
    service_headers: dict[str, str],
    body: dict[str, object],
):
    response = client.post("/v1/jobs", headers=service_headers, json=body)
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
    assert set(response.json()) == {"code", "message"}
    assert stream_entries(redis_client) == []


@pytest.fixture
def real_redis() -> Iterator[None]:
    cleaner: Redis = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    cleaner.delete(STREAM)
    yield
    cleaner.delete(STREAM)
    cleaner.close()


@pytest.mark.integration
@pytest.mark.usefixtures("real_redis")
def test_bridge_ac31_job_survives_service_restart(
    settings: Settings, service_headers: dict[str, str]
):
    first_client: Redis = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    first_app = TestClient(create_app(settings, first_client, idle_ask_pipeline(first_client)))
    response = first_app.post(
        "/v1/jobs",
        headers=service_headers,
        json={"name": "page-created", "data": {"pageIds": ["p1"]}},
    )
    job_id = response.json()["id"]
    first_app.close()
    first_client.close()
    del first_app, first_client

    second_client: Redis = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    create_app(settings, second_client, idle_ask_pipeline(second_client))
    entries = stream_entries(second_client)
    second_client.close()
    assert [entry[0] for entry in entries] == [job_id]
    assert entries[0][1]["name"] == "page-created"
