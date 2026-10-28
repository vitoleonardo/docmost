import base64
import json
import time
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from tests.conftest import USER_ID, WORKSPACE_ID

JOB_BODY = {"name": "page-created", "data": {"pageIds": ["a"], "workspaceId": WORKSPACE_ID}}
ROUTES = ["/v1/session", "/v1/jobs"]


def post(client: TestClient, path: str, headers: dict[str, str]) -> httpx.Response:
    return client.post(path, headers=headers, json=JOB_BODY if path == "/v1/jobs" else None)


def b64(value: dict[str, object]) -> str:
    raw = json.dumps(value).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def session(client: TestClient, service_headers: dict[str, str], token: str) -> httpx.Response:
    return post(client, "/v1/session", {**service_headers, "X-User-Token": token})


@pytest.mark.parametrize("path", ROUTES)
def test_bridge_ac71_missing_service_token(client: TestClient, path: str):
    response = post(client, path, {})
    assert response.status_code == 401
    assert response.json()["code"] == "service_token_missing"
    assert set(response.json()) == {"code", "message"}


def test_bridge_ac71_empty_service_token(client: TestClient):
    response = post(client, "/v1/jobs", {"X-Service-Token": ""})
    assert response.status_code == 401
    assert response.json()["code"] == "service_token_missing"


@pytest.mark.parametrize("path", ROUTES)
def test_bridge_ac72_wrong_service_token(client: TestClient, path: str):
    response = post(client, path, {"X-Service-Token": "wrong-service-token-0123456789abcdef"})
    assert response.status_code == 401
    assert response.json()["code"] == "service_token_invalid"


def test_bridge_ac72_service_token_checked_before_user_token(
    client: TestClient, make_token: Callable[..., str]
):
    headers = {"X-Service-Token": "wrong", "X-User-Token": make_token()}
    assert post(client, "/v1/session", headers).json()["code"] == "service_token_invalid"


def test_bridge_ac73_expired_user_token(
    client: TestClient, service_headers: dict[str, str], make_token: Callable[..., str]
):
    now = int(time.time())
    response = session(client, service_headers, make_token(iat=now - 120, exp=now - 60))
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_expired"


def test_bridge_ac74_missing_user_token(client: TestClient, service_headers: dict[str, str]):
    response = post(client, "/v1/session", service_headers)
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_missing"


def test_bridge_ac74_malformed_user_token(client: TestClient, service_headers: dict[str, str]):
    response = session(client, service_headers, "not-a-jwt")
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


def test_bridge_ac74_other_audience(
    client: TestClient, service_headers: dict[str, str], make_token: Callable[..., str]
):
    response = session(client, service_headers, make_token(aud="other-service"))
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


def test_bridge_ac74_missing_audience(
    client: TestClient, service_headers: dict[str, str], make_token: Callable[..., str]
):
    response = session(client, service_headers, make_token(aud=None))
    assert response.json()["code"] == "user_token_invalid"


def test_bridge_ac74_alg_none(client: TestClient, service_headers: dict[str, str]):
    now = int(time.time())
    claims = {
        "sub": USER_ID,
        "workspaceId": WORKSPACE_ID,
        "aud": "ai-service",
        "type": "user",
        "iat": now,
        "exp": now + 60,
    }
    token = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(claims)}."
    response = session(client, service_headers, token)
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


def test_bridge_ac74_other_secret(
    client: TestClient, service_headers: dict[str, str], make_token: Callable[..., str]
):
    response = session(
        client, service_headers, make_token(secret="another-secret-0123456789abcdefghij")
    )
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


def test_bridge_ac74_task_token_on_session(
    client: TestClient, service_headers: dict[str, str], make_token: Callable[..., str]
):
    token = make_token(type="task", runId="run-1", exp=int(time.time()) + 600)
    response = session(client, service_headers, token)
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


@pytest.mark.parametrize("claim", ["sub", "exp", "iat", "workspaceId"])
def test_bridge_ac74_required_claim_missing(
    client: TestClient,
    service_headers: dict[str, str],
    make_token: Callable[..., str],
    claim: str,
):
    response = session(client, service_headers, make_token(**{claim: None}))
    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


def test_bridge_ac3_valid_user_token_opens_session(
    client: TestClient, service_headers: dict[str, str], make_token: Callable[..., str]
):
    response = session(client, service_headers, make_token())
    assert response.status_code == 200
    assert response.json() == {"userId": USER_ID, "workspaceId": WORKSPACE_ID}


@pytest.mark.parametrize("path", ROUTES)
@pytest.mark.parametrize("content", [b"{not json", b"", b'{"name": 3}'])
def test_bridge_ac71_missing_token_wins_over_malformed_body(
    client: TestClient, path: str, content: bytes
):
    response = client.post(path, content=content, headers={"Content-Type": "application/json"})
    assert response.status_code == 401
    assert response.json()["code"] == "service_token_missing"


def test_bridge_ac72_wrong_token_wins_over_malformed_body(client: TestClient):
    response = client.post(
        "/v1/jobs",
        content=b"{not json",
        headers={"Content-Type": "application/json", "X-Service-Token": "wrong"},
    )
    assert response.status_code == 401
    assert response.json()["code"] == "service_token_invalid"


def test_bridge_ac71_valid_token_with_malformed_body_is_invalid_request(
    client: TestClient, service_headers: dict[str, str]
):
    response = client.post(
        "/v1/jobs",
        content=b"{not json",
        headers={"Content-Type": "application/json", **service_headers},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
