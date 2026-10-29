import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import fakeredis
import pytest
from fastapi.testclient import TestClient

from ai_service import auth
from ai_service.app import create_app
from ai_service.extraction import ExtractionPipeline
from ai_service.inference import JsonCompletion, ModelUnavailable
from ai_service.jobs import JOB_STREAM, enqueue_job
from tests.conftest import idle_ask_pipeline, idle_extraction_pipeline, make_settings
from tests.index_db import SPACE_A, page_id
from tests.pdf_fixtures import build_blank_pdf, build_pdf
from tests.test_ask import Harness, hit

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "ai-bridge.json"
CONTRACT: dict[str, Any] = json.loads(CONTRACT_PATH.read_text())
AI_SERVICE_ENDPOINTS: list[dict[str, Any]] = [
    endpoint for endpoint in CONTRACT["endpoints"] if endpoint["side"] == "ai-service"
]
IDLE_REDIS = fakeredis.FakeRedis()
OPENAPI: dict[str, Any] = create_app(
    make_settings(), IDLE_REDIS, idle_ask_pipeline(IDLE_REDIS), idle_extraction_pipeline()
).openapi()


def resolve(schema: dict[str, Any]) -> dict[str, Any]:
    ref = schema.get("$ref")
    if ref is None:
        return schema
    node: Any = OPENAPI
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    return node


def operation(endpoint: dict[str, Any]) -> dict[str, Any]:
    return OPENAPI["paths"][endpoint["path"]][endpoint["method"].lower()]


def body_fields(content: dict[str, Any]) -> set[str]:
    schema = resolve(content["application/json"]["schema"])
    return set(schema.get("properties", {}))


def endpoint_id(endpoint: dict[str, Any]) -> str:
    return f"{endpoint['method']} {endpoint['path']}"


def test_contract_has_ai_service_endpoints() -> None:
    assert AI_SERVICE_ENDPOINTS


@pytest.mark.parametrize("endpoint", AI_SERVICE_ENDPOINTS, ids=endpoint_id)
def test_bridge_ac35_endpoint_exists_with_the_contract_method_and_path(
    endpoint: dict[str, Any],
) -> None:
    assert endpoint["method"].lower() in OPENAPI["paths"].get(endpoint["path"], {})


def test_bridge_ac35_every_route_of_the_service_is_in_the_contract() -> None:
    served = {
        (method.upper(), path) for path, methods in OPENAPI["paths"].items() for method in methods
    }
    contracted = {(endpoint["method"], endpoint["path"]) for endpoint in AI_SERVICE_ENDPOINTS}

    assert served == contracted


@pytest.mark.parametrize("endpoint", AI_SERVICE_ENDPOINTS, ids=endpoint_id)
def test_bridge_ac35_request_fields_equal_the_contract(endpoint: dict[str, Any]) -> None:
    request_body = operation(endpoint).get("requestBody")

    served = body_fields(request_body["content"]) if request_body else set()

    assert served == set(endpoint["request"])


@pytest.mark.parametrize("endpoint", AI_SERVICE_ENDPOINTS, ids=endpoint_id)
def test_bridge_ac35_success_status_and_response_fields_equal_the_contract(
    endpoint: dict[str, Any],
) -> None:
    success = [status for status in operation(endpoint)["responses"] if status.startswith("2")]

    assert success == [str(endpoint["status"])]
    if endpoint["status"] == 204:
        assert "content" not in operation(endpoint)["responses"][success[0]]
        assert endpoint["response"] == []
        return
    content = operation(endpoint)["responses"][success[0]]["content"]
    if endpoint.get("responseType") == "ndjson":
        assert list(content) == [endpoint["responseContentType"]]
        assert endpoint["response"] == []
        return
    if "outcomes" in endpoint:
        assert endpoint["response"] == []
        return
    assert body_fields(content) == set(endpoint["response"])


def test_bridge_ac35_error_codes_and_statuses_equal_the_contract() -> None:
    contract_errors: dict[str, int] = CONTRACT["errors"]
    listed = {code for endpoint in AI_SERVICE_ENDPOINTS for code in endpoint["errors"]}

    assert listed == set(auth.ERROR_STATUS)
    for code, status in auth.ERROR_STATUS.items():
        assert contract_errors[code] == status


def test_bridge_ac36_user_token_claims_ai_service_requires_are_in_the_contract() -> None:
    contract_claims = set(CONTRACT["tokens"]["user"]["claims"])
    required = set(auth.USER_TOKEN_REGISTERED_CLAIMS) | set(auth.USER_TOKEN_CUSTOM_CLAIMS)

    assert required == contract_claims
    assert {"sub", "workspaceId", "aud", "type", "iat", "exp"} <= required


def event_fields(event: Any, prefix: str = "") -> set[str]:
    if isinstance(event, list) and event and isinstance(event[0], dict):
        return event_fields(event[0], f"{prefix}[]")
    if isinstance(event, dict):
        return {
            field
            for key, value in event.items()
            for field in event_fields(value, f"{prefix}.{key}" if prefix else key)
        }
    return {prefix}


def test_ask_ac9_every_ask_event_has_exactly_the_fields_of_the_contract(
    redis_client: fakeredis.FakeRedis,
) -> None:
    ask = next(endpoint for endpoint in AI_SERVICE_ENDPOINTS if endpoint["path"] == "/v1/ask")
    answered = Harness(redis=redis_client)
    answered.search.hits = [hit(1)]
    answered.bridge.viewable = {page_id(1)}
    failing = Harness(redis=redis_client)
    failing.search.hits = [hit(1)]
    failing.bridge.viewable = {page_id(1)}
    failing.model.deltas = []
    failing.model.failure = ModelUnavailable("HTTP 503")
    empty = Harness(redis=redis_client)

    events = [
        event
        for harness in (answered, failing, empty)
        for event in harness.run(space_ids=[SPACE_A])
    ]

    by_type: dict[str, set[str]] = {}
    for event in events:
        by_type.setdefault(event["type"], set()).update(event_fields(event))
    assert by_type == {name: set(fields) for name, fields in ask["events"].items()}
    errors = [event["code"] for event in events if event["type"] == "error"]
    assert set(errors) == set(ask["values"]["errorCode"])


@dataclass
class ContractModel:
    fails: bool
    model: str = "stub"

    def complete_json(
        self, messages: list[dict[str, str]], schema: dict[str, Any]
    ) -> JsonCompletion:
        if self.fails:
            raise ModelUnavailable("HTTP 503")
        answer = {
            key: {"value": None, "quote": None}
            for key in ("parties", "term", "noticePeriod", "value", "renewal")
        }
        return JsonCompletion(text=json.dumps(answer), prompt_tokens=10_000)


def test_extract_ac50_every_extract_outcome_has_exactly_the_fields_of_the_contract(
    service_headers: dict[str, str], make_token: Callable[..., str]
) -> None:
    extract = next(
        endpoint for endpoint in AI_SERVICE_ENDPOINTS if endpoint["path"] == "/v1/extract"
    )
    headers = {**service_headers, "X-User-Token": make_token()}
    body = {"attachmentId": "6f1b6a52-0c0e-4f55-9c4a-0d2f0f6f2a11", "fileSize": 10}
    answers = {
        "extracted": build_pdf(["Die Laufzeit betraegt zwei Jahre ab Unterschrift."]),
        "refused": build_blank_pdf(1),
        "failed": build_pdf(["Die Laufzeit betraegt zwei Jahre ab Unterschrift."]),
    }
    seen: dict[str, set[str]] = {}
    for outcome, document in answers.items():
        model = ContractModel(fails=outcome == "failed")
        pipeline = ExtractionPipeline(lambda _, d=document: d, model, "local", "m")
        redis = fakeredis.FakeRedis()
        app = create_app(make_settings(), redis, idle_ask_pipeline(redis), pipeline)

        response = TestClient(app).post("/v1/extract", headers=headers, json=body)

        assert response.status_code == extract["status"]
        seen[outcome] = event_fields(response.json())

    assert seen == {name: set(fields) for name, fields in extract["outcomes"].items()}
    assert set(extract["values"]["outcome"]) == set(seen)


def test_bridge_ac36_user_token_algorithm_audience_and_type_equal_the_contract() -> None:
    assert auth.USER_TOKEN_ALGORITHM == CONTRACT["tokens"]["algorithm"]
    assert auth.USER_TOKEN_AUDIENCE == CONTRACT["tokens"]["user"]["aud"]
    assert auth.USER_TOKEN_TYPE == CONTRACT["tokens"]["user"]["type"]


def test_bridge_ac36_job_stream_and_stored_fields_equal_the_contract() -> None:
    redis = fakeredis.FakeRedis(decode_responses=True)

    enqueue_job(redis, "page-created", {"pageIds": ["p"], "workspaceId": "w"})

    [(_, stored)] = cast(list[Any], redis.xrange(CONTRACT["jobs"]["stream"]))
    assert JOB_STREAM == CONTRACT["jobs"]["stream"]
    assert set(stored) - {"receivedAt"} == set(CONTRACT["jobs"]["body"])
    assert json.loads(stored["data"]) == {"pageIds": ["p"], "workspaceId": "w"}


def test_bridge_ac36_job_request_body_equals_the_contract_job_body() -> None:
    jobs = next(endpoint for endpoint in AI_SERVICE_ENDPOINTS if endpoint["path"] == "/v1/jobs")

    assert set(jobs["request"]) == set(CONTRACT["jobs"]["body"])
