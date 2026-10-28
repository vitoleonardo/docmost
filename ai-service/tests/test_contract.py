import json
from pathlib import Path
from typing import Any, cast

import fakeredis
import pytest

from ai_service import auth
from ai_service.app import create_app
from ai_service.jobs import JOB_STREAM, enqueue_job
from tests.conftest import make_settings

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs" / "contracts" / "ai-bridge.json"
CONTRACT: dict[str, Any] = json.loads(CONTRACT_PATH.read_text())
AI_SERVICE_ENDPOINTS: list[dict[str, Any]] = [
    endpoint for endpoint in CONTRACT["endpoints"] if endpoint["side"] == "ai-service"
]
OPENAPI: dict[str, Any] = create_app(make_settings(), fakeredis.FakeRedis()).openapi()


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
    content = operation(endpoint)["responses"][success[0]]["content"]
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

    assert required == contract_claims - {"spaceIds"}
    assert {"sub", "workspaceId", "aud", "type", "iat", "exp"} <= required


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
