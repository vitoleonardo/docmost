import uvicorn
from redis import Redis

from ai_service.app import create_app
from ai_service.settings import Settings


def load_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]


def main() -> None:
    settings = load_settings()
    redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
    uvicorn.run(
        create_app(settings, redis),
        host=settings.ai_service_host,
        port=settings.ai_service_port,
    )


if __name__ == "__main__":
    main()
