import json
from collections.abc import Generator, Iterator

import httpx

CONNECT_TIMEOUT_SECONDS = 10.0
READ_TIMEOUT_SECONDS = 60.0
DONE_MARKER = "[DONE]"
DATA_PREFIX = "data:"


class ModelUnavailable(Exception):
    def __init__(self, cause: str):
        super().__init__(cause)
        self.cause = cause


class ChatModel:
    def __init__(self, base_url: str, model: str, http: httpx.Client | None = None):
        self.model = model
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
        try:
            with self.http.stream("POST", self._url, json=body) as response:
                if response.status_code >= 400:
                    raise ModelUnavailable(f"HTTP {response.status_code}")
                yield from self._deltas(response)
        except httpx.HTTPError as error:
            raise ModelUnavailable(type(error).__name__) from error

    def _deltas(self, response: httpx.Response) -> Iterator[str]:
        for line in response.iter_lines():
            if not line.startswith(DATA_PREFIX):
                continue
            payload = line.removeprefix(DATA_PREFIX).strip()
            if payload == DONE_MARKER:
                return
            delta = self._delta_text(payload)
            if delta:
                yield delta
        raise ModelUnavailable("stream ended without completion marker")

    def _delta_text(self, payload: str) -> str:
        try:
            content = json.loads(payload)["choices"][0]["delta"].get("content")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            raise ModelUnavailable("malformed stream") from error
        return content if isinstance(content, str) else ""
