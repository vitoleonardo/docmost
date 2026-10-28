import json
import time
from collections.abc import Callable, Generator, Iterator

import httpx

CONNECT_TIMEOUT_SECONDS = 10.0
READ_TIMEOUT_SECONDS = 60.0
FIRST_TEXT_DEADLINE_SECONDS = 60.0
DONE_MARKER = "[DONE]"
DATA_PREFIX = "data:"


class ModelUnavailable(Exception):
    def __init__(self, cause: str):
        super().__init__(cause)
        self.cause = cause


class ChatModel:
    def __init__(
        self,
        base_url: str,
        model: str,
        http: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.model = model
        self._clock = clock
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
        first_text_deadline = self._clock() + FIRST_TEXT_DEADLINE_SECONDS
        try:
            with self.http.stream("POST", self._url, json=body) as response:
                if response.status_code >= 400:
                    raise ModelUnavailable(f"HTTP {response.status_code}")
                yield from self._deltas(response, first_text_deadline)
        except httpx.HTTPError as error:
            raise ModelUnavailable(type(error).__name__) from error

    def _deltas(self, response: httpx.Response, first_text_deadline: float) -> Iterator[str]:
        has_text = False
        for line in response.iter_lines():
            if not has_text and self._clock() > first_text_deadline:
                raise ModelUnavailable(f"no answer text within {FIRST_TEXT_DEADLINE_SECONDS:.0f} s")
            if not line.startswith(DATA_PREFIX):
                continue
            payload = line.removeprefix(DATA_PREFIX).strip()
            if payload == DONE_MARKER:
                return
            delta = self._delta_text(payload)
            if delta:
                has_text = True
                yield delta
        raise ModelUnavailable("stream ended without completion marker")

    def _delta_text(self, payload: str) -> str:
        try:
            content = json.loads(payload)["choices"][0]["delta"].get("content")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            raise ModelUnavailable("malformed stream") from error
        return content if isinstance(content, str) else ""
