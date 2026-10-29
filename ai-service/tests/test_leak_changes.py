import uuid
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager

import pytest

from tests.leak_stack import (
    SPACE_NAMES,
    LeakRun,
    LeakStack,
    WikiSnapshot,
    leak_stack,
    moved_with_stale_index,
    removed_from_group,
    removed_from_space,
    trashed_with_stale_index,
)
from tests.seed_matrix import SEED_USERS, SPACE_MEMBERS
from tests.test_stack import PAGE_SENTENCE

__all__ = ["leak_stack"]

pytestmark = [pytest.mark.integration, pytest.mark.leak]

ONBOARDING_TITLE = "Onboarding neuer Mitarbeitender"
ONBOARDING_SENTENCE = PAGE_SENTENCE
OVERVIEW_TITLE = "Projektübersicht 2026"
OVERVIEW_SENTENCE = (
    "Das größte Vorhaben des Jahres: Neubau einer Kläranlage für 80.000 Einwohnerwerte."
)
OFFICE_HOURS_TITLE = "Bürozeiten und Erreichbarkeit"
OFFICE_HOURS_SENTENCE = (
    "Das Büro in Beispielstadt ist montags bis freitags von 7:30 Uhr bis 17:00 Uhr besetzt."
)
WELCOME_TITLE = "Willkommen bei Ostmooimooi"
WELCOME_SENTENCE = (
    "Das Unternehmen wurde 1998 gegründet und beschäftigt heute rund 60 Personen."
    " Geschäftsführer ist Jörg Ostmoor. Der Firmensitz liegt in Beispielstadt, Musterstraße 12."
)
PROJECT_TEAM = "Projektteam"
NON_OWNERS = ("PL", "VT", "WS")

Change = Callable[[LeakStack], AbstractContextManager[None]]
CHANGES: dict[str, Change] = {
    "removed_from_space": lambda stack: removed_from_space(stack, "PL", "hr"),
    "removed_from_group": lambda stack: removed_from_group(stack, "WS", PROJECT_TEAM, "projekte"),
    "moved_with_stale_index": lambda stack: moved_with_stale_index(
        stack, stack.page_titled(OFFICE_HOURS_TITLE), "geschaeftsfuehrung"
    ),
    "trashed_with_stale_index": lambda stack: trashed_with_stale_index(
        stack, stack.page_titled(WELCOME_TITLE)
    ),
}


class InjectedFailure(Exception):
    pass


@pytest.fixture(scope="module")
def start_snapshot(leak_stack: LeakStack) -> WikiSnapshot:
    snapshot = leak_stack.snapshot()
    assert sorted(snapshot.spaces.values()) == sorted(SPACE_NAMES.values())
    for user in SEED_USERS:
        assert snapshot.member_spaces(leak_stack.user_ids[user]) == {
            SPACE_NAMES[space_dir] for space_dir in SPACE_MEMBERS[user]
        }, user
    assert snapshot.index_problems() == []
    return snapshot


@pytest.fixture(autouse=True)
def seed_state_restored(leak_stack: LeakStack, start_snapshot: WikiSnapshot) -> Iterator[None]:
    yield
    assert leak_stack.snapshot() == start_snapshot


def answer_text(run: LeakRun) -> str:
    return "".join(event["text"] for event in run.events if event["type"] == "delta")


def confirmed_turn(run: LeakRun) -> bool:
    return any(event["type"] == "citations" for event in run.events)


def assistant_messages(run: LeakRun) -> list[str]:
    if not run.model.calls:
        return []
    return [message["content"] for message in run.model.calls[-1] if message["role"] == "assistant"]


def test_leak_ac11_a_removed_member_gets_no_hr_section_and_no_earlier_answer_in_the_prompt(
    leak_stack: LeakStack,
):
    onboarding = leak_stack.page_titled(ONBOARDING_TITLE)
    hr_pages = leak_stack.access.pages_in("hr")
    conversation_id = str(uuid.uuid4())

    answered = leak_stack.ask("PL", ONBOARDING_SENTENCE, conversation_id=conversation_id)
    earlier_answer = answer_text(answered)

    assert leak_stack.sections_in_prompt(answered, onboarding) != []
    assert confirmed_turn(answered)
    assert earlier_answer != ""

    with removed_from_space(leak_stack, "PL", "hr"):
        run = leak_stack.ask("PL", ONBOARDING_SENTENCE, conversation_id=conversation_id)

        assert run.model.calls != []
        assert leak_stack.leaks("PL", run) == []
        assert run.passing_page_ids & hr_pages == set()
        assert [text for text in assistant_messages(run) if earlier_answer in text] == []


def test_leak_ac12_a_user_removed_from_projektteam_gets_no_projekte_section_in_the_prompt(
    leak_stack: LeakStack,
):
    overview = leak_stack.page_titled(OVERVIEW_TITLE)
    projekte_pages = leak_stack.access.pages_in("projekte")

    before = leak_stack.ask("WS", OVERVIEW_SENTENCE)

    assert leak_stack.sections_in_prompt(before, overview) != []

    with removed_from_group(leak_stack, "WS", PROJECT_TEAM, "projekte"):
        run = leak_stack.ask("WS", OVERVIEW_SENTENCE)

        assert leak_stack.leaks("WS", run) == []
        assert run.passing_page_ids & projekte_pages == set()
        assert leak_stack.sections_in_prompt(run, overview) == []


Findings = dict[str, list[object]]


def findings_for(stack: LeakStack, users: tuple[str, ...], page_id: str, question: str) -> Findings:
    findings: Findings = {}
    for user in users:
        run = stack.ask(user, question)
        found = [
            *stack.leaks(user, run),
            *stack.sections_in_prompt(run, page_id),
            *({page_id} & run.passing_page_ids),
        ]
        if found:
            findings[user] = found
    return findings


def test_leak_ac13_a_page_moved_away_with_a_stale_index_gives_no_section_in_the_prompt(
    leak_stack: LeakStack,
):
    office_hours = leak_stack.page_titled(OFFICE_HOURS_TITLE)

    before = {user: leak_stack.ask(user, OFFICE_HOURS_SENTENCE) for user in NON_OWNERS}

    assert [
        user for user, run in before.items() if not leak_stack.sections_in_prompt(run, office_hours)
    ] == []

    with moved_with_stale_index(leak_stack, office_hours, "geschaeftsfuehrung"):
        entry = leak_stack.store.get_entry(office_hours)
        assert entry is not None and entry.space_id == leak_stack.space_ids["allgemein"]

        assert findings_for(leak_stack, NON_OWNERS, office_hours, OFFICE_HOURS_SENTENCE) == {}


def test_leak_ac14_a_trashed_page_still_in_the_index_gives_no_section_in_the_prompt(
    leak_stack: LeakStack,
):
    welcome = leak_stack.page_titled(WELCOME_TITLE)

    before = {user: leak_stack.ask(user, WELCOME_SENTENCE) for user in SEED_USERS}

    assert [
        user for user, run in before.items() if not leak_stack.sections_in_prompt(run, welcome)
    ] == []

    with trashed_with_stale_index(leak_stack, welcome):
        assert leak_stack.store.get_entry(welcome) is not None

        assert findings_for(leak_stack, SEED_USERS, welcome, WELCOME_SENTENCE) == {}


@pytest.mark.parametrize("change", CHANGES)
def test_leak_ac29_a_failure_after_a_change_still_restores_the_seed_state(
    leak_stack: LeakStack, start_snapshot: WikiSnapshot, change: str
):
    with pytest.raises(InjectedFailure), CHANGES[change](leak_stack):
        assert leak_stack.snapshot() != start_snapshot
        raise InjectedFailure

    assert leak_stack.snapshot() == start_snapshot


def test_leak_ac15_after_all_changes_the_wiki_and_the_index_match_the_start(
    leak_stack: LeakStack, start_snapshot: WikiSnapshot
):
    final = leak_stack.snapshot()

    assert final == start_snapshot
    assert final.index_problems() == []
    assert leak_stack.access.members == {user: set(SPACE_MEMBERS[user]) for user in SEED_USERS}
    assert leak_stack.access.trashed == set()
    assert {
        page_id: state.space_id for page_id, state in final.pages.items()
    } == leak_stack.access.page_spaces
