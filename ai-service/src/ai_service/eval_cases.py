import socket
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

import httpx

from ai_service.eval_metrics import AgentCase, ExtractedValue, ExtractionCase, RagCase
from ai_service.eval_sets import AgentScenario, ContractTruth, GoldenQuestion
from ai_service.wiki_session import list_all_wiki_pages, parse_sse_events, post_data

ASK_DEADLINE_SECONDS = 300
EXTRACT_READ_TIMEOUT_SECONDS = 210
AGENT_DEADLINE_SECONDS = 900
CONNECT_TIMEOUT_SECONDS = 10
MALFORMED_EVENT = "malformed_event"
INVALID_RESPONSE = "invalid_response"
AGENT_FAILED_OUTCOMES = ("model_failed", "context_too_small")

Clock = Callable[[], float]
Snapshot = dict[str, tuple[str, str]]


@dataclass(frozen=True)
class StreamResult:
    events: list[dict[str, Any]]
    failure: str | None


def close_connection(response: httpx.Response) -> None:
    network_stream = response.extensions.get("network_stream")
    connection = network_stream.get_extra_info("socket") if network_stream else None
    if connection is None:
        response.close()
        return
    with suppress(OSError):
        connection.shutdown(socket.SHUT_RDWR)


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
    expired = threading.Event()
    streams: list[httpx.Response] = []
    lock = threading.Lock()
    finished = False

    def expire() -> None:
        with lock:
            if finished:
                return
            expired.set()
            for response in streams:
                close_connection(response)

    def finish() -> None:
        nonlocal finished
        with lock:
            finished = True

    watchdog = threading.Timer(deadline_seconds, expire)
    watchdog.daemon = True
    watchdog.start()
    try:
        with client.stream("POST", path, json=body, timeout=timeout) as response:
            if response.status_code != 200:
                return StreamResult([], f"http_{response.status_code}")
            with lock:
                streams.append(response)
                if expired.is_set():
                    close_connection(response)
            try:
                for line in response.iter_lines():
                    if clock() - started > deadline_seconds:
                        return StreamResult(events, "timeout")
                    try:
                        parsed = list(parse_sse_events([line]))
                    except ValueError:
                        return StreamResult(events, MALFORMED_EVENT)
                    if not all(isinstance(event, dict) and "type" in event for event in parsed):
                        return StreamResult(events, MALFORMED_EVENT)
                    events.extend(parsed)
            finally:
                finish()
    except httpx.TimeoutException:
        return StreamResult(events, "timeout")
    except (httpx.TransportError, httpx.StreamError) as error:
        failure = "timeout" if expired.is_set() else type(error).__name__
        return StreamResult(events, failure)
    finally:
        watchdog.cancel()
    return StreamResult(events, "timeout" if expired.is_set() else None)


def valid_sources(value: Any) -> bool:
    return isinstance(value, list) and all(
        isinstance(source, dict) and isinstance(source.get("title"), str) for source in value
    )


def proposal_title(event: dict[str, Any]) -> str | None:
    proposal = event.get("proposal")
    title = proposal.get("pageTitle") if isinstance(proposal, dict) else None
    return title if isinstance(title, str) else None


def ask_case(
    client: httpx.Client, question: GoldenQuestion, clock: Clock = time.monotonic
) -> RagCase:
    started = clock()
    body = {"question": question.question, "conversationId": str(uuid.uuid4())}
    streamed = stream_events(client, "/api/ai/ask", body, ASK_DEADLINE_SECONDS, clock)
    seconds = clock() - started
    text = "".join(
        str(event.get("text", "")) for event in streamed.events if event["type"] == "delta"
    )
    final = streamed.events[-1] if streamed.events else {}
    outcome, failure = "failed", streamed.failure
    sources: list[dict[str, Any]] = []
    if failure is None and final.get("type") == "sources":
        if valid_sources(final.get("sources")):
            outcome, sources = "answered", final["sources"]
        else:
            failure = MALFORMED_EVENT
    elif failure is None and final.get("type") == "no_source":
        outcome = "no_source"
    elif failure is None:
        failure = (
            final.get("code") or "error_without_code"
            if final.get("type") == "error"
            else "no_final_event"
        )
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
    try:
        body = response.json()
    except ValueError:
        return failed(INVALID_RESPONSE)
    if not isinstance(body, dict):
        return failed(INVALID_RESPONSE)
    result = unwrap_data(body)
    seconds = clock() - started
    outcome = result.get("outcome")
    if outcome == "extracted":
        try:
            fields = {
                field["key"]: ExtractedValue(field["value"], field["quote"], field["pdfPage"])
                for field in result["fields"]
            }
        except KeyError, TypeError:
            return failed(INVALID_RESPONSE)
        return ExtractionCase(contract, "extracted", None, fields, seconds, None)
    if outcome == "refused":
        return ExtractionCase(contract, "refused", result.get("reason"), {}, seconds, None)
    if outcome == "failed":
        return failed(str(result.get("reason") or "no_reason"))
    return failed(INVALID_RESPONSE)


def workspace_snapshot(gf: httpx.Client) -> Snapshot:
    snapshot: Snapshot = {}
    for _, pages in list_all_wiki_pages(gf):
        for page in pages:
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


def take_snapshot(snapshot: Callable[[], Snapshot]) -> tuple[Snapshot | None, str | None]:
    try:
        return snapshot(), None
    except httpx.HTTPStatusError as error:
        return None, f"snapshot_{error.response.status_code}"
    except httpx.TransportError as error:
        return None, f"snapshot_{type(error).__name__}"
    except ValueError, KeyError, TypeError:
        return None, f"snapshot_{INVALID_RESPONSE}"


def agent_case(
    client: httpx.Client,
    scenario: AgentScenario,
    space_id: str,
    snapshot: Callable[[], Snapshot],
    clock: Clock = time.monotonic,
) -> AgentCase:
    before, before_failure = take_snapshot(snapshot)
    if before is None:
        return AgentCase(scenario, None, (), (), 0.0, before_failure)
    started = clock()
    body = {"spaceId": space_id, "task": scenario.task}
    streamed = stream_events(client, "/api/ai/agent/run", body, AGENT_DEADLINE_SECONDS, clock)
    seconds = clock() - started
    proposal_events = [event for event in streamed.events if event["type"] == "proposal"]
    titles = [proposal_title(event) for event in proposal_events]
    proposals = tuple(title for title in titles if title is not None)
    ends = [event for event in streamed.events if event["type"] == "end"]
    outcome = ends[-1].get("outcome") if ends else None
    failure = streamed.failure
    if failure is None and len(proposals) != len(titles):
        failure = MALFORMED_EVENT
    if failure is None and outcome is None:
        failure = "no_end"
    if failure is None and outcome in AGENT_FAILED_OUTCOMES:
        failure = outcome
    after, after_failure = take_snapshot(snapshot)
    if after is None:
        return AgentCase(scenario, outcome, proposals, (), seconds, failure or after_failure)
    return AgentCase(scenario, outcome, proposals, changed_pages(before, after), seconds, failure)


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
