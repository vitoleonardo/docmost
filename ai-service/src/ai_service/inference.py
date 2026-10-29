import json
import logging
import socket
import threading
import time
from collections.abc import Callable, Generator, Iterator

import httpx

CONNECT_TIMEOUT_SECONDS = 10.0
READ_TIMEOUT_SECONDS = 60.0
FIRST_TEXT_DEADLINE_SECONDS = 60.0
LOGGER = logging.getLogger("ai_service.inference")
DONE_MARKER = "[DONE]"
DATA_PREFIX = "data:"


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
        get_extra_info = getattr(
            self._response.extensions.get("network_stream"), "get_extra_info", None
        )
        if get_extra_info is None:
            return
        try:
            sock = get_extra_info("socket")
            if sock is not None:
                sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            return
        except Exception as error:
            LOGGER.warning(
                "first-text watchdog could not close the socket: %s", type(error).__name__
            )


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

    def stream(self, messages: list[dict[str, str]]) -> Generator[str]:
        body = {
            "model": self.model,
            "messages": messages,
            "stream": True,
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
                    yield from self._deltas(response, first_text_deadline, watchdog)
                finally:
                    watchdog.stop()
        except httpx.HTTPError as error:
            raise ModelUnavailable(type(error).__name__) from error

    def _deltas(
        self, response: httpx.Response, first_text_deadline: float, watchdog: FirstTextWatchdog
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
                delta = self._delta_text(payload)
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

    def _delta_text(self, payload: str) -> str:
        try:
            content = json.loads(payload)["choices"][0]["delta"].get("content")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            raise ModelUnavailable("malformed stream") from error
        return content if isinstance(content, str) else ""
