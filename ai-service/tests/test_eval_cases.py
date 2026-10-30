import json
import threading
import time
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from itertools import count
from typing import Any

import httpx
import pytest

from ai_service import eval_cases
from ai_service.eval_cases import (
    MALFORMED_EVENT,
    agent_case,
    ask_case,
    changed_pages,
    extract_case,
    page_attachments,
    stream_events,
    workspace_snapshot,
)
from ai_service.eval_sets import AgentScenario, ContractTruth, FieldTruth, GoldenQuestion

QUESTION = GoldenQuestion("rag-01", "GF", "Wie lange?", ["Seite"], "Seite", "Ref", "Fakt")
CONTRACT = ContractTruth("vertrag.pdf", True, {"term": FieldTruth("12", "zwölf", 1)})
SCENARIO = AgentScenario("agent-01", "GF", "Allgemein", "Aufgabe", ["finished"], ["Alt"])

Handler = Callable[[httpx.Request], httpx.Response]


def sse(*events: dict[str, Any]) -> bytes:
    return "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode()


def client_for(handler: Handler) -> httpx.Client:
    return httpx.Client(base_url="http://wiki", transport=httpx.MockTransport(handler))


def stepping_clock(step: float) -> Callable[[], float]:
    ticks = count()
    return lambda: next(ticks) * step


class ClosingStream(httpx.SyncByteStream):
    def __init__(self, events: Iterator[dict[str, Any]]) -> None:
        self.events = events
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        for event in self.events:
            yield sse(event)

    def close(self) -> None:
        self.closed = True


def test_eval_ac8_ask_sends_no_scope_and_a_new_conversation_id_each_time() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=sse({"type": "no_source"}))

    client = client_for(handler)
    ask_case(client, QUESTION)
    ask_case(client, QUESTION)
    assert all(set(body) == {"question", "conversationId"} for body in bodies)
    assert bodies[0]["question"] == "Wie lange?"
    assert bodies[0]["conversationId"] != bodies[1]["conversationId"]


def test_eval_ac8_ask_answered_collects_text_titles_and_sources() -> None:
    sources = [
        {"title": "Seite", "fileName": None},
        {"title": "Seite", "fileName": "vertrag.pdf"},
        {"title": "Andere", "fileName": None},
    ]
    content = sse(
        {"type": "delta", "text": "Zwölf "},
        {"type": "delta", "text": "Monate"},
        {"type": "sources", "sources": sources},
    )
    client = client_for(lambda request: httpx.Response(200, content=content))
    case = ask_case(client, QUESTION, stepping_clock(1))
    assert case.outcome == "answered"
    assert case.failure is None
    assert case.answer_text == "Zwölf Monate"
    assert case.cited_pages == ("Seite", "Andere")
    assert [dict(source) for source in case.sources] == sources
    assert case.seconds > 0


def test_eval_ac8_ask_no_source() -> None:
    client = client_for(lambda request: httpx.Response(200, content=sse({"type": "no_source"})))
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure, case.cited_pages) == ("no_source", None, ())


def test_eval_ac8_ask_error_event_is_a_failed_case() -> None:
    content = sse({"type": "delta", "text": "x"}, {"type": "error", "code": "model_unavailable"})
    client = client_for(lambda request: httpx.Response(200, content=content))
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure) == ("failed", "model_unavailable")


def test_eval_ac8_ask_http_500_is_a_failed_case() -> None:
    client = client_for(lambda request: httpx.Response(500))
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure) == ("failed", "http_500")


def test_eval_ac8_ask_without_a_final_event_is_a_failed_case() -> None:
    client = client_for(
        lambda request: httpx.Response(200, content=sse({"type": "delta", "text": "x"}))
    )
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure) == ("failed", "no_final_event")


@pytest.mark.parametrize(
    "final",
    [
        {"type": "sources"},
        {"type": "sources", "sources": "Seite"},
        {"type": "sources", "sources": ["Seite"]},
        {"type": "sources", "sources": [{"fileName": None}]},
        {"type": "sources", "sources": [{"title": 3}]},
    ],
)
def test_eval_ac8_ask_a_sources_event_of_the_wrong_shape_is_a_malformed_event(
    final: dict[str, Any],
) -> None:
    client = client_for(lambda request: httpx.Response(200, content=sse(final)))
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure) == ("failed", MALFORMED_EVENT)


def test_eval_ac8_ask_transport_error_names_the_exception_class() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    case = ask_case(client_for(handler), QUESTION)
    assert (case.outcome, case.failure) == ("failed", "ConnectError")


def test_eval_ac52_a_stream_past_300_seconds_fails_with_timeout_and_the_next_call_works() -> None:
    endless = ClosingStream({"type": "delta", "text": "x"} for _ in range(1000))
    streams: list[httpx.Response] = [
        httpx.Response(200, stream=endless),
        httpx.Response(200, content=sse({"type": "no_source"})),
    ]
    client = client_for(lambda request: streams.pop(0))
    clock = stepping_clock(100)
    first = ask_case(client, QUESTION, clock)
    second = ask_case(client, QUESTION, clock)
    assert (first.outcome, first.failure) == ("failed", "timeout")
    assert second.outcome == "no_source"
    assert endless.closed


def test_eval_ac52_a_read_timeout_fails_with_timeout() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("silent")

    case = ask_case(client_for(handler), QUESTION)
    assert (case.outcome, case.failure) == ("failed", "timeout")


class StreamClosedAfterDelay(httpx.SyncByteStream):
    def __iter__(self) -> Iterator[bytes]:
        yield sse({"type": "delta", "text": "x"})
        time.sleep(0.5)
        raise httpx.StreamClosed()


def test_eval_ac52_a_stream_closed_by_the_watchdog_fails_with_timeout_and_raises_nothing() -> None:
    client = client_for(lambda request: httpx.Response(200, stream=StreamClosedAfterDelay()))
    streamed = stream_events(client, "/stream", {}, 0.2, time.monotonic)
    assert streamed.failure == "timeout"
    assert len(streamed.events) == 1


def test_eval_ac52_a_stream_closed_without_a_deadline_names_the_exception_class() -> None:
    client = client_for(lambda request: httpx.Response(200, stream=StreamClosedAfterDelay()))
    streamed = stream_events(client, "/stream", {}, 30, time.monotonic)
    assert streamed.failure == "StreamClosed"


def test_eval_ac52_a_watchdog_firing_after_the_stream_finished_changes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fired: list[Callable[[], None]] = []
    shutdowns: list[httpx.Response] = []

    class CapturingTimer:
        daemon = False

        def __init__(self, interval: float, function: Callable[[], None]) -> None:
            fired.append(function)

        def start(self) -> None:
            return None

        def cancel(self) -> None:
            return None

    monkeypatch.setattr(eval_cases.threading, "Timer", CapturingTimer)
    monkeypatch.setattr(eval_cases, "close_connection", shutdowns.append)
    content = sse({"type": "delta", "text": "x"}, {"type": "no_source"})
    client = client_for(lambda request: httpx.Response(200, content=content))
    streamed = stream_events(client, "/stream", {}, 30, time.monotonic)
    fired[0]()
    assert streamed.failure is None
    assert len(streamed.events) == 2
    assert shutdowns == []


def extract_response(result: dict[str, Any]) -> Handler:
    return lambda request: httpx.Response(200, json={"data": result})


def test_eval_ac22_extract_sends_page_and_attachment() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        assert request.url.path == "/api/ai/extract"
        return httpx.Response(200, json={"data": {"outcome": "refused", "reason": "unreadable"}})

    extract_case(client_for(handler), CONTRACT, "page-1", "att-1")
    assert bodies == [{"pageId": "page-1", "attachmentId": "att-1"}]


def test_eval_ac22_extracted_fields_are_read_by_key() -> None:
    result = {
        "outcome": "extracted",
        "fields": [{"key": "term", "value": "12", "quote": "zwölf", "pdfPage": 2}],
    }
    case = extract_case(client_for(extract_response(result)), CONTRACT, "p", "a")
    assert case.outcome == "extracted"
    assert case.fields["term"].value == "12"
    assert case.fields["term"].quote == "zwölf"
    assert case.fields["term"].pdf_page == 2


def test_eval_ac22_refused_keeps_the_reason() -> None:
    result = {"outcome": "refused", "reason": "no_text_layer"}
    case = extract_case(client_for(extract_response(result)), CONTRACT, "p", "a")
    assert (case.outcome, case.reason, case.failure) == ("refused", "no_text_layer", None)


def test_eval_ac22_failed_outcome_carries_the_reason_as_failure() -> None:
    result = {"outcome": "failed", "reason": "model_unavailable"}
    case = extract_case(client_for(extract_response(result)), CONTRACT, "p", "a")
    assert (case.outcome, case.failure) == ("failed", "model_unavailable")


def test_eval_ac22_http_error_is_a_failed_case() -> None:
    case = extract_case(client_for(lambda request: httpx.Response(502)), CONTRACT, "p", "a")
    assert (case.outcome, case.failure) == ("failed", "http_502")


def test_eval_ac53_a_read_timeout_is_a_failed_case_with_timeout() -> None:
    timeouts: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        timeouts.append(request.extensions["timeout"])
        raise httpx.ReadTimeout("slow")

    case = extract_case(client_for(handler), CONTRACT, "p", "a")
    assert (case.outcome, case.failure) == ("failed", "timeout")
    assert timeouts[0]["read"] == 210


class AgentWiki:
    def __init__(self, run: Handler, pages: list[dict[str, str]] | None = None) -> None:
        self.paths: list[str] = []
        self.run = run
        self.pages = pages if pages is not None else [{"id": "p1", "title": "Alt", "md": "a"}]

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.paths.append(path)
        body = json.loads(request.content) if request.content else {}
        if path == "/api/ai/agent/run":
            return self.run(request)
        if path == "/api/spaces":
            return httpx.Response(200, json={"data": {"items": [{"id": "s1"}]}})
        if path == "/api/pages/recent":
            items = [{"id": page["id"]} for page in self.pages]
            meta = {"hasNextPage": False, "nextCursor": None}
            return httpx.Response(200, json={"data": {"items": items, "meta": meta}})
        [page] = [page for page in self.pages if page["id"] == body["pageId"]]
        assert body["format"] == "markdown"
        info = {"title": page["title"], "content": page["md"]}
        return httpx.Response(200, json={"data": info})


def test_eval_ac32_agent_run_sends_space_and_task_and_parses_events() -> None:
    bodies: list[dict[str, Any]] = []

    def run(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        events = [
            {"type": "run", "runId": "r"},
            {"type": "proposal", "proposal": {"pageTitle": "Alt"}},
            {"type": "proposal", "proposal": {"pageTitle": "Älter"}},
            {"type": "end", "outcome": "finished", "pagesRead": 3, "message": None},
        ]
        return httpx.Response(200, content=sse(*events))

    wiki = AgentWiki(run)
    client = client_for(wiki.handler)
    case = agent_case(client, SCENARIO, "space-1", lambda: workspace_snapshot(client))
    assert bodies == [{"spaceId": "space-1", "task": "Aufgabe"}]
    assert case.outcome == "finished"
    assert case.proposal_pages == ("Alt", "Älter")
    assert case.failure is None
    assert case.changed_pages == ()
    assert not any("proposal/apply" in path or "proposal/discard" in path for path in wiki.paths)
    assert "/api/ai/agent/proposal" not in wiki.paths


def test_eval_ac32_a_page_changed_during_the_run_is_reported() -> None:
    wiki: AgentWiki

    def run(request: httpx.Request) -> httpx.Response:
        wiki.pages[0]["md"] = "geändert"
        end = {"type": "end", "outcome": "finished", "pagesRead": 1, "message": None}
        return httpx.Response(200, content=sse(end))

    wiki = AgentWiki(run)
    client = client_for(wiki.handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert case.changed_pages == ("Alt",)


def test_eval_ac32_a_run_without_an_end_event_fails_with_no_end() -> None:
    wiki = AgentWiki(
        lambda request: httpx.Response(200, content=sse({"type": "run", "runId": "r"}))
    )
    client = client_for(wiki.handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert (case.outcome, case.failure) == (None, "no_end")


def test_eval_ac32_model_failed_and_context_too_small_are_failures() -> None:
    for outcome in ("model_failed", "context_too_small"):
        end = {"type": "end", "outcome": outcome, "pagesRead": 0, "message": None}
        wiki = AgentWiki(lambda request, end=end: httpx.Response(200, content=sse(end)))
        client = client_for(wiki.handler)
        case = agent_case(client, SCENARIO, "s", lambda client=client: workspace_snapshot(client))
        assert (case.outcome, case.failure) == (outcome, outcome)


def test_eval_ac54_a_run_past_900_seconds_closes_the_stream_and_fails_with_timeout() -> None:
    endless = ClosingStream({"type": "run", "runId": "r"} for _ in range(1000))
    wiki = AgentWiki(lambda request: httpx.Response(200, stream=endless))
    client = client_for(wiki.handler)
    case = agent_case(
        client, SCENARIO, "s", lambda: workspace_snapshot(client), stepping_clock(400)
    )
    assert (case.outcome, case.failure) == (None, "timeout")
    assert endless.closed


@pytest.mark.parametrize(
    "proposal_event",
    [
        {"type": "proposal"},
        {"type": "proposal", "proposal": "Alt"},
        {"type": "proposal", "proposal": {}},
        {"type": "proposal", "proposal": {"pageTitle": 4}},
    ],
)
def test_eval_ac32_agent_a_proposal_event_of_the_wrong_shape_is_a_malformed_event(
    proposal_event: dict[str, Any],
) -> None:
    end = {"type": "end", "outcome": "finished", "pagesRead": 1, "message": None}
    wiki = AgentWiki(lambda request: httpx.Response(200, content=sse(proposal_event, end)))
    client = client_for(wiki.handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert case.failure == MALFORMED_EVENT
    assert case.proposal_pages == ()


def test_eval_ac32_agent_http_error_is_a_failed_case() -> None:
    wiki = AgentWiki(lambda request: httpx.Response(409))
    client = client_for(wiki.handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert (case.outcome, case.failure) == (None, "http_409")


def test_eval_ac36_snapshot_holds_title_and_markdown_of_every_page() -> None:
    pages = [
        {"id": "p1", "title": "Eins", "md": "# Eins"},
        {"id": "p2", "title": "Zwei", "md": "z"},
    ]
    wiki = AgentWiki(lambda request: httpx.Response(500), pages)
    snapshot = workspace_snapshot(client_for(wiki.handler))
    assert snapshot == {"p1": ("Eins", "# Eins"), "p2": ("Zwei", "z")}


def test_eval_ac36_unchanged_workspace_has_no_changed_pages() -> None:
    snapshot = {"p1": ("Eins", "a")}
    assert changed_pages(snapshot, dict(snapshot)) == ()


def test_eval_ac37_changed_markdown_or_title_is_reported_by_title() -> None:
    before = {"p1": ("Eins", "a"), "p2": ("Zwei", "b")}
    after = {"p1": ("Eins", "geändert"), "p2": ("Zwei neu", "b")}
    assert changed_pages(before, after) == ("Eins", "Zwei neu")


def test_eval_ac38_added_and_removed_pages_are_reported() -> None:
    before = {"p1": ("Eins", "a")}
    after = {"p2": ("Neu", "n")}
    assert changed_pages(before, after) == ("Eins", "Neu")


def test_eval_ac62_attachment_lookup_finds_the_pdf_by_name() -> None:
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "x"}]},
            {
                "type": "attachment",
                "attrs": {
                    "name": "vertrag.pdf",
                    "attachmentId": "att-1",
                    "mime": "application/pdf",
                },
            },
        ],
    }
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"data": {"content": content}})

    assert page_attachments(client_for(handler), "p1") == {"vertrag.pdf": "att-1"}
    assert bodies == [{"pageId": "p1"}]


@pytest.mark.parametrize("line", ["data: {broken", "data: 5", 'data: {"text": "ohne Typ"}'])
def test_eval_ac8_a_malformed_event_line_is_a_failed_case_and_the_run_goes_on(line: str) -> None:
    content = f'data: {{"type": "delta", "text": "x"}}\n\n{line}\n\n'.encode()
    client = client_for(lambda request: httpx.Response(200, content=content))
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure) == ("failed", "malformed_event")


def test_eval_ac8_an_error_event_without_a_code_is_a_failed_case() -> None:
    client = client_for(lambda request: httpx.Response(200, content=sse({"type": "error"})))
    case = ask_case(client, QUESTION)
    assert (case.outcome, case.failure) == ("failed", "error_without_code")


def test_eval_ac32_a_malformed_agent_event_is_a_failed_case() -> None:
    wiki = AgentWiki(lambda request: httpx.Response(200, content=b"data: {broken\n\n"))
    client = client_for(wiki.handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert (case.outcome, case.failure) == (None, "malformed_event")


def test_eval_ac22_a_200_with_a_body_that_is_no_json_is_a_failed_case() -> None:
    client = client_for(lambda request: httpx.Response(200, content=b"<html>Bad gateway</html>"))
    case = extract_case(client, CONTRACT, "p", "a")
    assert (case.outcome, case.failure) == ("failed", "invalid_response")


@pytest.mark.parametrize(
    "result", [{}, {"outcome": "extracted"}, {"outcome": "extracted", "fields": [{"key": "term"}]}]
)
def test_eval_ac22_a_result_without_outcome_or_fields_is_a_failed_case(
    result: dict[str, Any],
) -> None:
    case = extract_case(client_for(extract_response(result)), CONTRACT, "p", "a")
    assert (case.outcome, case.failure) == ("failed", "invalid_response")


def test_eval_ac22_a_body_that_is_no_object_is_a_failed_case() -> None:
    client = client_for(lambda request: httpx.Response(200, json=["x"]))
    case = extract_case(client, CONTRACT, "p", "a")
    assert (case.outcome, case.failure) == ("failed", "invalid_response")


def test_eval_ac36_a_failing_snapshot_before_the_run_fails_the_scenario_without_a_run() -> None:
    wiki = AgentWiki(lambda request: httpx.Response(200, content=sse({"type": "run"})))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/pages/info":
            return httpx.Response(500)
        return wiki.handler(request)

    client = client_for(handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert (case.outcome, case.failure) == (None, "snapshot_500")
    assert "/api/ai/agent/run" not in wiki.paths


def test_eval_ac36_a_failing_snapshot_after_the_run_fails_the_scenario() -> None:
    end = {"type": "end", "outcome": "finished", "pagesRead": 1, "message": None}
    wiki = AgentWiki(lambda request: httpx.Response(200, content=sse(end)))
    ran = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal ran
        ran = ran or request.url.path == "/api/ai/agent/run"
        if ran and request.url.path == "/api/pages/recent":
            return httpx.Response(500)
        return wiki.handler(request)

    client = client_for(handler)
    case = agent_case(client, SCENARIO, "s", lambda: workspace_snapshot(client))
    assert (case.outcome, case.failure) == ("finished", "snapshot_500")


class SilentAfterEvents(BaseHTTPRequestHandler):
    release: threading.Event
    pauses: list[float]

    def do_POST(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for pause in self.pauses:
            self.wfile.write(b'data: {"type": "delta", "text": "x"}\n\n')
            self.wfile.flush()
            if self.release.wait(pause):
                return
        self.release.wait(30)

    def log_message(self, format: str, *args: Any) -> None:
        return None


def test_eval_ac52_a_silent_stream_is_cut_at_the_deadline_not_one_read_timeout_later() -> None:
    handler = type(
        "Handler", (SilentAfterEvents,), {"release": threading.Event(), "pauses": [2.7, 0]}
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    client = httpx.Client(base_url=f"http://127.0.0.1:{server.server_port}")
    started = time.monotonic()
    try:
        streamed = stream_events(client, "/stream", {}, 3.0, time.monotonic)
    finally:
        elapsed = time.monotonic() - started
        handler.release.set()
        server.shutdown()
        client.close()
    assert streamed.failure == "timeout"
    assert len(streamed.events) == 2
    assert 2.9 <= elapsed < 4.8
