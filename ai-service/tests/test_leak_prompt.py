import os

import pytest

from tests.hashing_embedder import HashingEmbedder
from tests.leak_stack import (
    EMBEDDING_MODEL_VARIABLE,
    EVERY_CANDIDATE_THRESHOLD,
    PASSED_THE_FILTER,
    LeakRun,
    LeakStack,
    leak_questions,
    leak_stack,
)
from tests.seed_matrix import SEED_USERS, load_seed_pages
from tests.test_stack_ask import MIN_SECTION_LENGTH, THRESHOLD, allow_every_page

__all__ = ["leak_stack"]

pytestmark = [pytest.mark.integration, pytest.mark.leak]

QUESTIONS = leak_questions()
DENIED_USERS = ("PL", "VT", "WS")
EXPECTED_DENIED_CANDIDATES = {
    "PL": {"Umstrukturierung 2027"},
    "VT": {
        "Umstrukturierung 2027",
        "Angebot Kalkulation Kläranlage Nordhafen",
        "Baustelle Nordhafen intern",
        "Baustelle Nordhafen Zugangscodes",
    },
    "WS": {"Umstrukturierung 2027", "Angebot Kalkulation Kläranlage Nordhafen"},
}

AskedRuns = dict[str, list[tuple[str, LeakRun]]]
Leak = tuple[str, str, str]


@pytest.fixture(scope="module")
def alle_bereiche_runs(leak_stack: LeakStack) -> AskedRuns:
    return {
        user: [(question, leak_stack.ask(user, question)) for question in QUESTIONS]
        for user in SEED_USERS
    }


def leaks_in(stack: LeakStack, user: str, runs: list[tuple[str, LeakRun]]) -> list[Leak]:
    return [
        (question, title, text) for question, run in runs for title, text in stack.leaks(user, run)
    ]


def prompts_in(runs: list[tuple[str, LeakRun]]) -> int:
    return sum(1 for _, run in runs if run.model.calls)


def test_leak_ac1_the_expected_access_follows_the_seed_space_and_page_matrices(
    leak_stack: LeakStack,
):
    seed_pages = load_seed_pages()
    access = leak_stack.access

    assert len(access.viewable_pages("GF")) == len(leak_stack.titles)
    for user in SEED_USERS:
        expected = sum(1 for page in seed_pages if page.viewable_by(user))
        assert len(access.viewable_pages(user)) == expected, user
    for page in seed_pages:
        if page.canary is None:
            continue
        page_id = leak_stack.page_titled(page.title)
        assert {user for user in SEED_USERS if access.may_view(user, page_id)} == {
            user for user in SEED_USERS if page.viewable_by(user)
        }, page.title


def denied_sections_shared_with_viewable_pages(stack: LeakStack, user: str) -> list[str]:
    viewable = stack.access.viewable_pages(user)
    return [
        f"{stack.titles[denied_id]} in {stack.titles[viewable_id]}: {text[:80]}"
        for denied_id, texts in stack.section_texts.items()
        if not stack.access.may_view(user, denied_id)
        for text in texts
        if len(text) >= MIN_SECTION_LENGTH
        for viewable_id in viewable
        if any(text in viewable_text for viewable_text in stack.section_texts[viewable_id])
    ]


@pytest.mark.parametrize("user", SEED_USERS)
def test_leak_ac31_no_indexed_section_of_a_denied_page_occurs_in_a_viewable_page(
    leak_stack: LeakStack, user: str
):
    assert denied_sections_shared_with_viewable_pages(leak_stack, user) == []


@pytest.mark.parametrize("user", SEED_USERS)
def test_leak_ac1_no_prompt_holds_a_denied_section_with_the_scope_alle_bereiche(
    leak_stack: LeakStack, alle_bereiche_runs: AskedRuns, user: str
):
    runs = alle_bereiche_runs[user]

    assert prompts_in(runs) > 0
    assert leaks_in(leak_stack, user, runs) == []


@pytest.mark.parametrize("user", SEED_USERS)
def test_leak_ac1_every_hashing_run_reaches_the_filter_and_a_passing_run_the_model(
    leak_stack: LeakStack, alle_bereiche_runs: AskedRuns, user: str
):
    if not isinstance(leak_stack.embedder, HashingEmbedder):
        assert leak_stack.threshold == THRESHOLD
        return
    runs = alle_bereiche_runs[user]

    assert leak_stack.threshold == EVERY_CANDIDATE_THRESHOLD

    assert [question for question, run in runs if not run.filter_calls] == []
    assert [
        question for question, run in runs if run.passing_page_ids and not run.model.calls
    ] == []


@pytest.mark.parametrize("user", SEED_USERS)
def test_leak_ac2_no_prompt_holds_a_denied_section_with_a_member_space_as_scope(
    leak_stack: LeakStack, user: str
):
    space_ids = leak_stack.access.member_space_ids(user)
    runs = [
        (question, leak_stack.ask(user, question, space_id=space_id))
        for space_id in space_ids
        for question in QUESTIONS
    ]

    assert len(space_ids) == len(leak_stack.token_space_ids(user))
    assert prompts_in(runs) > 0
    assert leaks_in(leak_stack, user, runs) == []


@pytest.mark.parametrize("user", SEED_USERS)
def test_leak_ac3_no_prompt_holds_a_denied_section_with_the_scope_diese_seite(
    leak_stack: LeakStack, user: str
):
    page_ids = leak_stack.access.viewable_pages(user)
    runs = [
        (question, leak_stack.ask(user, question, page_id=page_id))
        for page_id in page_ids
        for question in QUESTIONS
    ]

    assert prompts_in(runs) > 0
    assert leaks_in(leak_stack, user, runs) == []


@pytest.mark.parametrize("user", SEED_USERS)
def test_leak_ac4_no_prompt_holds_a_denied_section_when_every_section_is_a_top_candidate(
    leak_stack: LeakStack, user: str
):
    search = leak_stack.every_section_search(user)
    runs = [(question, leak_stack.ask(user, question, search=search)) for question in QUESTIONS]

    assert prompts_in(runs) == len(QUESTIONS)
    assert leaks_in(leak_stack, user, runs) == []


@pytest.mark.parametrize("user", DENIED_USERS)
def test_leak_ac5_the_denied_pages_reach_the_candidates_of_the_index_search(
    leak_stack: LeakStack, alle_bereiche_runs: AskedRuns, user: str
):
    denied_candidates = {
        leak_stack.titles[hit.page_id]
        for _, run in alle_bereiche_runs[user]
        for hit in run.candidates
        if not leak_stack.access.may_view(user, hit.page_id)
    }

    assert denied_candidates >= EXPECTED_DENIED_CANDIDATES[user]


@pytest.mark.parametrize("user", DENIED_USERS)
def test_leak_ac6_a_filter_that_lets_every_page_through_is_reported_as_a_leak(
    leak_stack: LeakStack, user: str
):
    search = leak_stack.every_section_search(user)

    for question in QUESTIONS:
        run = leak_stack.ask(user, question, search=search, filter_pages=allow_every_page)
        findings = leak_stack.leaks(user, run)
        assert findings != [], question
        assert [text for _, text in findings if text != PASSED_THE_FILTER] != [], question


def test_leak_ac10_the_index_uses_the_configured_embedding_model(leak_stack: LeakStack):
    expected = os.environ.get(EMBEDDING_MODEL_VARIABLE) or "test-hashing"

    assert leak_stack.embedder.model_name == expected
    assert {entry.embedding_model for entry in leak_stack.store.list_entries()} == {expected}
