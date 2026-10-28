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


class DbSetupSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ai_db_admin_url: str
    ai_database_url: str
