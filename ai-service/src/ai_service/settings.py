from pathlib import Path

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_CONTENT_DIR = REPO_ROOT / "apps" / "server" / "src" / "integrations" / "seed" / "content"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_bridge_secret: str = Field(min_length=32)
    ai_service_token: str = Field(min_length=32)
    redis_url: str
    ai_database_url: str
    ai_service_host: str = "127.0.0.1"
    ai_service_port: int = 8100


class IndexSettings(Settings):
    ai_wiki_url: str
    ai_embedding_model: str = "jinaai/jina-embeddings-v2-base-de"


class WorkerSettings(IndexSettings):
    pass


class AskSettings(IndexSettings):
    ai_llm_base_url: str = "http://127.0.0.1:11434/v1"
    ai_llm_model: str = "qwen3:8b"
    ai_inference_mode: str = "local"
    ai_relevance_threshold: float = 0.45
    ai_request_log_secret: str = Field(min_length=32)

    @field_validator("ai_request_log_secret")
    @classmethod
    def differs_from_the_other_secrets(cls, value: str, info: ValidationInfo) -> str:
        others = (info.data.get("ai_bridge_secret"), info.data.get("ai_service_token"))
        if value in others:
            raise ValueError("must differ from AI_BRIDGE_SECRET and AI_SERVICE_TOKEN")
        return value


class MigrationSettings(BaseSettings):
    model_config = Settings.model_config

    ai_database_url: str


class LeakSuiteSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    leak_wiki_url: str
    leak_seed_password: str = "seed-demo-password"
    leak_report_path: Path = REPO_ROOT / "reports" / "leak-tests.md"
    leak_content_dir: Path = SEED_CONTENT_DIR
    leak_inference_mode: str = str(AskSettings.model_fields["ai_inference_mode"].default)
    leak_model: str = str(AskSettings.model_fields["ai_llm_model"].default)
    leak_embedding_model: str = str(AskSettings.model_fields["ai_embedding_model"].default)
    leak_injection_timeout_seconds: float = 180
    leak_poll_seconds: float = 5


class RequestLogReportSettings(BaseSettings):
    model_config = Settings.model_config

    ai_database_url: str
    request_log_report_path: Path = REPO_ROOT / "reports" / "request-log.md"


class DbSetupSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_db_admin_url: str
    ai_database_url: str
