import json
from datetime import UTC, datetime
from typing import Any, cast

from redis import Redis

JOB_STREAM = "ai-service:jobs"


def enqueue_job(redis: Redis, name: str, data: dict[str, object]) -> str:
    entry: dict[Any, Any] = {
        "name": name,
        "data": json.dumps(data),
        "receivedAt": datetime.now(UTC).isoformat(),
    }
    return cast(str, redis.xadd(JOB_STREAM, entry))
