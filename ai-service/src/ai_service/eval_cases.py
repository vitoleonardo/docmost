import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

from ai_service.eval_metrics import AgentCase, ExtractedValue, ExtractionCase, RagCase
from ai_service.eval_sets import AgentScenario, ContractTruth, GoldenQuestion
from ai_service.wiki_session import list_space_pages, parse_sse_events, post_data

ASK_DEADLINE_SECONDS = 300
EXTRACT_READ_TIMEOUT_SECONDS = 210
AGENT_DEADLINE_SECONDS = 900
CONNECT_TIMEOUT_SECONDS = 10
AGENT_FAILED_OUTCOMES = ("model_failed", "context_too_small")

Clock = Callable[[], float]
Snapshot = dict[str, tuple[str, str]]


@dataclass(frozen=True)
class StreamResult:
    events: list[dict[str, Any]]
    failure: str | None


def stream_events(
    client: httpx.Client,
    path: str,
    body: dict[str, Any],
    deadline_seconds: float,
    clock: Clock,
) -> StreamResult:
    timeout = httpx.Timeout(deadline_seconds, connect=CONNECT_TIMEOUT_SECONDS)
    started = clock()
    events: list[dict[str, Any]] = []
    try:
        with client.stream("POST", path, json=body, timeout=timeout) as response:
            if response.status_code != 200:
                return StreamResult([], f"http_{response.status_code}")
            for line in response.iter_lines():
                if clock() - started > deadline_seconds:
                    return StreamResult(events, "timeout")
                events.extend(parse_sse_events([line]))
    except httpx.TimeoutException:
        return StreamResult(events, "timeout")
    except httpx.TransportError as error:
        return StreamResult(events, type(error).__name__)
    return StreamResult(events, None)


def ask_case(
    client: httpx.Client, question: GoldenQuestion, clock: Clock = time.monotonic
) -> RagCase:
    started = clock()
    body = {"question": question.question, "conversationId": str(uuid.uuid4())}
    streamed = stream_events(client, "/api/ai/ask", body, ASK_DEADLINE_SECONDS, clock)
    seconds = clock() - started
    text = "".join(event["text"] for event in streamed.events if event["type"] == "delta")
    final = streamed.events[-1] if streamed.events else {}
    outcome, failure = "failed", streamed.failure
    sources: list[dict[str, Any]] = []
    if failure is None and final.get("type") == "sources":
        outcome, sources = "answered", final["sources"]
    elif failure is None and final.get("type") == "no_source":
        outcome = "no_source"
    elif failure is None:
        failure = final["code"] if final.get("type") == "error" else "no_final_event"
    cited = tuple(dict.fromkeys(source["title"] for source in sources))
    return RagCase(question, outcome, text, cited, seconds, failure, None, None, tuple(sources))


def unwrap_data(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    return data if isinstance(data, dict) else body


def extract_case(
    client: httpx.Client,
    contract: ContractTruth,
    page_id: str,
    attachment_id: str,
    clock: Clock = time.monotonic,
) -> ExtractionCase:
    started = clock()
    timeout = httpx.Timeout(EXTRACT_READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
    body = {"pageId": page_id, "attachmentId": attachment_id}

    def failed(failure: str) -> ExtractionCase:
        return ExtractionCase(contract, "failed", None, {}, clock() - started, failure)

    try:
        response = client.post("/api/ai/extract", json=body, timeout=timeout)
    except httpx.TimeoutException:
        return failed("timeout")
    except httpx.TransportError as error:
        return failed(type(error).__name__)
    if response.status_code != 200:
        return failed(f"http_{response.status_code}")
    result = unwrap_data(response.json())
    seconds = clock() - started
    if result["outcome"] == "extracted":
        fields = {
            field["key"]: ExtractedValue(field["value"], field["quote"], field["pdfPage"])
            for field in result["fields"]
        }
        return ExtractionCase(contract, "extracted", None, fields, seconds, None)
    if result["outcome"] == "refused":
        return ExtractionCase(contract, "refused", result["reason"], {}, seconds, None)
    return failed(result["reason"])


def workspace_snapshot(gf: httpx.Client) -> Snapshot:
    snapshot: Snapshot = {}
    for space in post_data(gf, "/api/spaces", {})["items"]:
        for page in list_space_pages(gf, space["id"]):
            info = post_data(gf, "/api/pages/info", {"pageId": page["id"], "format": "markdown"})
            snapshot[page["id"]] = (info["title"] or "", info["content"] or "")
    return snapshot


def changed_pages(before: Snapshot, after: Snapshot) -> tuple[str, ...]:
    titles: list[str] = []
    for page_id in before.keys() | after.keys():
        if before.get(page_id) != after.get(page_id):
            title = (after.get(page_id) or before[page_id])[0]
            titles.append(title)
    return tuple(sorted(titles))


def agent_case(
    client: httpx.Client,
    scenario: AgentScenario,
    space_id: str,
    snapshot: Callable[[], Snapshot],
    clock: Clock = time.monotonic,
) -> AgentCase:
    before = snapshot()
    started = clock()
    body = {"spaceId": space_id, "task": scenario.task}
    streamed = stream_events(client, "/api/ai/agent/run", body, AGENT_DEADLINE_SECONDS, clock)
    seconds = clock() - started
    proposals = tuple(
        event["proposal"]["pageTitle"] for event in streamed.events if event["type"] == "proposal"
    )
    ends = [event for event in streamed.events if event["type"] == "end"]
    outcome = ends[-1]["outcome"] if ends else None
    failure = streamed.failure
    if failure is None and outcome is None:
        failure = "no_end"
    if failure is None and outcome in AGENT_FAILED_OUTCOMES:
        failure = outcome
    changed = changed_pages(before, snapshot())
    return AgentCase(scenario, outcome, proposals, changed, seconds, failure)


def page_attachments(gf: httpx.Client, page_id: str) -> dict[str, str]:
    info = post_data(gf, "/api/pages/info", {"pageId": page_id})
    found: dict[str, str] = {}

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        attrs = node.get("attrs") or {}
        if attrs.get("attachmentId") and attrs.get("name"):
            found[attrs["name"]] = attrs["attachmentId"]
        for child in node.get("content") or []:
            walk(child)

    walk(info["content"])
    return found
