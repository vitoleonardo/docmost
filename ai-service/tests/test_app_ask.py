import asyncio
import json
import logging
import threading
import time
from collections.abc import Callable, Generator, MutableMapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fakeredis
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from redis import Redis

from ai_service import __main__ as api_main
from ai_service.app import create_app
from ai_service.auth import UserSession, decode_user_token
from ai_service.embedding import EmbeddingModelError
from ai_service.inference import StreamUsage
from ai_service.request_log import RequestLog, TokenTally
from tests.conftest import (
    BRIDGE_KEY,
    REQUEST_LOG_KEY,
    SERVICE_CREDENTIAL,
    UNREACHABLE_DATABASE_URL,
    USER_ID,
    WORKSPACE_ID,
    HeldRequestLog,
    idle_extraction_pipeline,
    make_settings,
    warnings,
)
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import SPACE_A, page_id
from tests.test_ask import CONVERSATION_ID, OTHER_USER_ID, Harness, hit
from tests.test_request_log import AT_ONCE_SECONDS, database_url_on, silent_server

PATH = "/v1/ask"
QUESTION = "Wie lautet die Regel?"
BODY = {"question": QUESTION, "conversationId": CONVERSATION_ID}
USER_SPACE = "0192f000-0000-7000-8000-000000000003"
TOKEN_TIMEOUT_SECONDS = 5


@pytest.fixture
def harness(redis_client: Redis) -> Harness:
    prepared = Harness(redis=redis_client)
    prepared.search.hits = [hit(1, space_id=USER_SPACE)]
    prepared.bridge.viewable = {page_id(1)}
    return prepared


def make_client(harness: Harness, request_log: RequestLog | None = None) -> TestClient:
    return TestClient(
        create_app(
            make_settings(),
            fakeredis.FakeRedis(),
            harness.pipeline(request_log),
            idle_extraction_pipeline(),
        )
    )


def ask(
    client: TestClient, headers: dict[str, str], body: dict[str, Any] | None = None
) -> httpx.Response:
    return client.post(PATH, headers=headers, json=BODY if body is None else body)


def lines(response: httpx.Response) -> list[dict[str, Any]]:
    return [json.loads(line) for line in response.text.splitlines()]


def test_ask_ac9_the_response_is_ndjson_with_one_event_per_line_in_order(
    harness: Harness, headers: dict[str, str]
):
    harness.model.deltas = ["Die Regel ", "steht hier [1]."]

    response = ask(make_client(harness), headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    received = lines(response)
    assert received == [
        {"type": "delta", "text": "Die Regel "},
        {"type": "delta", "text": "steht hier [1]."},
        {
            "type": "citations",
            "turnId": received[-1]["turnId"],
            "citations": [
                {
                    "number": 1,
                    "pageId": page_id(1),
                    "headingPath": [],
                    "attachmentId": None,
                    "fileName": None,
                    "pdfPage": None,
                }
            ],
        },
    ]


def test_ask_ac9_the_session_scope_and_token_reach_the_pipeline(
    harness: Harness, headers: dict[str, str]
):
    response = ask(make_client(harness), headers, {**BODY, "pageId": page_id(1)})

    assert lines(response)[-1]["type"] == "citations"
    assert harness.search.calls == [(QUESTION, [USER_SPACE], page_id(1), 20)]
    assert harness.bridge.user_tokens == [headers["X-User-Token"]]


def test_ask_ac9_no_source_is_one_line(harness: Harness, headers: dict[str, str]):
    harness.search.hits = []

    response = ask(make_client(harness), headers)

    assert lines(response) == [{"type": "no_source"}]


@dataclass
class AsgiCall:
    app: FastAPI
    headers: dict[str, str]
    body: dict[str, Any]
    path: str = PATH
    sent: asyncio.Queue[MutableMapping[str, Any]] = field(default_factory=asyncio.Queue)
    disconnected: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None

    def start(self) -> None:
        self.task = asyncio.get_running_loop().create_task(self._run())

    async def _run(self) -> None:
        payload = json.dumps(self.body).encode()
        delivered = False

        async def receive() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": payload, "more_body": False}
            await self.disconnected.wait()
            return {"type": "http.disconnect"}

        raw_headers = [(b"content-type", b"application/json")] + [
            (name.lower().encode(), value.encode()) for name, value in self.headers.items()
        ]
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "POST",
            "path": self.path,
            "raw_path": self.path.encode(),
            "query_string": b"",
            "headers": raw_headers,
            "scheme": "http",
            "server": ("test", 80),
            "client": ("test", 1),
        }
        await self.app(scope, receive, self.sent.put)

    async def next_line(self) -> dict[str, Any] | None:
        while True:
            message = await asyncio.wait_for(self.sent.get(), TOKEN_TIMEOUT_SECONDS)
            if message["type"] == "http.response.body" and message["body"]:
                return json.loads(message["body"])
            if message["type"] == "http.response.body" and not message.get("more_body"):
                return None

    async def finish(self) -> None:
        assert self.task is not None
        await asyncio.wait_for(self.task, TOKEN_TIMEOUT_SECONDS)


def test_ask_ac9_the_first_line_reaches_the_client_before_the_last_delta_exists(
    harness: Harness, headers: dict[str, str]
):
    first_line_read = threading.Event()
    harness.model.stream = _blocking_stream(first_line_read)  # type: ignore[method-assign]

    async def scenario() -> list[dict[str, Any] | None]:
        call = AsgiCall(
            create_app(
                make_settings(),
                fakeredis.FakeRedis(),
                harness.pipeline(),
                idle_extraction_pipeline(),
            ),
            headers,
            BODY,
        )
        call.start()
        first = await call.next_line()
        first_line_read.set()
        rest = [await call.next_line(), await call.next_line()]
        await call.finish()
        return [first, *rest]

    first, second, third = asyncio.run(scenario())

    assert first == {"type": "delta", "text": "Anfang [1] "}
    assert second == {"type": "delta", "text": "Ende."}
    assert third is not None and third["type"] == "citations"


def _blocking_stream(
    release: threading.Event,
) -> Callable[[list[dict[str, str]], StreamUsage | None], Generator[str]]:
    def stream(messages: list[dict[str, str]], usage: StreamUsage | None = None) -> Generator[str]:
        yield "Anfang [1] "
        assert release.wait(TOKEN_TIMEOUT_SECONDS), "first line was not delivered before the end"
        yield "Ende."

    return stream


def test_ask_ac13_a_client_that_disconnects_after_the_first_line_stops_the_pipeline(
    harness: Harness, headers: dict[str, str], caplog: pytest.LogCaptureFixture
):
    caplog.set_level(logging.INFO)
    harness.model.deltas = ["Erster Teil [1] ", "zweiter Teil ", "dritter Teil."]

    async def scenario() -> None:
        call = AsgiCall(
            create_app(
                make_settings(),
                fakeredis.FakeRedis(),
                harness.pipeline(),
                idle_extraction_pipeline(),
            ),
            headers,
            BODY,
        )
        call.start()
        assert await call.next_line() == {"type": "delta", "text": "Erster Teil [1] "}
        call.disconnected.set()
        await call.finish()

    asyncio.run(scenario())

    deadline = time.monotonic() + TOKEN_TIMEOUT_SECONDS
    while not harness.model.closed and time.monotonic() < deadline:
        time.sleep(0.01)
    assert harness.model.closed
    assert harness.stored() == []
    assert [
        r.getMessage().rsplit("outcome=", 1)[-1]
        for r in caplog.records
        if r.name == "ai_service.ask"
    ] == ["stopped"]


@pytest.mark.parametrize(
    ("service_token", "code"),
    [(None, "service_token_missing"), ("x" * 32, "service_token_invalid")],
)
def test_ask_ac71_a_missing_or_wrong_service_token_is_401(
    harness: Harness,
    make_token: Callable[..., str],
    service_token: str | None,
    code: str,
):
    request_headers = {"X-User-Token": make_token()}
    if service_token is not None:
        request_headers["X-Service-Token"] = service_token

    response = ask(make_client(harness), request_headers)

    assert response.status_code == 401
    assert response.json()["code"] == code
    assert harness.search.calls == []


def test_ask_ac71_the_service_token_is_checked_before_the_body(
    harness: Harness, make_token: Callable[..., str]
):
    response = ask(make_client(harness), {"X-User-Token": make_token()}, {"userId": "x"})

    assert response.json()["code"] == "service_token_missing"


def test_ask_ac71_a_missing_user_token_is_401(harness: Harness, service_headers: dict[str, str]):
    response = ask(make_client(harness), service_headers)

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_missing"
    assert harness.search.calls == []


def test_ask_ac71_an_expired_user_token_is_401(
    harness: Harness, service_headers: dict[str, str], make_token: Callable[..., str]
):
    now = int(time.time())
    expired = make_token(iat=now - 120, exp=now - 60)

    response = ask(make_client(harness), {**service_headers, "X-User-Token": expired})

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_expired"
    assert harness.search.calls == []


@pytest.mark.parametrize(
    "token_arguments",
    [
        {"secret": BRIDGE_KEY[::-1]},
        {"aud": "someone-else"},
        {"secret": "", "algorithm": "none"},
        {"spaceIds": "not-a-list"},
        {"spaceIds": [1]},
        {"type": "task"},
    ],
    ids=[
        "other-secret",
        "wrong-audience",
        "alg-none",
        "space-ids-string",
        "space-ids-ints",
        "type",
    ],
)
def test_ask_ac72_an_invalid_user_token_is_user_token_invalid(
    harness: Harness,
    service_headers: dict[str, str],
    make_token: Callable[..., str],
    token_arguments: dict[str, Any],
):
    token = make_token(**token_arguments)

    response = ask(make_client(harness), {**service_headers, "X-User-Token": token})

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"
    assert harness.search.calls == []


def test_ask_ac72_a_malformed_user_token_is_user_token_invalid(
    harness: Harness, service_headers: dict[str, str]
):
    response = ask(make_client(harness), {**service_headers, "X-User-Token": "not.a.jwt"})

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "question": ""},
        {**BODY, "question": "   "},
        {**BODY, "question": "x" * 2001},
        {**BODY, "spaceId": SPACE_A, "pageId": page_id(1)},
        {**BODY, "userId": USER_ID},
        {"conversationId": CONVERSATION_ID},
        {"question": QUESTION},
        {**BODY, "conversationId": "not-a-uuid"},
        {**BODY, "spaceId": "not-a-uuid"},
        {**BODY, "pageId": 7},
    ],
    ids=[
        "empty",
        "blank",
        "2001-chars",
        "both-scopes",
        "unknown-field-userId",
        "no-question",
        "no-conversation",
        "bad-conversation",
        "bad-space",
        "bad-page",
    ],
)
def test_ask_ac73_an_invalid_body_is_400_invalid_request(
    harness: Harness, headers: dict[str, str], body: dict[str, Any]
):
    response = ask(make_client(harness), headers, body)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
    assert set(response.json()) == {"code", "message"}
    assert harness.search.calls == []


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "question": "x" * 2000},
        {**BODY, "question": "  " + "x" * 2000 + "  "},
        {**BODY, "spaceId": SPACE_A},
        {**BODY, "pageId": page_id(1)},
    ],
    ids=["2000-chars", "2000-chars-padded", "space", "page"],
)
def test_ask_ac73_the_limits_and_one_scope_are_accepted(
    harness: Harness, headers: dict[str, str], body: dict[str, Any]
):
    harness.search.hits = []

    response = ask(make_client(harness), headers, body)

    assert response.status_code == 200


def test_ask_ac73_the_question_is_trimmed_before_it_reaches_the_pipeline(
    harness: Harness, headers: dict[str, str]
):
    harness.search.hits = []

    ask(make_client(harness), headers, {**BODY, "question": f"  {QUESTION}\n"})

    assert harness.search.calls[0][0] == QUESTION


def test_ask_ac71_the_session_holds_space_ids_and_the_raw_token(
    make_token: Callable[..., str],
):
    token = make_token(spaceIds=[USER_SPACE, SPACE_A])

    claims = decode_user_token(token, BRIDGE_KEY)

    assert claims["spaceIds"] == [USER_SPACE, SPACE_A]
    session = UserSession(USER_ID, "w", tuple(claims["spaceIds"]), token)
    assert session.space_ids == (USER_SPACE, SPACE_A)


def test_ask_ac71_the_session_route_still_answers_user_and_workspace(
    harness: Harness, headers: dict[str, str]
):
    response = make_client(harness).post("/v1/session", headers=headers)

    assert response.status_code == 200
    assert set(response.json()) == {"userId", "workspaceId"}


CONFIRM_PATH = "/v1/conversations/confirm"


def shared_client(harness: Harness) -> TestClient:
    return TestClient(
        create_app(make_settings(), harness.redis, harness.pipeline(), idle_extraction_pipeline())
    )


def answered_turn_id(client: TestClient, headers: dict[str, str]) -> str:
    return lines(ask(client, headers))[-1]["turnId"]


def confirm(client: TestClient, headers: dict[str, str], body: dict[str, Any]) -> httpx.Response:
    return client.post(CONFIRM_PATH, headers=headers, json=body)


def test_ask_ac56_confirm_answers_204_and_puts_the_turn_in_the_history(
    harness: Harness, headers: dict[str, str]
):
    client = shared_client(harness)
    turn_id = answered_turn_id(client, headers)
    assert harness.stored() == []

    response = confirm(client, headers, {"conversationId": CONVERSATION_ID, "turnId": turn_id})

    assert response.status_code == 204
    assert response.content == b""
    assert [turn.question for turn in harness.stored()] == [QUESTION]


def test_ask_ac54_confirm_with_another_users_token_leaves_the_turn_pending(
    harness: Harness,
    headers: dict[str, str],
    service_headers: dict[str, str],
    make_token: Callable[..., str],
):
    client = shared_client(harness)
    turn_id = answered_turn_id(client, headers)
    other = {**service_headers, "X-User-Token": make_token(sub=OTHER_USER_ID)}

    response = confirm(client, other, {"conversationId": CONVERSATION_ID, "turnId": turn_id})

    assert response.status_code == 204
    assert harness.stored() == []
    assert harness.stored(OTHER_USER_ID) == []


@pytest.mark.parametrize(
    ("header_names", "code"),
    [
        ((), "service_token_missing"),
        (("wrong-service",), "service_token_invalid"),
        (("service",), "user_token_missing"),
        (("service", "expired-user"), "user_token_expired"),
        (("service", "malformed-user"), "user_token_invalid"),
    ],
)
def test_ask_ac56_confirm_without_valid_tokens_is_401(
    harness: Harness,
    headers: dict[str, str],
    make_token: Callable[..., str],
    header_names: tuple[str, ...],
    code: str,
):
    client = shared_client(harness)
    turn_id = answered_turn_id(client, headers)
    now = int(time.time())
    available = {
        "service": {"X-Service-Token": SERVICE_CREDENTIAL},
        "wrong-service": {"X-Service-Token": "x" * 32, "X-User-Token": make_token()},
        "expired-user": {"X-User-Token": make_token(iat=now - 120, exp=now - 60)},
        "malformed-user": {"X-User-Token": "not.a.jwt"},
    }
    request_headers = {k: v for name in header_names for k, v in available[name].items()}

    response = confirm(
        client, request_headers, {"conversationId": CONVERSATION_ID, "turnId": turn_id}
    )

    assert response.status_code == 401
    assert response.json()["code"] == code
    assert harness.stored() == []


@pytest.mark.parametrize(
    "body",
    [
        {"conversationId": CONVERSATION_ID},
        {"turnId": CONVERSATION_ID},
        {"conversationId": "not-a-uuid", "turnId": CONVERSATION_ID},
        {"conversationId": CONVERSATION_ID, "turnId": "turn-1"},
        {"conversationId": CONVERSATION_ID, "turnId": CONVERSATION_ID, "userId": USER_ID},
    ],
    ids=["no-turn", "no-conversation", "bad-conversation", "bad-turn", "unknown-field-userId"],
)
def test_ask_ac56_confirm_with_an_invalid_body_is_400_invalid_request(
    harness: Harness, headers: dict[str, str], body: dict[str, Any]
):
    response = confirm(shared_client(harness), headers, body)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"


def without_turn_ids(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: value for key, value in event.items() if key != "turnId"} for event in events]


def test_reqlog_ac11_a_request_with_an_invalid_user_token_starts_no_record(
    harness: Harness, service_headers: dict[str, str]
):
    response = ask(make_client(harness), {**service_headers, "X-User-Token": "not-a-token"})

    assert response.status_code == 401
    assert harness.request_log.started == []
    assert harness.request_log.records == []


def test_reqlog_ac21_the_workspace_of_the_user_token_reaches_the_record(
    harness: Harness, headers: dict[str, str]
):
    ask(make_client(harness), headers)

    assert harness.request_log.started == [("ask", USER_ID, WORKSPACE_ID)]


def test_reqlog_ac35_an_unreachable_log_database_changes_nothing_the_client_receives(
    harness: Harness, headers: dict[str, str], caplog: pytest.LogCaptureFixture
):
    working = without_turn_ids(lines(ask(make_client(harness), headers)))
    unreachable = RequestLog(
        UNREACHABLE_DATABASE_URL,
        REQUEST_LOG_KEY,
        "local",
        "stub-model",
    )
    caplog.set_level(logging.WARNING)

    response = ask(make_client(harness, unreachable), headers)
    assert unreachable.flush(TOKEN_TIMEOUT_SECONDS)

    assert response.status_code == 200
    assert without_turn_ids(lines(response)) == working
    assert any(line.startswith("request log write failed task=ask") for line in warnings(caplog))


def test_reqlog_ac4_a_client_disconnect_does_not_wait_for_a_database_that_never_answers(
    harness: Harness, headers: dict[str, str]
):
    harness.model.deltas = ["Erster Teil [1] ", "zweiter Teil ", "dritter Teil."]

    async def disconnect(app: FastAPI) -> float:
        call = AsgiCall(app, headers, BODY)
        call.start()
        assert await call.next_line() == {"type": "delta", "text": "Erster Teil [1] "}
        started = time.monotonic()
        call.disconnected.set()
        await call.finish()
        return time.monotonic() - started

    with silent_server() as port:
        held = HeldRequestLog(database_url_on(port))
        app = create_app(
            make_settings(),
            fakeredis.FakeRedis(),
            harness.pipeline(held),
            idle_extraction_pipeline(),
        )
        try:
            elapsed = asyncio.run(disconnect(app))
        finally:
            held.release.set()
        assert elapsed < AT_ONCE_SECONDS
        assert held.flush(TOKEN_TIMEOUT_SECONDS)

    assert [(record.task, record.status) for record in held.written] == [("ask", "stopped")]


def settings_environment(**overrides: str) -> dict[str, str]:
    return {
        "AI_BRIDGE_SECRET": BRIDGE_KEY,
        "AI_SERVICE_TOKEN": SERVICE_CREDENTIAL,
        "AI_REQUEST_LOG_SECRET": REQUEST_LOG_KEY,
        "REDIS_URL": "redis://127.0.0.1:6380/15",
        "AI_DATABASE_URL": "postgresql://docmost_ai:test-ai-password@127.0.0.1:5433/docmost",
        "AI_WIKI_URL": "http://wiki.test",
        **overrides,
    }


def test_ask_ac9_start_with_a_model_that_cannot_load_exits_1_naming_the_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.chdir(tmp_path)
    for name, value in settings_environment(AI_EMBEDDING_MODEL="no-such/model").items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(api_main, "check_database_role", lambda url: None)

    def failing_load(model_name: str) -> None:
        raise EmbeddingModelError(model_name)

    monkeypatch.setattr(api_main, "load_embedder", failing_load)
    started: list[object] = []
    monkeypatch.setattr(api_main.uvicorn, "run", lambda *a, **k: started.append(a))

    with pytest.raises(SystemExit) as exit_info:
        api_main.main()

    assert exit_info.value.code == 1
    assert "no-such/model" in capsys.readouterr().err
    assert started == []


def test_ask_ac9_start_without_ai_wiki_url_exits_1_naming_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    monkeypatch.chdir(tmp_path)
    environment = settings_environment()
    del environment["AI_WIKI_URL"]
    monkeypatch.delenv("AI_WIKI_URL", raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)

    with pytest.raises(SystemExit) as exit_info:
        api_main.main()

    assert exit_info.value.code == 1
    assert "AI_WIKI_URL is not set" in capsys.readouterr().err


def test_ask_ac9_start_serves_the_app_with_the_loaded_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.chdir(tmp_path)
    for name, value in settings_environment().items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(api_main, "check_database_role", lambda url: None)
    loaded: list[str] = []

    def load(model_name: str) -> Any:
        loaded.append(model_name)
        from tests.hashing_embedder import HashingEmbedder

        return HashingEmbedder()

    monkeypatch.setattr(api_main, "load_embedder", load)
    served: list[Any] = []
    monkeypatch.setattr(api_main.uvicorn, "run", lambda app, **k: served.append(app))

    api_main.main()

    assert loaded == ["jinaai/jina-embeddings-v2-base-de"]
    assert "/v1/ask" in [route.path for route in served[0].routes]


def test_reqlog_ac35_the_api_writes_the_queued_rows_before_it_exits(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    monkeypatch.chdir(tmp_path)
    for name, value in settings_environment().items():
        monkeypatch.setenv(name, value)
    monkeypatch.setattr(api_main, "check_database_role", lambda url: None)
    monkeypatch.setattr(api_main, "load_embedder", lambda model_name: HashingEmbedder())
    held = HeldRequestLog()
    monkeypatch.setattr(api_main, "build_request_log", lambda settings: held)

    def serve(app: FastAPI, **options: Any) -> None:
        held.finish(held.start("ask", USER_ID, WORKSPACE_ID), "answered", TokenTally())
        threading.Timer(0.2, held.release.set).start()

    monkeypatch.setattr(api_main.uvicorn, "run", serve)

    api_main.main()

    assert [(record.task, record.status) for record in held.written] == [("ask", "answered")]
