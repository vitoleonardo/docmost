import time
from collections.abc import Callable
from typing import Any

import fakeredis
import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic_settings import SettingsConfigDict
from redis import Redis

from ai_service.app import create_app
from ai_service.settings import Settings

BRIDGE_KEY = "test-bridge-secret-0123456789abcdef"
SERVICE_CREDENTIAL = "test-service-token-0123456789abcdef"
USER_ID = "0192f000-0000-7000-8000-000000000001"
WORKSPACE_ID = "0192f000-0000-7000-8000-000000000002"
TEST_REDIS_URL = "redis://127.0.0.1:6380/15"
TEST_DATABASE_URL = "postgresql://docmost_ai:test-ai-password@127.0.0.1:5433/docmost"


class IsolatedSettings(Settings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "ai_bridge_secret": BRIDGE_KEY,
        "ai_service_token": SERVICE_CREDENTIAL,
        "redis_url": TEST_REDIS_URL,
        "ai_database_url": TEST_DATABASE_URL,
        **overrides,
    }
    return IsolatedSettings(**values)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def redis_client() -> Redis:
    return fakeredis.FakeRedis(decode_responses=True)


@pytest.fixture
def client(settings: Settings, redis_client: Redis) -> TestClient:
    return TestClient(create_app(settings, redis_client))


@pytest.fixture
def service_headers() -> dict[str, str]:
    return {"X-Service-Token": SERVICE_CREDENTIAL}


@pytest.fixture
def make_token() -> Callable[..., str]:
    def make(
        secret: str = BRIDGE_KEY,
        algorithm: str = "HS256",
        **overrides: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "sub": USER_ID,
            "workspaceId": WORKSPACE_ID,
            "spaceIds": ["0192f000-0000-7000-8000-000000000003"],
            "aud": "ai-service",
            "type": "user",
            "iat": now,
            "exp": now + 60,
        }
        claims.update(overrides)
        claims = {key: value for key, value in claims.items() if value is not None}
        return jwt.encode(claims, secret, algorithm=algorithm)

    return make
