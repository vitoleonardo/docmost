import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from redis import Redis

MAX_TURNS = 5
HISTORY_TTL_SECONDS = 86400
KEY_PREFIX = "ai-service:conversation"

LOGGER = logging.getLogger("ai_service.conversations")


@dataclass(frozen=True)
class Turn:
    question: str
    answer: str
    source_page_ids: Sequence[str]


def conversation_key(user_id: str, conversation_id: str) -> str:
    for name, value in (("user id", user_id), ("conversation id", conversation_id)):
        if not value or ":" in value:
            raise ValueError(f"invalid {name}")
    return f"{KEY_PREFIX}:{user_id}:{conversation_id}"


def parse_turn(raw: str) -> Turn:
    data = json.loads(raw)
    return Turn(
        question=data["question"],
        answer=data["answer"],
        source_page_ids=list(data["sourcePageIds"]),
    )


class ConversationStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    def load(self, user_id: str, conversation_id: str) -> list[Turn]:
        key = conversation_key(user_id, conversation_id)
        entries = cast(list[str], self._redis.lrange(key, 0, -1))
        turns: list[Turn] = []
        for raw in entries:
            try:
                turns.append(parse_turn(raw))
            except ValueError, KeyError, TypeError:
                LOGGER.warning("dropping malformed conversation entry", extra={"key": key})
        return turns

    def append(self, user_id: str, conversation_id: str, turn: Turn) -> None:
        key = conversation_key(user_id, conversation_id)
        entry = json.dumps(
            {
                "question": turn.question,
                "answer": turn.answer,
                "sourcePageIds": list(turn.source_page_ids),
            }
        )
        with self._redis.pipeline(transaction=True) as pipe:
            pipe.rpush(key, entry)
            pipe.ltrim(key, -MAX_TURNS, -1)
            pipe.expire(key, HISTORY_TTL_SECONDS)
            pipe.execute()
