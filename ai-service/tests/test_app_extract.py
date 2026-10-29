import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import fakeredis
import httpx
import pytest
from fastapi.testclient import TestClient
from redis import Redis

from ai_service.app import create_app
from ai_service.bridge_client import (
    AttachmentNotFound,
    BridgeError,
    BridgeRefused,
    BridgeUnavailable,
    BridgeUnreachable,
)
from ai_service.extraction import ExtractionPipeline
from ai_service.inference import JsonCompletion, ModelUnavailable
from tests.conftest import BRIDGE_KEY, idle_ask_pipeline, make_settings
from tests.pdf_fixtures import build_blank_pdf, build_pdf

PATH = "/v1/extract"
ATTACHMENT_ID = "6f1b6a52-0c0e-4f55-9c4a-0d2f0f6f2a11"
BODY = {"attachmentId": ATTACHMENT_ID, "fileSize": 1234}
KEYS = ["parties", "term", "noticePeriod", "value", "renewal"]
TERM_QUOTE = "Die Laufzeit betraegt zwei Jahre ab Unterschrift."
TERM_VALUE = "zwei Jahre"
LOGGER_NAME = "ai_service.extraction"


@dataclass
class StubModel:
    value: str | None = TERM_VALUE
    quote: str | None = TERM_QUOTE
    error: ModelUnavailable | None = None
    model: str = "qwen3:8b"
    calls: int = 0

    def complete_json(
        self, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> JsonCompletion:
        self.calls += 1
        if self.error is not None:
            raise self.error
        body: dict[str, Any] = {key: {"value": None, "quote": None} for key in KEYS}
        body["term"] = {"value": self.value, "quote": self.quote}
        return JsonCompletion(text=json.dumps(body), prompt_tokens=10_000)


@dataclass
class StubFetch:
    document: bytes = field(default_factory=lambda: build_pdf([TERM_QUOTE]))
    error: Exception | None = None
    fetched: list[str] = field(default_factory=list)

    def __call__(self, attachment_id: str) -> bytes:
        self.fetched.append(attachment_id)
        if self.error is not None:
            raise self.error
        return self.document


def make_client(
    fetch: StubFetch, model: StubModel | None = None, redis: Redis | None = None
) -> TestClient:
    used_redis = fakeredis.FakeRedis() if redis is None else redis
    pipeline = ExtractionPipeline(fetch, model or StubModel(), "local", "qwen3:8b")
    return TestClient(
        create_app(make_settings(), used_redis, idle_ask_pipeline(used_redis), pipeline)
    )


def extract(
    client: TestClient, headers: dict[str, str], body: dict[str, Any] | None = None
) -> httpx.Response:
    return client.post(PATH, headers=headers, json=BODY if body is None else body)


@pytest.mark.parametrize(
    ("service_token", "code"),
    [(None, "service_token_missing"), ("x" * 32, "service_token_invalid")],
)
def test_extract_ac50_a_missing_or_wrong_service_token_is_401(
    make_token: Callable[..., str], service_token: str | None, code: str
):
    request_headers = {"X-User-Token": make_token()}
    if service_token is not None:
        request_headers["X-Service-Token"] = service_token
    fetch = StubFetch()

    response = extract(make_client(fetch), request_headers)

    assert response.status_code == 401
    assert response.json()["code"] == code
    assert fetch.fetched == []


def test_extract_ac50_the_service_token_is_checked_before_the_body(
    make_token: Callable[..., str],
):
    response = extract(make_client(StubFetch()), {"X-User-Token": make_token()}, {"userId": "x"})

    assert response.status_code == 401
    assert response.json()["code"] == "service_token_missing"


def test_extract_ac50_a_missing_user_token_is_401(service_headers: dict[str, str]):
    fetch = StubFetch()

    response = extract(make_client(fetch), service_headers)

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_missing"
    assert fetch.fetched == []


def test_extract_ac50_an_expired_user_token_is_401(
    service_headers: dict[str, str], make_token: Callable[..., str]
):
    import time

    now = int(time.time())
    expired = make_token(iat=now - 120, exp=now - 60)
    fetch = StubFetch()

    response = extract(make_client(fetch), {**service_headers, "X-User-Token": expired})

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_expired"
    assert fetch.fetched == []


@pytest.mark.parametrize(
    "token_arguments",
    [
        {"secret": BRIDGE_KEY[::-1]},
        {"aud": "someone-else"},
        {"secret": "", "algorithm": "none"},
    ],
    ids=["other-secret", "wrong-audience", "alg-none"],
)
def test_extract_ac61_an_invalid_user_token_is_user_token_invalid(
    service_headers: dict[str, str],
    make_token: Callable[..., str],
    token_arguments: dict[str, Any],
):
    fetch = StubFetch()

    response = extract(
        make_client(fetch),
        {**service_headers, "X-User-Token": make_token(**token_arguments)},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"
    assert fetch.fetched == []


def test_extract_ac61_a_malformed_user_token_is_user_token_invalid(
    service_headers: dict[str, str],
):
    response = extract(make_client(StubFetch()), {**service_headers, "X-User-Token": "not.a.jwt"})

    assert response.status_code == 401
    assert response.json()["code"] == "user_token_invalid"


@pytest.mark.parametrize(
    "body",
    [
        {**BODY, "userId": "0192f000-0000-7000-8000-000000000001"},
        {"fileSize": 10},
        {"attachmentId": ATTACHMENT_ID},
        {**BODY, "fileSize": -1},
        {**BODY, "fileSize": "12"},
        {**BODY, "fileSize": 1.5},
        {**BODY, "attachmentId": "not-a-uuid"},
    ],
    ids=[
        "user-id",
        "missing-attachment-id",
        "missing-file-size",
        "negative-file-size",
        "string-file-size",
        "float-file-size",
        "malformed-attachment-id",
    ],
)
def test_extract_ac51_an_invalid_body_is_400_invalid_request(
    headers: dict[str, str], body: dict[str, Any]
):
    fetch = StubFetch()

    response = extract(make_client(fetch), headers, body)

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"
    assert fetch.fetched == []


def test_extract_ac51_a_zero_file_size_is_accepted(headers: dict[str, str]):
    response = extract(make_client(StubFetch()), headers, {**BODY, "fileSize": 0})

    assert response.status_code == 200


def test_extract_ac50_an_extracted_result_is_200_with_five_fields_in_order(
    headers: dict[str, str],
):
    fetch = StubFetch()

    response = extract(make_client(fetch), headers)

    assert response.status_code == 200
    assert fetch.fetched == [ATTACHMENT_ID]
    body = response.json()
    assert body["outcome"] == "extracted"
    assert [item["key"] for item in body["fields"]] == KEYS
    assert body["fields"][1] == {
        "key": "term",
        "value": TERM_VALUE,
        "quote": TERM_QUOTE,
        "pdfPage": 1,
    }
    assert body["fields"][0] == {"key": "parties", "value": None, "quote": None, "pdfPage": None}


def test_extract_ac50_a_refusal_is_200_with_the_reason_and_counts(headers: dict[str, str]):
    model = StubModel()

    response = extract(make_client(StubFetch(document=build_blank_pdf(3)), model), headers)

    assert response.status_code == 200
    assert response.json() == {
        "outcome": "refused",
        "reason": "no_text_layer",
        "pageCount": 3,
        "fileSize": None,
        "characterCount": None,
    }
    assert model.calls == 0


def test_extract_ac50_a_failed_model_is_200_failed(headers: dict[str, str]):
    model = StubModel(error=ModelUnavailable("HTTP 503"))

    response = extract(make_client(StubFetch(), model), headers)

    assert response.status_code == 200
    assert response.json() == {"outcome": "failed", "reason": "model_unavailable"}


def test_extract_ac50_a_too_large_file_is_refused_without_a_fetch(headers: dict[str, str]):
    fetch = StubFetch()

    response = extract(make_client(fetch), headers, {**BODY, "fileSize": 12_163_481})

    assert response.json() == {
        "outcome": "refused",
        "reason": "too_large",
        "pageCount": None,
        "fileSize": 12_163_481,
        "characterCount": None,
    }
    assert fetch.fetched == []


def test_extract_ac52_nothing_is_stored_and_values_are_not_logged(
    headers: dict[str, str], caplog: pytest.LogCaptureFixture
):
    redis = fakeredis.FakeRedis(decode_responses=True)
    caplog.set_level(logging.DEBUG)

    response = extract(make_client(StubFetch(), redis=redis), headers)

    assert response.json()["outcome"] == "extracted"
    assert redis.keys("*") == []
    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert ATTACHMENT_ID in logged
    assert TERM_VALUE not in logged
    assert TERM_QUOTE not in logged
    assert "Laufzeit" not in logged


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AttachmentNotFound("HTTP 404"), 404, "attachment_not_found"),
        (BridgeUnavailable("HTTP 500"), 503, "assistant_unavailable"),
        (BridgeUnreachable("no answer"), 503, "assistant_unavailable"),
        (BridgeRefused("assistant_disabled"), 503, "assistant_unavailable"),
        (BridgeError("HTTP 400"), 503, "assistant_unavailable"),
    ],
    ids=["not-found", "unavailable", "unreachable", "refused", "other-bridge-error"],
)
def test_extract_ac50_a_bridge_error_is_a_coded_error(
    headers: dict[str, str], error: Exception, status: int, code: str
):
    model = StubModel()

    response = extract(make_client(StubFetch(error=error), model), headers)

    assert response.status_code == status
    assert response.json()["code"] == code
    assert set(response.json()) == {"code", "message"}
    assert model.calls == 0
