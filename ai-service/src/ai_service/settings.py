from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_bridge_secret: str = Field(min_length=32)
    ai_service_token: str = Field(min_length=32)
    redis_url: str
    ai_database_url: str
    ai_service_host: str = "127.0.0.1"
    ai_service_port: int = 8100


class WorkerSettings(Settings):
    ai_wiki_url: str
    ai_embedding_model: str = "jinaai/jina-embeddings-v2-base-de"


class MigrationSettings(BaseSettings):
    model_config = Settings.model_config

    ai_database_url: str


class DbSetupSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_db_admin_url: str
    ai_database_url: str
