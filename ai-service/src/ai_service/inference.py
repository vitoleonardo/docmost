import json
import logging
import queue
import socket
import threading
import time
from collections.abc import Callable, Generator, Iterator
from dataclasses import dataclass
from typing import Any

import httpx

CONNECT_TIMEOUT_SECONDS = 10.0
READ_TIMEOUT_SECONDS = 60.0
FIRST_TEXT_DEADLINE_SECONDS = 60.0
LOGGER = logging.getLogger("ai_service.inference")
COMPLETION_TIMEOUT_SECONDS = 180.0
DONE_MARKER = "[DONE]"
DATA_PREFIX = "data:"
CANCEL_POLL_SECONDS = 0.05
CONNECTED_EVENT = "connection.connect_tcp.complete"


@dataclass(frozen=True)
class JsonCompletion:
    text: str
    prompt_tokens: int | None
    completion_tokens: int | None


@dataclass
class StreamUsage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict | str


@dataclass(frozen=True)
class ToolCompletion:
    text: str | None
    tool_calls: list[ToolCall]
    prompt_tokens: int | None
    completion_tokens: int | None


class ModelCallCancelled(Exception):
    pass


class ModelUnavailable(Exception):
    def __init__(self, cause: str):
        super().__init__(cause)
        self.cause = cause


class FirstTextWatchdog:
    def __init__(self, response: httpx.Response, seconds: float):
        self.expired = threading.Event()
        self._response = response
        self._timer = threading.Timer(max(seconds, 0.0), self._expire)
        self._timer.daemon = True
        self._timer.start()

    def stop(self) -> None:
        self._timer.cancel()

    def _expire(self) -> None:
        self.expired.set()
        shut_down_socket(self._response.extensions.get("network_stream"), "first-text watchdog")


def shut_down_socket(network_stream: object, closer: str) -> None:
    get_extra_info = getattr(network_stream, "get_extra_info", None)
    if get_extra_info is None:
        return
    try:
        sock = get_extra_info("socket")
        if sock is not None:
            sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        return
    except Exception as error:
        LOGGER.warning("%s could not close the socket: %s", closer, type(error).__name__)


class ToolCallConnection:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._network_stream: object = None
        self._closed = False

    def trace(self, event: str, info: dict[str, Any]) -> None:
        if event != CONNECTED_EVENT:
            return
        with self._lock:
            self._network_stream = info.get("return_value")
            closed = self._closed
        if closed:
            shut_down_socket(self._network_stream, "model call abort")

    def close(self) -> None:
        with self._lock:
            self._closed = True
            network_stream = self._network_stream
        shut_down_socket(network_stream, "model call abort")


class ChatModel:
    def __init__(
        self,
        base_url: str,
        model: str,
        http: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
        first_text_deadline_seconds: float = FIRST_TEXT_DEADLINE_SECONDS,
    ):
        self.model = model
        self._clock = clock
        self._first_text_deadline_seconds = first_text_deadline_seconds
        self.http = http or httpx.Client(
            timeout=httpx.Timeout(READ_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)
        )
        self._url = f"{base_url.rstrip('/')}/chat/completions"

    def stream(
        self, messages: list[dict[str, str]], usage: StreamUsage | None = None
    ) -> Generator[str]:
        body = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
            "temperature": 0,
            "reasoning_effort": "none",
        }
        first_text_deadline = self._clock() + self._first_text_deadline_seconds
        try:
            with self.http.stream("POST", self._url, json=body) as response:
                if response.status_code >= 400:
                    raise ModelUnavailable(f"HTTP {response.status_code}")
                watchdog = FirstTextWatchdog(response, first_text_deadline - self._clock())
                try:
                    yield from self._deltas(response, first_text_deadline, watchdog, usage)
                finally:
                    watchdog.stop()
        except httpx.HTTPError as error:
            raise ModelUnavailable(type(error).__name__) from error

    def complete_json(
        self,
        messages: list[dict[str, str]],
        schema: dict,
        timeout_seconds: float = COMPLETION_TIMEOUT_SECONDS,
    ) -> JsonCompletion:
        body = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "temperature": 0,
            "reasoning_effort": "none",
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "extraction", "schema": schema},
            },
        }
        deadline = self._clock() + timeout_seconds
        try:
            response = self.http.post(
                self._url,
                json=body,
                timeout=httpx.Timeout(timeout_seconds, connect=CONNECT_TIMEOUT_SECONDS),
            )
        except httpx.HTTPError as error:
            raise ModelUnavailable(type(error).__name__) from error
        if self._clock() > deadline:
            raise ModelUnavailable(f"no complete answer within {timeout_seconds:.0f} s")
        if response.status_code >= 400:
            raise ModelUnavailable(f"HTTP {response.status_code}")
        return self._completion(response)

    def complete_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict],
        deadline_seconds: float,
        cancel: threading.Event | None = None,
    ) -> ToolCompletion:
        if cancel is not None and cancel.is_set():
            raise ModelCallCancelled()
        body = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": False,
            "temperature": 0,
            "reasoning_effort": "none",
        }
        connection = ToolCallConnection()
        request = self.http.build_request(
            "POST",
            self._url,
            json=body,
            headers={"Connection": "close"},
            timeout=httpx.Timeout(deadline_seconds, connect=CONNECT_TIMEOUT_SECONDS),
            extensions={"trace": connection.trace},
        )
        outcome: queue.Queue[httpx.Response | Exception] = queue.Queue(maxsize=1)

        def send() -> None:
            try:
                outcome.put(self.http.send(request))
            except Exception as error:
                outcome.put(error)

        threading.Thread(target=send, name="model-tool-call", daemon=True).start()
        try:
            response = self._await_response(outcome, deadline_seconds, cancel)
        except ModelCallCancelled, ModelUnavailable:
            connection.close()
            raise
        if response.status_code >= 400:
            raise ModelUnavailable(f"HTTP {response.status_code}")
        return self._tool_completion(response)

    def _await_response(
        self,
        outcome: queue.Queue[httpx.Response | Exception],
        deadline_seconds: float,
        cancel: threading.Event | None,
    ) -> httpx.Response:
        deadline = self._clock() + deadline_seconds
        while True:
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise ModelUnavailable(f"timeout after {deadline_seconds:.0f} s")
            try:
                result = outcome.get(timeout=min(remaining, CANCEL_POLL_SECONDS))
            except queue.Empty:
                if cancel is not None and cancel.is_set():
                    raise ModelCallCancelled() from None
                continue
            if isinstance(result, httpx.HTTPError):
                raise ModelUnavailable(type(result).__name__) from result
            if isinstance(result, Exception):
                raise result
            return result

    def _tool_completion(self, response: httpx.Response) -> ToolCompletion:
        try:
            payload = response.json()
            message = payload["choices"][0]["message"]
            text = message.get("content")
            raw_calls = message.get("tool_calls") or []
            if not isinstance(raw_calls, list) or not (text is None or isinstance(text, str)):
                raise TypeError
            if text is None and not raw_calls:
                raise ValueError
            tool_calls = [self._tool_call(raw) for raw in raw_calls]
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            raise ModelUnavailable("malformed completion") from error
        prompt_tokens, completion_tokens = self._usage(payload)
        return ToolCompletion(
            text=text,
            tool_calls=tool_calls,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
        )

    def _tool_call(self, raw: dict) -> ToolCall:
        function = raw["function"]
        call_id, name, arguments = raw["id"], function["name"], function["arguments"]
        if not isinstance(call_id, str) or not call_id or not isinstance(name, str):
            raise TypeError
        if isinstance(arguments, str):
            try:
                parsed = json.loads(arguments)
            except ValueError:
                return ToolCall(call_id, name, arguments)
            return ToolCall(call_id, name, parsed if isinstance(parsed, dict) else arguments)
        if isinstance(arguments, dict):
            return ToolCall(call_id, name, arguments)
        raise TypeError

    def _usage(self, payload: dict) -> tuple[int | None, int | None]:
        usage = payload.get("usage")
        if not isinstance(usage, dict):
            return None, None
        return self._token_count(usage.get("prompt_tokens")), self._token_count(
            usage.get("completion_tokens")
        )

    def _token_count(self, value: object) -> int | None:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            return None
        return value

    def _completion(self, response: httpx.Response) -> JsonCompletion:
        try:
            payload = response.json()
            text = payload["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise ModelUnavailable("malformed completion") from error
        if not isinstance(text, str):
            raise ModelUnavailable("malformed completion")
        prompt_tokens, completion_tokens = self._usage(payload)
        return JsonCompletion(
            text=text, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

    def _deltas(
        self,
        response: httpx.Response,
        first_text_deadline: float,
        watchdog: FirstTextWatchdog,
        usage: StreamUsage | None,
    ) -> Iterator[str]:
        has_text = False
        try:
            for line in response.iter_lines():
                if not has_text and self._clock() > first_text_deadline:
                    raise self._no_text_in_time()
                if not line.startswith(DATA_PREFIX):
                    continue
                payload = line.removeprefix(DATA_PREFIX).strip()
                if payload == DONE_MARKER:
                    return
                delta = self._delta_text(payload, usage)
                if delta:
                    has_text = True
                    watchdog.stop()
                    yield delta
        except httpx.HTTPError as error:
            if watchdog.expired.is_set() and not has_text:
                raise self._no_text_in_time() from error
            raise
        if watchdog.expired.is_set() and not has_text:
            raise self._no_text_in_time()
        raise ModelUnavailable("stream ended without completion marker")

    def _no_text_in_time(self) -> ModelUnavailable:
        return ModelUnavailable(f"no answer text within {self._first_text_deadline_seconds:.0f} s")

    def _delta_text(self, payload: str, usage: StreamUsage | None) -> str:
        try:
            chunk = json.loads(payload)
            has_usage = isinstance(chunk.get("usage"), dict)
            if has_usage and usage is not None:
                usage.prompt_tokens, usage.completion_tokens = self._usage(chunk)
            choices = chunk.get("choices")
            if not isinstance(choices, list):
                if has_usage:
                    return ""
                raise TypeError
            if not choices:
                return ""
            content = choices[0]["delta"].get("content")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            raise ModelUnavailable("malformed stream") from error
        return content if isinstance(content, str) else ""
