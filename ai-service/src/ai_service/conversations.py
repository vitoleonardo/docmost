import json
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from redis import Redis
from redis.client import Pipeline

MAX_TURNS = 5
HISTORY_TTL_SECONDS = 86400
KEY_PREFIX = "ai-service:conversation"

LOGGER = logging.getLogger("ai_service.conversations")


@dataclass(frozen=True)
class Turn:
    question: str
    answer: str
    source_page_ids: Sequence[str]


@dataclass(frozen=True)
class StoredTurn:
    turn_id: str
    confirmed: bool
    turn: Turn
    raw: str


def conversation_key(user_id: str, conversation_id: str) -> str:
    for name, value in (("user id", user_id), ("conversation id", conversation_id)):
        if not value or ":" in value:
            raise ValueError(f"invalid {name}")
    return f"{KEY_PREFIX}:{user_id}:{conversation_id}"


def parse_entry(raw: str) -> StoredTurn:
    data = json.loads(raw)
    return StoredTurn(
        turn_id=str(data["turnId"]),
        confirmed=data["confirmed"] is True,
        turn=Turn(
            question=data["question"],
            answer=data["answer"],
            source_page_ids=list(data["sourcePageIds"]),
        ),
        raw=raw,
    )


def entry(turn_id: str, confirmed: bool, turn: Turn) -> str:
    return json.dumps(
        {
            "turnId": turn_id,
            "confirmed": confirmed,
            "question": turn.question,
            "answer": turn.answer,
            "sourcePageIds": list(turn.source_page_ids),
        }
    )


def stored_turns(key: str, entries: list[str]) -> list[StoredTurn]:
    stored: list[StoredTurn] = []
    for raw in entries:
        try:
            stored.append(parse_entry(raw))
        except ValueError, KeyError, TypeError:
            LOGGER.warning("dropping malformed conversation entry", extra={"key": key})
    return stored


class ConversationStore:
    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    def load(self, user_id: str, conversation_id: str) -> list[Turn]:
        key = conversation_key(user_id, conversation_id)
        entries = cast(list[str], self._redis.lrange(key, 0, -1))
        return [stored.turn for stored in stored_turns(key, entries) if stored.confirmed]

    def append(self, user_id: str, conversation_id: str, turn: Turn) -> str:
        key = conversation_key(user_id, conversation_id)
        turn_id = str(uuid.uuid4())

        def replace_pending(pipe: Pipeline) -> None:
            entries = cast(list[str], pipe.lrange(key, 0, -1))
            confirmed = [stored.raw for stored in stored_turns(key, entries) if stored.confirmed]
            pipe.multi()
            pipe.delete(key)
            pipe.rpush(key, *confirmed[-MAX_TURNS:], entry(turn_id, False, turn))
            pipe.expire(key, HISTORY_TTL_SECONDS)

        self._redis.transaction(replace_pending, key)
        return turn_id

    def confirm(self, user_id: str, conversation_id: str, turn_id: str) -> None:
        key = conversation_key(user_id, conversation_id)

        def mark_confirmed(pipe: Pipeline) -> None:
            entries = cast(list[str], pipe.lrange(key, 0, -1))
            for index, stored in enumerate(stored_turns(key, entries)):
                if stored.turn_id == turn_id and not stored.confirmed:
                    pipe.multi()
                    pipe.lset(key, index, entry(turn_id, True, stored.turn))
                    pipe.ltrim(key, -MAX_TURNS, -1)
                    return

        self._redis.transaction(mark_confirmed, key)
