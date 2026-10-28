import json
from collections.abc import Callable, Iterator

import httpx
import pytest

from ai_service.inference import ChatModel, ModelUnavailable

BASE_URL = "http://127.0.0.1:11434/v1"
MESSAGES = [{"role": "user", "content": "Wie viele Urlaubstage?"}]


def sse(*deltas: str) -> bytes:
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": delta}}]}) + "\n\n"
        for delta in deltas
    ]
    return "".join(lines + ["data: [DONE]\n\n"]).encode()


def chat_model(handler: Callable[[httpx.Request], httpx.Response]) -> ChatModel:
    return ChatModel(
        BASE_URL, "qwen3:8b", http=httpx.Client(transport=httpx.MockTransport(handler))
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
