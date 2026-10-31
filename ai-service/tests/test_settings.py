from typing import Any

import pytest
from pydantic import ValidationError

import ai_service.__main__ as entry
from ai_service.settings import WorkerSettings
from tests.conftest import (
    BRIDGE_KEY,
    SERVICE_CREDENTIAL,
    TEST_DATABASE_URL,
    TEST_REDIS_URL,
    IsolatedSettings,
    make_settings,
)


@pytest.fixture
def skip_database_check(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(entry, "check_database_role", lambda database_url: None)


def test_bridge_ac75_default_host_is_loopback():
    settings = make_settings()
    assert settings.ai_service_host == "127.0.0.1"
    assert settings.ai_service_port == 8100


@pytest.mark.usefixtures("skip_database_check")
def test_bridge_ac75_main_passes_settings_host_to_uvicorn(monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    monkeypatch.setattr(entry, "load_settings", lambda: make_settings(ai_service_port=9100))
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    entry.main()
    assert len(calls) == 1
    assert calls[0][1]["host"] == "127.0.0.1"
    assert calls[0][1]["port"] == 9100


@pytest.mark.usefixtures("skip_database_check")
def test_bridge_ac75_configured_host_is_used(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(entry, "load_settings", lambda: make_settings(ai_service_host="10.0.0.5"))
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: calls.append(kwargs))
    entry.main()
    assert calls[0]["host"] == "10.0.0.5"


@pytest.mark.parametrize("field", ["ai_bridge_secret", "ai_service_token"])
def test_bridge_ac75_short_secret_is_rejected(field: str):
    with pytest.raises(ValidationError):
        make_settings(**{field: "short"})


def test_bridge_ac75_values_come_from_environment(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AI_BRIDGE_SECRET", BRIDGE_KEY)
    monkeypatch.setenv("AI_SERVICE_TOKEN", SERVICE_CREDENTIAL)
    monkeypatch.setenv("REDIS_URL", TEST_REDIS_URL)
    monkeypatch.setenv("AI_DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("AI_SERVICE_PORT", "9200")
    settings = IsolatedSettings()  # pyright: ignore[reportCallIssue]
    assert settings.redis_url == TEST_REDIS_URL
    assert settings.ai_service_port == 9200
    assert settings.ai_database_url == TEST_DATABASE_URL


class IsolatedWorkerSettings(WorkerSettings):
    model_config = IsolatedSettings.model_config


@pytest.fixture
def api_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_BRIDGE_SECRET", BRIDGE_KEY)
    monkeypatch.setenv("AI_SERVICE_TOKEN", SERVICE_CREDENTIAL)
    monkeypatch.setenv("REDIS_URL", TEST_REDIS_URL)
    monkeypatch.setenv("AI_DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.delenv("AI_WIKI_URL", raising=False)


@pytest.mark.usefixtures("api_environment")
def test_index_ac76_worker_settings_require_ai_wiki_url():
    with pytest.raises(ValidationError) as error:
        IsolatedWorkerSettings()  # pyright: ignore[reportCallIssue]
    assert "ai_wiki_url" in str(error.value)


@pytest.mark.usefixtures("api_environment")
def test_index_ac76_worker_settings_read_wiki_url_and_default_model(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("AI_WIKI_URL", "http://127.0.0.1:3000")
    settings = IsolatedWorkerSettings()  # pyright: ignore[reportCallIssue]
    assert settings.ai_wiki_url == "http://127.0.0.1:3000"
    assert settings.ai_embedding_model == "jinaai/jina-embeddings-v2-base-de"
