import asyncio
import json
import logging
import threading
import time
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from redis import Redis

from ai_service.agent_store import ProposalNotFound, ProposalNotOpen, ProposalStatus, StoredProposal
from ai_service.app import AgentServices, create_app
from ai_service.request_log import RequestLog
from tests.conftest import (
    REQUEST_LOG_KEY,
    SERVICE_CREDENTIAL,
    UNREACHABLE_DATABASE_URL,
    USER_ID,
    WORKSPACE_ID,
    idle_ask_pipeline,
    idle_extraction_pipeline,
    make_settings,
    warnings,
)
from tests.fake_bridge import USER_TOKEN, AgentBridge, mock_client
from tests.index_db import SPACE_A
from tests.test_agent import (
    TASK,
    FakeStore,
    Harness,
    ModelCall,
    answer,
    final,
    propose,
    read,
    search,
    travel_page,
)
from tests.test_app_ask import AsgiCall

RUNS = "/v1/agent/runs"
GET = "/v1/agent/proposals/get"
TRANSITION = "/v1/agent/proposals/transition"
LOCK_KEY = f"ai-service:agent-run:{USER_ID}"
OTHER_USER_ID = "0192f000-0000-7000-8000-0000000000ff"
PROPOSAL_ID = "0192f000-0000-7000-8000-0000000d0001"
UNKNOWN_ID = "0192f000-0000-7000-8000-0000000d0002"
RUN_BODY = {"spaceId": SPACE_A, "task": TASK}
WAIT_SECONDS = 5


@dataclass
class RecordsStore(FakeStore):
    stored: dict[str, StoredProposal] = field(default_factory=dict)
    transitions: list[tuple[str, str, ProposalStatus]] = field(default_factory=list)
    not_open: bool = False

    def get_proposal(self, proposal_id: str, user_id: str) -> StoredProposal | None:
        found = self.stored.get(proposal_id)
        return found if found is not None and found.user_id == user_id else None

    def transition(self, proposal_id: str, user_id: str, to: ProposalStatus) -> StoredProposal:
        found = self.get_proposal(proposal_id, user_id)
        if found is None:
            raise ProposalNotFound(proposal_id)
        if self.not_open:
            raise ProposalNotOpen(proposal_id)
        self.transitions.append((proposal_id, user_id, to))
        return replace(found, status=to)


def stored_proposal(user_id: str = USER_ID) -> StoredProposal:
    return StoredProposal(
        id=PROPOSAL_ID,
        run_id="0192f000-0000-7000-8000-0000000e0001",
        user_id=user_id,
        page_id="0192f000-0000-7000-8000-0000000a0001",
        page_title="Reisekosten Richtlinie 2022",
        space_id=SPACE_A,
        reason="Kilometerpauschale ist veraltet",
        fingerprint="fingerprint-1",
        changes=[{"block": 2, "heading": None, "ops": [{"op": "keep", "text": "x"}]}],
        added=3,
        removed=2,
        status="open",
        claimed_at=None,
        applied_by=None,
        applied_at=None,
        created_at=datetime(2026, 10, 30, 12, 0, tzinfo=UTC),
    )


def proposal_wire(proposal: StoredProposal, status: str = "open") -> dict[str, Any]:
    return {
        "id": proposal.id,
        "runId": proposal.run_id,
        "userId": proposal.user_id,
        "pageId": proposal.page_id,
        "pageTitle": proposal.page_title,
        "spaceId": proposal.space_id,
        "reason": proposal.reason,
        "fingerprint": proposal.fingerprint,
        "changes": proposal.changes,
        "added": proposal.added,
        "removed": proposal.removed,
        "status": status,
        "appliedBy": None,
        "appliedAt": None,
    }


def with_user_token_swapped(bridge: AgentBridge) -> Callable[[httpx.Request], httpx.Response]:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.headers["X-User-Token"] != "task-token":
            request.headers["X-User-Token"] = USER_TOKEN
        return bridge.handle(request)

    return handle


@pytest.fixture
def harness() -> Harness:
    prepared = Harness(travel_page())
    prepared.store = RecordsStore()
    prepared.bridge_client = mock_client(with_user_token_swapped(prepared.bridge))
    return prepared


def records(harness: Harness) -> RecordsStore:
    assert isinstance(harness.store, RecordsStore)
    return harness.store


def make_app(harness: Harness, redis: Redis) -> FastAPI:
    services = AgentServices(
        open_records=lambda: nullcontext(records(harness)),
        make_runner=lambda store: replace(harness.runner(), store=store),
    )
    return create_app(
        make_settings(), redis, idle_ask_pipeline(redis), idle_extraction_pipeline(), services
    )


def blocking(started: threading.Event, release: threading.Event) -> Callable[[ModelCall], Any]:
    def step(_: ModelCall) -> Any:
        started.set()
        assert release.wait(WAIT_SECONDS), "the test never released the model call"
        return final()

    return step


def lines(response: httpx.Response) -> list[dict[str, Any]]:
    return [json.loads(line) for line in response.text.splitlines()]


def wait_until(condition: Callable[[], bool]) -> None:
    deadline = time.monotonic() + WAIT_SECONDS
    while not condition() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert condition()


async def response_status(call: AsgiCall) -> int:
    while True:
        message = await asyncio.wait_for(call.sent.get(), WAIT_SECONDS)
        if message["type"] == "http.response.start":
            return message["status"]


async def read_lines(call: AsgiCall) -> list[dict[str, Any]]:
    received: list[dict[str, Any]] = []
    while (line := await call.next_line()) is not None:
        received.append(line)
    return received


ENDPOINT_BODIES = [
    (RUNS, RUN_BODY),
    (GET, {"proposalId": PROPOSAL_ID}),
    (TRANSITION, {"proposalId": PROPOSAL_ID, "to": "discarded"}),
]


@pytest.mark.parametrize(("path", "body"), ENDPOINT_BODIES)
@pytest.mark.parametrize(
    ("case", "code"),
    [
        ("no_service", "service_token_missing"),
        ("wrong_service", "service_token_invalid"),
        ("no_user", "user_token_missing"),
        ("expired", "user_token_expired"),
        ("malformed", "user_token_invalid"),
    ],
)
def test_agent_ac108_a_bad_token_is_401_with_the_exact_code(
    harness: Harness,
    redis_client: Redis,
    make_token: Callable[..., str],
    path: str,
    body: dict[str, Any],
    case: str,
    code: str,
):
    request_headers = {"X-Service-Token": SERVICE_CREDENTIAL, "X-User-Token": make_token()}
    if case == "no_service":
        del request_headers["X-Service-Token"]
    if case == "wrong_service":
        request_headers["X-Service-Token"] = "x" * 32
    if case == "no_user":
        del request_headers["X-User-Token"]
    if case == "expired":
        request_headers["X-User-Token"] = make_token(exp=int(time.time()) - 10)
    if case == "malformed":
        request_headers["X-User-Token"] = "not-a-token"

    response = TestClient(make_app(harness, redis_client)).post(
        path, headers=request_headers, json=body
    )

    assert response.status_code == 401
    assert response.json()["code"] == code
    assert harness.bridge.requests == []
    assert redis_client.get(LOCK_KEY) is None


def test_agent_ac108_the_service_token_is_checked_before_the_body(
    harness: Harness, redis_client: Redis, make_token: Callable[..., str]
):
    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers={"X-User-Token": make_token()}, json={"extra": 1}
    )

    assert response.json()["code"] == "service_token_missing"


BAD_RUN_BODIES = [
    {**RUN_BODY, "extra": 1},
    {**RUN_BODY, "task": "a" * 2001},
    {**RUN_BODY, "task": "   \n "},
    {**RUN_BODY, "task": ""},
    {"task": TASK},
    {**RUN_BODY, "spaceId": "not-a-uuid"},
    {"spaceId": SPACE_A},
]


@pytest.mark.parametrize("body", BAD_RUN_BODIES)
def test_agent_ac104_an_invalid_run_body_is_400_invalid_request(
    harness: Harness, redis_client: Redis, headers: dict[str, str], body: dict[str, Any]
):
    response = TestClient(make_app(harness, redis_client)).post(RUNS, headers=headers, json=body)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
    assert harness.bridge.requests == []
    assert redis_client.get(LOCK_KEY) is None


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (GET, {"proposalId": PROPOSAL_ID, "extra": 1}),
        (GET, {"proposalId": "nope"}),
        (TRANSITION, {"proposalId": PROPOSAL_ID, "to": "deleted"}),
        (TRANSITION, {"proposalId": PROPOSAL_ID, "to": "open", "extra": 1}),
        (TRANSITION, {"to": "open"}),
    ],
)
def test_agent_ac104_an_invalid_proposal_body_is_400_invalid_request(
    harness: Harness,
    redis_client: Redis,
    headers: dict[str, str],
    path: str,
    body: dict[str, Any],
):
    response = TestClient(make_app(harness, redis_client)).post(path, headers=headers, json=body)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
    assert records(harness).transitions == []


def test_agent_ac104_a_task_of_2000_characters_is_accepted_and_trimmed(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    harness.script(final())
    task = "a" * 2000

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json={**RUN_BODY, "task": f"  {task}  "}
    )

    assert response.status_code == 200
    assert records(harness).runs[0][4] == task


def test_agent_the_stream_is_ndjson_with_run_step_proposal_and_end_events(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    harness.script(
        answer(search("Reisekosten")), answer(read(1)), answer(propose(1)), final("Fertig.")
    )

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    received = lines(response)
    assert [event["type"] for event in received] == [
        "run",
        "step",
        "step",
        "step",
        "proposal",
        "end",
    ]
    assert received[0]["runId"] == records(harness).runs[0][0]
    assert received[-1] == {
        "type": "end",
        "outcome": "finished",
        "pagesRead": 1,
        "message": "Fertig.",
    }
    assert redis_client.get(LOCK_KEY) is None
    assert records(harness).ended[0][1] == "finished"


def test_agent_ac70_a_held_lock_is_409_run_in_progress_before_anything_runs(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    redis_client.set(LOCK_KEY, "another-run")

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert response.status_code == 409
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["code"] == "run_in_progress"
    assert harness.bridge.requests == []
    assert records(harness).runs == []
    assert redis_client.get(LOCK_KEY) == "another-run"


def test_agent_ac70_the_lock_of_another_user_does_not_block(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    harness.script(final())
    redis_client.set(f"ai-service:agent-run:{OTHER_USER_ID}", "another-run")

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert response.status_code == 200


def test_agent_ac70_a_bridge_failure_before_the_stream_is_503_and_frees_the_lock(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    harness.bridge.fail_next("unreachable")

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert response.status_code == 503
    assert response.json()["code"] == "assistant_unavailable"
    assert redis_client.get(LOCK_KEY) is None
    assert records(harness).runs == []


def test_agent_ac115_two_simultaneous_starts_make_one_stream_and_one_409(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    started, release = threading.Event(), threading.Event()
    harness.script(blocking(started, release))
    app = make_app(harness, redis_client)

    async def scenario() -> tuple[list[int], list[dict[str, Any]]]:
        calls = [AsgiCall(app, headers, RUN_BODY, RUNS) for _ in range(2)]
        for call in calls:
            call.start()
        statuses = list(await asyncio.gather(*(response_status(call) for call in calls)))
        winner = calls[statuses.index(200)]
        await asyncio.to_thread(started.wait, WAIT_SECONDS)
        release.set()
        return statuses, await read_lines(winner)

    statuses, received = asyncio.run(scenario())

    assert sorted(statuses) == [200, 409]
    assert received[0]["type"] == "run"
    assert received[-1]["type"] == "end"
    assert len(records(harness).runs) == 1
    assert redis_client.get(LOCK_KEY) is None


def test_agent_ac66_after_a_disconnect_the_lock_is_gone_at_once_and_a_new_run_starts(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    started, release = threading.Event(), threading.Event()
    harness.script(blocking(started, release), final())
    app = make_app(harness, redis_client)

    async def scenario() -> tuple[object, list[dict[str, Any]]]:
        first = AsgiCall(app, headers, RUN_BODY, RUNS)
        first.start()
        assert (await first.next_line() or {})["type"] == "run"
        await asyncio.to_thread(started.wait, WAIT_SECONDS)
        first.disconnected.set()
        await first.finish()
        lock_after_disconnect = redis_client.get(LOCK_KEY)
        second = AsgiCall(app, headers, RUN_BODY, RUNS)
        second.start()
        return lock_after_disconnect, await read_lines(second)

    lock_after_disconnect, second_run = asyncio.run(scenario())
    release.set()

    assert lock_after_disconnect is None
    assert [event["type"] for event in second_run] == ["run", "end"]
    wait_until(lambda: len(records(harness).ended) == 2)
    assert redis_client.get(LOCK_KEY) is None


def test_agent_ac66_a_disconnect_sets_the_cancel_event_of_the_model_call(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    started, release = threading.Event(), threading.Event()
    harness.script(blocking(started, release))
    app = make_app(harness, redis_client)

    async def scenario() -> None:
        call = AsgiCall(app, headers, RUN_BODY, RUNS)
        call.start()
        await call.next_line()
        await asyncio.to_thread(started.wait, WAIT_SECONDS)
        call.disconnected.set()
        await call.finish()

    asyncio.run(scenario())

    [model_call] = harness.model.calls
    assert model_call.cancel is not None
    assert model_call.cancel.is_set()
    release.set()
    wait_until(lambda: len(records(harness).ended) == 1)


def test_agent_ac66_a_finished_run_does_not_delete_the_lock_of_a_newer_run(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    started, release = threading.Event(), threading.Event()
    harness.script(blocking(started, release))
    app = make_app(harness, redis_client)

    async def scenario() -> None:
        call = AsgiCall(app, headers, RUN_BODY, RUNS)
        call.start()
        await call.next_line()
        await asyncio.to_thread(started.wait, WAIT_SECONDS)
        call.disconnected.set()
        await call.finish()

    asyncio.run(scenario())
    redis_client.set(LOCK_KEY, "newer-run")
    release.set()
    wait_until(lambda: len(records(harness).ended) == 1)

    assert redis_client.get(LOCK_KEY) == "newer-run"


def test_agent_ac108_the_owner_gets_the_stored_proposal(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    records(harness).stored[PROPOSAL_ID] = stored_proposal()

    response = TestClient(make_app(harness, redis_client)).post(
        GET, headers=headers, json={"proposalId": PROPOSAL_ID}
    )

    assert response.status_code == 200
    assert response.json() == proposal_wire(stored_proposal())


@pytest.mark.parametrize("proposal_id", [UNKNOWN_ID, PROPOSAL_ID])
def test_agent_ac102_an_unknown_or_foreign_proposal_is_404_proposal_not_found(
    harness: Harness, redis_client: Redis, headers: dict[str, str], proposal_id: str
):
    records(harness).stored[PROPOSAL_ID] = stored_proposal(user_id=OTHER_USER_ID)
    client = TestClient(make_app(harness, redis_client))

    got = client.post(GET, headers=headers, json={"proposalId": proposal_id})
    moved = client.post(
        TRANSITION, headers=headers, json={"proposalId": proposal_id, "to": "applying"}
    )

    for response in (got, moved):
        assert response.status_code == 404
        assert response.json()["code"] == "proposal_not_found"
    assert records(harness).transitions == []


def test_agent_ac108_the_owner_transitions_the_proposal(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    records(harness).stored[PROPOSAL_ID] = stored_proposal()

    response = TestClient(make_app(harness, redis_client)).post(
        TRANSITION, headers=headers, json={"proposalId": PROPOSAL_ID, "to": "applying"}
    )

    assert response.status_code == 200
    assert response.json() == proposal_wire(stored_proposal(), status="applying")
    assert records(harness).transitions == [(PROPOSAL_ID, USER_ID, "applying")]


def test_agent_ac108_a_proposal_that_is_not_open_is_409_proposal_not_open(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    records(harness).stored[PROPOSAL_ID] = stored_proposal()
    records(harness).not_open = True

    response = TestClient(make_app(harness, redis_client)).post(
        TRANSITION, headers=headers, json={"proposalId": PROPOSAL_ID, "to": "discarded"}
    )

    assert response.status_code == 409
    assert response.json()["code"] == "proposal_not_open"


def test_agent_without_services_the_run_is_503_assistant_unavailable(
    headers: dict[str, str], redis_client: Redis
):
    client = TestClient(
        create_app(
            make_settings(),
            redis_client,
            idle_ask_pipeline(redis_client),
            idle_extraction_pipeline(),
        )
    )

    response = client.post(RUNS, headers=headers, json=RUN_BODY)

    assert response.status_code == 503
    assert response.json()["code"] == "assistant_unavailable"
    assert redis_client.get(LOCK_KEY) is None


def test_reqlog_ac12_a_second_run_while_one_is_running_is_409_and_starts_no_record(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    started, release = threading.Event(), threading.Event()
    harness.script(blocking(started, release))
    app = make_app(harness, redis_client)

    async def scenario() -> int:
        first = AsgiCall(app, headers, RUN_BODY, RUNS)
        first.start()
        assert (await first.next_line() or {})["type"] == "run"
        await asyncio.to_thread(started.wait, WAIT_SECONDS)
        second = AsgiCall(app, headers, RUN_BODY, RUNS)
        second.start()
        status = await response_status(second)
        release.set()
        await read_lines(first)
        await first.finish()
        return status

    assert asyncio.run(scenario()) == 409
    wait_until(lambda: len(harness.recording.records) == 1)
    assert harness.recording.started == [("agent", USER_ID, WORKSPACE_ID)]


@pytest.mark.parametrize(
    ("path", "body"),
    [
        (GET, {"proposalId": PROPOSAL_ID}),
        (TRANSITION, {"proposalId": PROPOSAL_ID, "to": "applying"}),
        (TRANSITION, {"proposalId": PROPOSAL_ID, "to": "discarded"}),
    ],
)
def test_reqlog_ac13_viewing_applying_or_discarding_a_proposal_starts_no_record(
    harness: Harness,
    redis_client: Redis,
    headers: dict[str, str],
    path: str,
    body: dict[str, Any],
):
    records(harness).stored[PROPOSAL_ID] = stored_proposal()

    response = TestClient(make_app(harness, redis_client)).post(path, headers=headers, json=body)

    assert response.status_code == 200
    assert harness.recording.started == []
    assert harness.recording.records == []


def without_run_id(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in event.items() if k != "runId"} for event in events]


def test_reqlog_ac52_an_unreachable_log_database_changes_nothing_the_client_receives(
    harness: Harness,
    redis_client: Redis,
    headers: dict[str, str],
    caplog: pytest.LogCaptureFixture,
):
    script = [answer(search("Reisekosten")), answer(read(1)), final("Fertig.")]
    harness.script(*script)
    working = without_run_id(
        lines(
            TestClient(make_app(harness, redis_client)).post(RUNS, headers=headers, json=RUN_BODY)
        )
    )
    harness.request_log = RequestLog(
        UNREACHABLE_DATABASE_URL,
        REQUEST_LOG_KEY,
        "local",
        "stub-model",
    )
    harness.script(answer(search("Reisekosten")), answer(read(1)), final("Fertig."))
    caplog.set_level(logging.WARNING)

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert harness.request_log.flush(WAIT_SECONDS)

    assert response.status_code == 200
    assert without_run_id(lines(response)) == working
    assert any(line.startswith("request log write failed task=agent") for line in warnings(caplog))


def test_reqlog_ac8_a_wiki_failure_before_the_stream_is_503_with_one_error_record(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    harness.bridge.fail_next("unreachable")

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert response.status_code == 503
    assert response.json() == {
        "code": "assistant_unavailable",
        "message": "The wiki is not available.",
    }
    assert redis_client.get(LOCK_KEY) is None
    assert [
        (record.task, record.status, record.prompt_tokens, record.completion_tokens)
        for record in harness.recording.records
    ] == [("agent", "error", 0, 0)]


def test_reqlog_ac12_a_run_in_progress_is_refused_before_the_runner_is_prepared(
    harness: Harness, redis_client: Redis, headers: dict[str, str]
):
    redis_client.set(LOCK_KEY, "another-run")

    response = TestClient(make_app(harness, redis_client)).post(
        RUNS, headers=headers, json=RUN_BODY
    )

    assert response.status_code == 409
    assert harness.recording.started == []
    assert harness.recording.records == []
