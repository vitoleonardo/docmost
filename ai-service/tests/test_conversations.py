import json
import logging
import time
import uuid

import pytest
from redis import Redis

from ai_service.conversations import (
    HISTORY_TTL_SECONDS,
    MAX_TURNS,
    ConversationStore,
    Turn,
)
from tests.conftest import warnings

USER_A = "0192f000-0000-7000-8000-00000000000a"
USER_B = "0192f000-0000-7000-8000-00000000000b"
CONVERSATION = "0192f000-0000-7000-8000-0000000000c1"


def key(user_id: str = USER_A, conversation_id: str = CONVERSATION) -> str:
    return f"ai-service:conversation:{user_id}:{conversation_id}"


def turn(n: int) -> Turn:
    return Turn(question=f"q{n}", answer=f"a{n}", source_page_ids=[f"page-{n}"])


def remember(
    store: ConversationStore, n: int, user_id: str = USER_A, conversation_id: str = CONVERSATION
) -> None:
    store.confirm(user_id, conversation_id, store.append(user_id, conversation_id, turn(n)))


def test_ask_ac53_round_trip_keeps_order(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    remember(store, 1)
    remember(store, 2)

    assert store.load(USER_A, CONVERSATION) == [turn(1), turn(2)]


def test_ask_ac56_an_appended_turn_is_pending_until_confirmed(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    turn_id = store.append(USER_A, CONVERSATION, turn(1))

    assert uuid.UUID(turn_id)
    assert store.load(USER_A, CONVERSATION) == []

    store.confirm(USER_A, CONVERSATION, turn_id)

    assert store.load(USER_A, CONVERSATION) == [turn(1)]


def test_ask_ac56_a_pending_turn_is_dropped_by_the_next_append(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    remember(store, 1)
    withdrawn = store.append(USER_A, CONVERSATION, turn(2))
    remember(store, 3)

    store.confirm(USER_A, CONVERSATION, withdrawn)

    assert store.load(USER_A, CONVERSATION) == [turn(1), turn(3)]
    assert redis_client.llen(key()) == 2


def test_ask_ac56_confirming_an_unknown_turn_changes_nothing(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    pending = store.append(USER_A, CONVERSATION, turn(1))

    store.confirm(USER_A, CONVERSATION, str(uuid.uuid4()))
    store.confirm(USER_A, str(uuid.uuid4()), pending)

    assert store.load(USER_A, CONVERSATION) == []
    assert redis_client.keys("*") == [key()]


def test_ask_ac54_another_user_cannot_confirm_a_turn(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    pending = store.append(USER_A, CONVERSATION, turn(1))

    store.confirm(USER_B, CONVERSATION, pending)

    assert store.load(USER_A, CONVERSATION) == []
    assert store.load(USER_B, CONVERSATION) == []
    assert redis_client.keys("*") == [key()]


def test_ask_ac53_confirm_keeps_the_remaining_ttl(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    pending = store.append(USER_A, CONVERSATION, turn(1))
    redis_client.expire(key(), 100)

    store.confirm(USER_A, CONVERSATION, pending)

    assert 0 < redis_client.ttl(key()) <= 100


def test_ask_ac53_load_of_unknown_conversation_is_empty(redis_client: Redis) -> None:
    assert ConversationStore(redis_client).load(USER_A, CONVERSATION) == []


def test_ask_ac53_append_sets_and_resets_ttl(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    store.append(USER_A, CONVERSATION, turn(1))
    assert redis_client.ttl(key()) == HISTORY_TTL_SECONDS == 86400

    redis_client.expire(key(), 100)
    store.append(USER_A, CONVERSATION, turn(2))
    assert redis_client.ttl(key()) == HISTORY_TTL_SECONDS


def test_ask_ac53_touch_resets_the_ttl_without_creating_the_conversation(
    redis_client: Redis,
) -> None:
    store = ConversationStore(redis_client)
    store.touch(USER_A, CONVERSATION)
    assert redis_client.exists(key()) == 0

    remember(store, 1)
    redis_client.expire(key(), 100)
    store.touch(USER_A, CONVERSATION)
    assert redis_client.ttl(key()) == HISTORY_TTL_SECONDS


def test_ask_ac53_expired_conversation_loads_empty(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    remember(store, 1)
    redis_client.pexpire(key(), 1)
    time.sleep(0.02)

    assert store.load(USER_A, CONVERSATION) == []


def test_ask_ac54_other_user_sees_nothing_and_cannot_change_turns(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    remember(store, 1)

    assert store.load(USER_B, CONVERSATION) == []
    remember(store, 2, user_id=USER_B)

    assert store.load(USER_A, CONVERSATION) == [turn(1)]
    assert store.load(USER_B, CONVERSATION) == [turn(2)]


def test_ask_ac54_keeps_only_the_last_turns(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    for n in range(1, 7):
        remember(store, n)

    assert MAX_TURNS == 5
    assert store.load(USER_A, CONVERSATION) == [turn(n) for n in range(2, 7)]
    assert redis_client.llen(key()) == MAX_TURNS


def test_ask_ac56_pending_turns_do_not_push_confirmed_turns_out(redis_client: Redis) -> None:
    store = ConversationStore(redis_client)
    for n in range(1, 6):
        remember(store, n)
    for n in range(6, 9):
        store.append(USER_A, CONVERSATION, turn(n))

    assert store.load(USER_A, CONVERSATION) == [turn(n) for n in range(1, 6)]
    assert redis_client.llen(key()) == MAX_TURNS + 1


@pytest.mark.parametrize(
    ("user_id", "conversation_id"),
    [
        ("", CONVERSATION),
        (USER_A, ""),
        (f"{USER_A}:x", CONVERSATION),
        (USER_A, f"{CONVERSATION}:{USER_B}"),
        (f"{USER_A}:{CONVERSATION}", "other"),
    ],
)
def test_ask_ac54_rejects_ids_that_could_address_another_key(
    redis_client: Redis, user_id: str, conversation_id: str
) -> None:
    store = ConversationStore(redis_client)

    with pytest.raises(ValueError):
        store.load(user_id, conversation_id)
    with pytest.raises(ValueError):
        store.append(user_id, conversation_id, turn(1))
    with pytest.raises(ValueError):
        store.confirm(user_id, conversation_id, str(uuid.uuid4()))
    assert redis_client.keys("*") == []


def test_ask_ac53_malformed_entry_is_dropped_with_a_warning(
    redis_client: Redis, caplog: pytest.LogCaptureFixture
) -> None:
    store = ConversationStore(redis_client)
    remember(store, 1)
    redis_client.rpush(key(), "not json", json.dumps({"question": "q", "confirmed": True}))

    with caplog.at_level(logging.WARNING, logger="ai_service.conversations"):
        loaded = store.load(USER_A, CONVERSATION)

    assert loaded == [turn(1)]
    assert len(warnings(caplog)) == 2
