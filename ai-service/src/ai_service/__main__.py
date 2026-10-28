import sys

import uvicorn
from redis import Redis

from ai_service.app import create_app
from ai_service.db_check import RoleNotIsolatedError, check_database_role
from ai_service.settings import Settings


def load_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]


def main() -> None:
    settings = load_settings()
    try:
        check_database_role(settings.ai_database_url)
    except RoleNotIsolatedError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
    redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)
    uvicorn.run(
        create_app(settings, redis),
        host=settings.ai_service_host,
        port=settings.ai_service_port,
    )


if __name__ == "__main__":
    main()
