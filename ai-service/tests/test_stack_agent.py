import json
import os
import re
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import pytest

from ai_service.wiki_session import SEED_EMAILS
from ai_service.wiki_session import log_in as log_in_with_retry

pytestmark = [pytest.mark.integration, pytest.mark.stack]

STACK_VARIABLES = ["STACK_WIKI_URL"]
SEED_PASSWORD = os.environ.get("STACK_SEED_PASSWORD", "seed-demo-password")
SPACE_NAME = "Allgemein"
TASK = "Finde veraltete Seiten zu Reisekosten und schlage Updates vor"
EXPECTED_TITLE = "Reisekosten Richtlinie 2022"
RUN_LIMIT_SECONDS = 600
REQUEST_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class AgentRun:
    events: list[dict[str, Any]]
    seconds: float

    @property
    def end(self) -> dict[str, Any] | None:
        ends = [event for event in self.events if event["type"] == "end"]
        return ends[-1] if ends else None

    @property
    def run_id(self) -> str:
        [event] = [event for event in self.events if event["type"] == "run"]
        return event["runId"]

    @property
    def proposals(self) -> list[dict[str, Any]]:
        return [event["proposal"] for event in self.events if event["type"] == "proposal"]

    @property
    def steps(self) -> int:
        return max((event["steps"] for event in self.events if event["type"] == "step"), default=0)


def unwrap(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    return data if isinstance(data, dict) else body


def tokens_from_log(run_id: str) -> str:
    log_path = os.environ.get("STACK_AI_LOG")
    if not log_path:
        return "unknown"
    for line in Path(log_path).read_text().splitlines():
        if f"agent run={run_id}" in line:
            found = re.search(r"tokens=(\d+)", line)
            return found.group(1) if found else "unknown"
    return "unknown"


def read_events(response: httpx.Response) -> Iterator[dict[str, Any]]:
    for line in response.iter_lines():
        if line.startswith("data: "):
            yield json.loads(line[len("data: ") :])


def run_agent(session: httpx.Client, space_id: str) -> AgentRun:
    events: list[dict[str, Any]] = []
    started = time.monotonic()
    with session.stream(
        "POST",
        "/api/ai/agent/run",
        json={"spaceId": space_id, "task": TASK},
        timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, read=RUN_LIMIT_SECONDS),
    ) as response:
        assert response.status_code == 200, response.read()
        for event in read_events(response):
            events.append(event)
            if time.monotonic() - started > RUN_LIMIT_SECONDS:
                break
    return AgentRun(events, time.monotonic() - started)


@pytest.fixture(scope="module")
def wiki_url() -> str:
    missing = [name for name in STACK_VARIABLES if not os.environ.get(name)]
    if missing:
        pytest.fail(f"no running stack configured, set {', '.join(missing)}")
    return os.environ["STACK_WIKI_URL"]


@pytest.fixture(scope="module")
def session(wiki_url: str) -> Iterator[httpx.Client]:
    with httpx.Client(base_url=wiki_url, timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = log_in_with_retry(client, SEED_EMAILS["GF"], SEED_PASSWORD, time.sleep)
        assert response.status_code == 200, response.text
        yield client


@pytest.fixture(scope="module")
def space_id(session: httpx.Client) -> str:
    response = session.post("/api/spaces", json={})
    assert response.status_code == 200, response.text
    [space] = [item for item in unwrap(response.json())["items"] if item["name"] == SPACE_NAME]
    return space["id"]


@pytest.fixture(scope="module")
def run(session: httpx.Client, space_id: str) -> AgentRun:
    result = run_agent(session, space_id)
    titles = [proposal["pageTitle"] for proposal in result.proposals]
    outcome = result.end["outcome"] if result.end else "no end event"
    print(
        f"AGENT-AC114 elapsed={result.seconds:.1f}s steps={result.steps} outcome={outcome}"
        f" tokens={tokens_from_log(result.run_id)} proposals={titles}"
    )
    for event in result.events:
        if event["type"] == "step":
            print(f"AGENT-AC114 step {event['steps']}: {event['label']}")
    return result


def test_agent_ac114_the_run_ends_with_a_card_for_the_travel_policy_within_10_minutes(
    run: AgentRun,
):
    assert run.end is not None, run.events
    titles = [proposal["pageTitle"] for proposal in run.proposals]
    assert EXPECTED_TITLE in titles, (run.end, titles)
    assert run.seconds <= RUN_LIMIT_SECONDS


def test_agent_ac114_the_proposal_is_open_editable_and_applies_to_the_page(
    run: AgentRun, session: httpx.Client
):
    [proposal] = [item for item in run.proposals if item["pageTitle"] == EXPECTED_TITLE]
    viewed = session.post("/api/ai/agent/proposal", json={"proposalId": proposal["id"]})
    assert viewed.status_code == 200, viewed.text
    view = unwrap(viewed.json())
    assert view["status"] == "open"
    assert view["canEdit"] is True

    applied = session.post("/api/ai/agent/proposal/apply", json={"proposalId": proposal["id"]})
    assert applied.status_code == 200, applied.text

    info = session.post(
        "/api/pages/info",
        json={"pageId": proposal["pageId"], "includeContent": True, "format": "markdown"},
    )
    assert info.status_code == 200, info.text
    content = " ".join(str(unwrap(info.json())["content"]).replace("\\", "").split())
    added = [
        " ".join(op["text"].split())
        for change in view["changes"]
        for op in change["ops"]
        if op["op"] == "add" and op["text"].strip()
    ]
    assert added
    assert all(text in content for text in added), (added, content)
