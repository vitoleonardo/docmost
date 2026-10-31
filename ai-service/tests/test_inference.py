import json
import logging
import socket
import threading
import time
from collections.abc import Callable, Iterator

import httpx
import pytest

from ai_service.inference import (
    FIRST_TEXT_DEADLINE_SECONDS,
    ChatModel,
    JsonCompletion,
    ModelUnavailable,
)
from tests.conftest import FakeClock

BASE_URL = "http://127.0.0.1:11434/v1"
MESSAGES = [{"role": "user", "content": "Wie viele Urlaubstage?"}]


def sse(*deltas: str) -> bytes:
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": delta}}]}) + "\n\n"
        for delta in deltas
    ]
    return "".join(lines + ["data: [DONE]\n\n"]).encode()


def chat_model(
    handler: Callable[[httpx.Request], httpx.Response], clock: FakeClock | None = None
) -> ChatModel:
    return ChatModel(
        BASE_URL,
        "qwen3:8b",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        clock=time.monotonic if clock is None else clock,
    )


def serving(body: bytes, status: int = 200) -> Callable[[httpx.Request], httpx.Response]:
    return lambda request: httpx.Response(status, content=body)


def raising(error: Exception) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    return handler


def test_ask_ac67_deltas_are_yielded_in_order():
    model = chat_model(serving(sse("30 ", "Urlaubstage", " [1]")))
    assert list(model.stream(MESSAGES)) == ["30 ", "Urlaubstage", " [1]"]


def test_ask_ac67_empty_and_role_only_deltas_are_skipped():
    body = (
        b'data: {"choices": [{"delta": {"role": "assistant", "content": ""}}]}\n\n'
        b'data: {"choices": [{"delta": {"content": "Hallo"}}]}\n\n'
        b'data: {"choices": [{"delta": {}, "finish_reason": "stop"}]}\n\n'
        b"data: [DONE]\n\n"
    )
    assert list(chat_model(serving(body)).stream(MESSAGES)) == ["Hallo"]


def test_ask_ac67_request_body_and_url():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=sse("x"))

    list(chat_model(handler).stream(MESSAGES))
    assert str(seen[0].url) == f"{BASE_URL}/chat/completions"
    assert json.loads(seen[0].content) == {
        "model": "qwen3:8b",
        "messages": MESSAGES,
        "stream": True,
        "temperature": 0,
        "reasoning_effort": "none",
    }


def test_ask_ac67_connection_refused_raises_model_unavailable():
    model = chat_model(raising(httpx.ConnectError("refused")))
    with pytest.raises(ModelUnavailable) as error:
        list(model.stream(MESSAGES))
    assert "ConnectError" in error.value.cause


def test_ask_ac67_server_error_raises_model_unavailable():
    model = chat_model(serving(b"boom", status=503))
    with pytest.raises(ModelUnavailable) as error:
        list(model.stream(MESSAGES))
    assert "503" in error.value.cause


def test_ask_ac67_malformed_stream_raises_model_unavailable():
    model = chat_model(serving(b"data: {not json\n\n"))
    with pytest.raises(ModelUnavailable):
        list(model.stream(MESSAGES))


def test_ask_ac67_stream_without_done_raises_model_unavailable():
    body = b'data: {"choices": [{"delta": {"content": "a"}}]}\n\n'
    model = chat_model(serving(body))
    with pytest.raises(ModelUnavailable):
        list(model.stream(MESSAGES))


def test_ask_ac68_read_timeout_raises_model_unavailable():
    model = chat_model(raising(httpx.ReadTimeout("slow")))
    with pytest.raises(ModelUnavailable) as error:
        list(model.stream(MESSAGES))
    assert "ReadTimeout" in error.value.cause


def test_ask_ac68_default_client_waits_60_seconds_to_read_and_10_to_connect():
    timeout = ChatModel(BASE_URL, "qwen3:8b").http.timeout
    assert timeout.read == 60
    assert timeout.connect == 10


ROLE_ONLY_CHUNK = b'data: {"choices": [{"delta": {"role": "assistant", "content": ""}}]}\n\n'


class Trickling(httpx.SyncByteStream):
    def __init__(self, clock: FakeClock, seconds_per_chunk: float, first_text_at: int | None):
        self.clock = clock
        self.seconds_per_chunk = seconds_per_chunk
        self.first_text_at = first_text_at
        self.sent = 0
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        while self.sent < 1000:
            self.clock.now += self.seconds_per_chunk
            self.sent += 1
            if self.first_text_at is not None and self.sent >= self.first_text_at:
                yield sse("Text")[: -len(b"data: [DONE]\n\n")]
                self.clock.now += self.seconds_per_chunk
                yield sse("mehr")
                return
            yield ROLE_ONLY_CHUNK

    def close(self) -> None:
        self.closed = True


def test_ask_ac68_a_model_that_sends_only_empty_chunks_past_60_seconds_fails_and_closes():
    clock = FakeClock()
    body = Trickling(clock, seconds_per_chunk=15, first_text_at=None)
    model = chat_model(lambda request: httpx.Response(200, stream=body), clock)

    with pytest.raises(ModelUnavailable) as error:
        list(model.stream(MESSAGES))

    assert FIRST_TEXT_DEADLINE_SECONDS == 60
    assert "no answer text within 60 s" in error.value.cause
    assert body.sent == 5
    assert body.closed


def test_ask_ac68_text_that_starts_within_60_seconds_may_continue_past_them():
    clock = FakeClock()
    body = Trickling(clock, seconds_per_chunk=59, first_text_at=1)
    model = chat_model(lambda request: httpx.Response(200, stream=body), clock)

    assert list(model.stream(MESSAGES)) == ["Text", "mehr"]
    assert clock.now == 118


@pytest.fixture
def silent_after_an_empty_chunk_port() -> Iterator[int]:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    release = threading.Event()

    def serve() -> None:
        connection, _ = server.accept()
        connection.recv(65536)
        connection.sendall(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
            b"Transfer-Encoding: chunked\r\n\r\n"
        )
        empty_chunk = ROLE_ONLY_CHUNK
        connection.sendall(f"{len(empty_chunk):x}\r\n".encode() + empty_chunk + b"\r\n")
        release.wait(30)
        connection.close()

    threading.Thread(target=serve, daemon=True).start()
    try:
        yield server.getsockname()[1]
    finally:
        release.set()
        server.close()


def test_ask_ac68_an_empty_chunk_then_silence_fails_at_the_deadline_not_at_the_read_timeout(
    silent_after_an_empty_chunk_port: int,
):
    started = time.monotonic()
    with httpx.Client(timeout=httpx.Timeout(3.0)) as http:
        model = ChatModel(
            f"http://127.0.0.1:{silent_after_an_empty_chunk_port}/v1",
            "qwen3:8b",
            http=http,
            first_text_deadline_seconds=0.5,
        )
        with pytest.raises(ModelUnavailable) as error:
            list(model.stream(MESSAGES))
    assert time.monotonic() - started < 2
    assert "no answer text within" in error.value.cause


def test_ask_ac69_error_after_first_delta_keeps_the_text_then_raises():
    class Broken(httpx.SyncByteStream):
        def __iter__(self) -> Iterator[bytes]:
            yield sse("Teil")[: -len(b"data: [DONE]\n\n")]
            raise httpx.ReadError("cut")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=Broken())

    received: list[str] = []
    with pytest.raises(ModelUnavailable):
        for delta in chat_model(handler).stream(MESSAGES):
            received.append(delta)
    assert received == ["Teil"]


def test_ask_ac69_closing_the_generator_closes_the_response():
    closed: list[bool] = []

    class Tracked(httpx.SyncByteStream):
        def __iter__(self) -> Iterator[bytes]:
            yield sse("a", "b")

        def close(self) -> None:
            closed.append(True)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, stream=Tracked())

    stream = chat_model(handler).stream(MESSAGES)
    assert next(stream) == "a"
    assert closed == []
    stream.close()
    assert closed == [True]


def test_ask_ac67_model_name_is_exposed():
    assert chat_model(serving(sse("x"))).model == "qwen3:8b"


class HangsUntilReadTimeout(httpx.SyncByteStream):
    def __iter__(self) -> Iterator[bytes]:
        time.sleep(0.3)
        raise httpx.ReadTimeout("read timed out")


class StreamWithoutExtraInfo:
    pass


class StreamWithBrokenExtraInfo:
    def get_extra_info(self, name: str) -> object:
        raise RuntimeError("no socket for " + name)


def run_with_expiring_watchdog(
    network_stream: object, monkeypatch: pytest.MonkeyPatch
) -> tuple[list[threading.ExceptHookArgs], ModelUnavailable]:
    thread_errors: list[threading.ExceptHookArgs] = []
    monkeypatch.setattr(threading, "excepthook", thread_errors.append)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            stream=HangsUntilReadTimeout(),
            extensions={"network_stream": network_stream},
        )

    model = ChatModel(
        BASE_URL,
        "qwen3:8b",
        http=httpx.Client(transport=httpx.MockTransport(handler)),
        first_text_deadline_seconds=0.05,
    )
    with pytest.raises(ModelUnavailable) as error:
        list(model.stream(MESSAGES))
    time.sleep(0.1)
    return thread_errors, error.value


def test_ask_ac68_a_stream_without_extra_info_leaves_the_read_timeout_to_end_the_call(
    monkeypatch: pytest.MonkeyPatch,
):
    thread_errors, failure = run_with_expiring_watchdog(StreamWithoutExtraInfo(), monkeypatch)
    assert thread_errors == []
    assert "no answer text within" in failure.cause


def test_ask_ac68_an_unexpected_socket_lookup_error_is_logged_not_raised_in_the_timer_thread(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
):
    with caplog.at_level(logging.WARNING):
        thread_errors, failure = run_with_expiring_watchdog(
            StreamWithBrokenExtraInfo(), monkeypatch
        )
    assert thread_errors == []
    assert "no answer text within" in failure.cause
    assert "RuntimeError" in caplog.text


SCHEMA = {"type": "object", "properties": {"parties": {"type": "string"}}}


def envelope(content: object, usage: object = None) -> bytes:
    body: dict = {"choices": [{"message": {"content": content}}]}
    if usage is not None:
        body["usage"] = usage
    return json.dumps(body).encode()


def test_extract_contract_request_asks_for_a_json_schema_answer_without_streaming():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=envelope("{}"))

    chat_model(handler).complete_json(MESSAGES, SCHEMA)
    assert str(seen[0].url) == f"{BASE_URL}/chat/completions"
    assert json.loads(seen[0].content) == {
        "model": "qwen3:8b",
        "messages": MESSAGES,
        "stream": False,
        "temperature": 0,
        "reasoning_effort": "none",
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "extraction", "schema": SCHEMA},
        },
    }


def test_extract_ac66_returns_text_and_prompt_tokens():
    body = envelope('{"parties": "A"}', {"prompt_tokens": 2050, "completion_tokens": 9})
    result = chat_model(serving(body)).complete_json(MESSAGES, SCHEMA)
    assert result == JsonCompletion(text='{"parties": "A"}', prompt_tokens=2050)


@pytest.mark.parametrize("usage", [None, {}, {"prompt_tokens": "2050"}, {"prompt_tokens": None}])
def test_extract_ac66_missing_or_non_integer_prompt_tokens_are_none(usage: object):
    result = chat_model(serving(envelope("{}", usage))).complete_json(MESSAGES, SCHEMA)
    assert result.prompt_tokens is None


def test_extract_ac38_connection_refused_raises_model_unavailable():
    model = chat_model(raising(httpx.ConnectError("refused")))
    with pytest.raises(ModelUnavailable) as error:
        model.complete_json(MESSAGES, SCHEMA)
    assert "ConnectError" in error.value.cause


def test_extract_ac39_read_timeout_raises_model_unavailable():
    model = chat_model(raising(httpx.ReadTimeout("slow")))
    with pytest.raises(ModelUnavailable) as error:
        model.complete_json(MESSAGES, SCHEMA)
    assert "ReadTimeout" in error.value.cause


def test_extract_ac39_request_timeout_covers_the_whole_call():
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=envelope("{}"))

    chat_model(handler).complete_json(MESSAGES, SCHEMA, timeout_seconds=42.0)
    timeout = seen[0].extensions["timeout"]
    assert timeout["read"] == 42.0
    assert timeout["write"] == 42.0
    assert timeout["pool"] == 42.0


def test_extract_ac39_answer_arriving_after_the_deadline_raises_model_unavailable():
    clock = FakeClock()

    def handler(request: httpx.Request) -> httpx.Response:
        clock.now += 181
        return httpx.Response(200, content=envelope("{}"))

    with pytest.raises(ModelUnavailable) as error:
        chat_model(handler, clock).complete_json(MESSAGES, SCHEMA, timeout_seconds=180)
    assert "180" in error.value.cause


def test_extract_ac39_answer_within_the_deadline_is_returned():
    clock = FakeClock()

    def handler(request: httpx.Request) -> httpx.Response:
        clock.now += 179
        return httpx.Response(200, content=envelope("{}"))

    assert chat_model(handler, clock).complete_json(MESSAGES, SCHEMA).text == "{}"


def test_extract_ac38_server_error_raises_model_unavailable():
    with pytest.raises(ModelUnavailable) as error:
        chat_model(serving(b"boom", status=500)).complete_json(MESSAGES, SCHEMA)
    assert "500" in error.value.cause


@pytest.mark.parametrize(
    "body",
    [
        b"not json",
        b"[]",
        b"{}",
        b'{"choices": []}',
        b'{"choices": [{}]}',
        b'{"choices": [{"message": {}}]}',
        envelope(None),
        envelope(12),
        envelope(["a"]),
    ],
)
def test_extract_ac40_malformed_envelope_raises_model_unavailable(body: bytes):
    with pytest.raises(ModelUnavailable) as error:
        chat_model(serving(body)).complete_json(MESSAGES, SCHEMA)
    assert "SECRET" not in error.value.cause


def test_extract_ac40_the_cause_never_holds_model_content():
    body = b'{"choices": [{"message": {"content": 12}}], "note": "SECRET"}'
    with pytest.raises(ModelUnavailable) as error:
        chat_model(serving(body)).complete_json(MESSAGES, SCHEMA)
    assert "SECRET" not in error.value.cause
