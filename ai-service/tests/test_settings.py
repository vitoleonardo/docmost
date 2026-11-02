from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

import ai_service.__main__ as entry
from ai_service.settings import WorkerSettings
from tests.conftest import (
    BRIDGE_KEY,
    REQUEST_LOG_KEY,
    SERVICE_CREDENTIAL,
    TEST_DATABASE_URL,
    TEST_REDIS_URL,
    IsolatedAskSettings,
    IsolatedSettings,
    make_ask_settings,
    make_settings,
)
from tests.test_app_ask import settings_environment

SHORT_LOG_SECRET = "short-request-log-secret-012345"
ACCEPTED_LOG_SECRET = "request-log-secret-0123456789abc"


@pytest.fixture
def skip_database_check(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(entry, "check_database_role", lambda database_url: None)


def test_bridge_ac75_default_host_is_loopback():
    settings = make_settings()
    assert settings.ai_service_host == "127.0.0.1"
    assert settings.ai_service_port == 8100


@pytest.mark.usefixtures("skip_database_check", "hashing_embedder_loaded")
def test_bridge_ac75_main_passes_settings_host_to_uvicorn(monkeypatch: pytest.MonkeyPatch):
    calls: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    monkeypatch.setattr(entry, "load_settings", lambda: make_ask_settings(ai_service_port=9100))
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    entry.main()
    assert len(calls) == 1
    assert calls[0][1]["host"] == "127.0.0.1"
    assert calls[0][1]["port"] == 9100


@pytest.mark.usefixtures("skip_database_check", "hashing_embedder_loaded")
def test_bridge_ac75_configured_host_is_used(monkeypatch: pytest.MonkeyPatch):
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        entry, "load_settings", lambda: make_ask_settings(ai_service_host="10.0.0.5")
    )
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
    monkeypatch.setenv("AI_REQUEST_LOG_SECRET", REQUEST_LOG_KEY)
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


@pytest.mark.usefixtures("api_environment")
def test_ask_ac67_ask_settings_require_ai_wiki_url():
    with pytest.raises(ValidationError) as error:
        IsolatedAskSettings()  # pyright: ignore[reportCallIssue]
    assert "ai_wiki_url" in str(error.value)


@pytest.mark.usefixtures("api_environment")
def test_ask_ac67_ask_settings_defaults(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AI_WIKI_URL", "http://127.0.0.1:3000")
    settings = IsolatedAskSettings()  # pyright: ignore[reportCallIssue]
    assert settings.ai_relevance_threshold == 0.45
    assert settings.ai_inference_mode == "local"
    assert settings.ai_llm_model == "qwen3:8b"
    assert settings.ai_llm_base_url == "http://127.0.0.1:11434/v1"
    assert settings.ai_embedding_model == "jinaai/jina-embeddings-v2-base-de"


def start_api(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, environment: dict[str, str]
) -> list[object]:
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AI_REQUEST_LOG_SECRET", raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    started: list[object] = []
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: started.append(args))
    entry.main()
    return started


def refused_start(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    environment: dict[str, str],
) -> str:
    with pytest.raises(SystemExit) as exit_info:
        start_api(monkeypatch, tmp_path, environment)
    assert exit_info.value.code == 1
    return capsys.readouterr().err


@pytest.mark.usefixtures("skip_database_check", "hashing_embedder_loaded")
def test_reqlog_ac26_start_without_the_log_secret_exits_naming_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    environment = settings_environment()
    del environment["AI_REQUEST_LOG_SECRET"]
    stderr = refused_start(monkeypatch, tmp_path, capsys, environment)
    assert stderr.strip() == "AI_REQUEST_LOG_SECRET is not set"


@pytest.mark.usefixtures("skip_database_check", "hashing_embedder_loaded")
def test_reqlog_ac27_log_secret_of_31_characters_exits_naming_it_without_its_value(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
):
    assert len(SHORT_LOG_SECRET) == 31
    environment = settings_environment(AI_REQUEST_LOG_SECRET=SHORT_LOG_SECRET)
    stderr = refused_start(monkeypatch, tmp_path, capsys, environment)
    assert "AI_REQUEST_LOG_SECRET is invalid" in stderr
    assert SHORT_LOG_SECRET not in stderr


@pytest.mark.usefixtures("skip_database_check", "hashing_embedder_loaded")
@pytest.mark.parametrize("reused", [BRIDGE_KEY, SERVICE_CREDENTIAL], ids=["bridge", "service"])
def test_reqlog_ac49_log_secret_equal_to_another_secret_exits_naming_it_without_its_value(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    reused: str,
):
    environment = settings_environment(AI_REQUEST_LOG_SECRET=reused)
    stderr = refused_start(monkeypatch, tmp_path, capsys, environment)
    assert stderr.startswith("AI_REQUEST_LOG_SECRET is invalid")
    assert reused not in stderr


@pytest.mark.parametrize("reused", [BRIDGE_KEY, SERVICE_CREDENTIAL], ids=["bridge", "service"])
def test_reqlog_ac49_log_secret_equal_to_another_secret_is_rejected(reused: str):
    with pytest.raises(ValidationError) as error:
        make_ask_settings(ai_request_log_secret=reused)
    assert [problem["loc"] for problem in error.value.errors()] == [("ai_request_log_secret",)]


@pytest.mark.usefixtures("skip_database_check", "hashing_embedder_loaded")
def test_reqlog_ac50_distinct_log_secret_of_32_characters_starts_the_api(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    assert len(ACCEPTED_LOG_SECRET) == 32
    environment = settings_environment(AI_REQUEST_LOG_SECRET=ACCEPTED_LOG_SECRET)
    assert len(start_api(monkeypatch, tmp_path, environment)) == 1


def test_reqlog_ac50_distinct_log_secret_of_32_characters_is_kept():
    settings = make_ask_settings(ai_request_log_secret=ACCEPTED_LOG_SECRET)
    assert settings.ai_request_log_secret == ACCEPTED_LOG_SECRET
