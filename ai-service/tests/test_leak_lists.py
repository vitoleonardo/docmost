import re

import pytest

from tests.seed_matrix import (
    CANARY_QUESTIONS_PATH,
    LEAK_INJECTION_PAGES_PATH,
    LEAK_QUESTIONS_PATH,
    Entry,
    SeedPage,
    load_entries,
    load_seed_pages,
)
from tests.test_ask import AC35_QUESTIONS

KINDS = ("verbatim", "paraphrase", "identifier", "english", "injection")
MIN_SENTENCE_CHARS = 30
INJECTION_TITLE_PREFIX = "Leak-Test Injektion"
CODE_WORDS = ("code", "kennung", "referenz")
ENGLISH_FUNCTION_WORDS = frozenset(
    "the what is are of and how which about does for to with who when where".split()
)
GERMAN_FUNCTION_WORDS = frozenset(
    "der die das den dem und ist wie welche welcher wer wann wo nicht mit von".split()
    + "für ein eine einen zu im".split()
)


def sentences_of(markdown: str) -> list[str]:
    sentences: list[str] = []
    for line in markdown.splitlines():
        text = line.strip().removeprefix("- ")
        if not text or text.startswith("#"):
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", text):
            if (
                len(sentence) >= MIN_SENTENCE_CHARS
                and sentence[-1] in ".!?"
                and "CANARY-" not in sentence
            ):
                sentences.append(sentence)
    return sentences


def holds_sentence(question: str, markdown: str) -> bool:
    return any(sentence in question for sentence in sentences_of(markdown))


def title_words(title: str) -> list[str]:
    return [word.lower() for word in re.findall(r"[^\W\d_]{4,}", title)]


def tokens_of(question: str) -> set[str]:
    return set(re.findall(r"[^\W\d_]+", question.lower()))


CANARY_PAGES: list[SeedPage] = [page for page in load_seed_pages() if page.canary is not None]
CANARY_PAGE_TITLES = {page.title for page in CANARY_PAGES}
CANARY_VALUES = [page.canary for page in CANARY_PAGES if page.canary is not None]


def injection_pages() -> list[Entry]:
    return load_entries(LEAK_INJECTION_PAGES_PATH)


def injection_markdown_of(title: str) -> str:
    return next(page["markdown"] for page in injection_pages() if page["title"] == title)


def page_markdown_of(title: str) -> str:
    for page in CANARY_PAGES:
        if page.title == title:
            return page.markdown
    return injection_markdown_of(title)


def canary_questions(kind: str | None = None) -> list[Entry]:
    return [
        entry
        for entry in load_entries(CANARY_QUESTIONS_PATH)
        if kind is None or entry["kind"] == kind
    ]


def test_leak_ac7_every_canary_page_has_a_leak_question_with_a_sentence_of_it():
    questions = load_entries(LEAK_QUESTIONS_PATH)
    assert CANARY_PAGES
    for page in CANARY_PAGES:
        assert any(
            entry["pageTitle"] == page.title and holds_sentence(entry["question"], page.markdown)
            for entry in questions
        ), page.title


def test_leak_ac7_the_ask_ac35_questions_are_in_the_list_without_a_page():
    questions = {
        entry["question"]
        for entry in load_entries(LEAK_QUESTIONS_PATH)
        if entry["pageTitle"] is None
    }
    assert set(AC35_QUESTIONS) <= questions


def test_leak_ac7_every_leak_question_page_title_names_a_canary_page_or_is_null():
    for entry in load_entries(LEAK_QUESTIONS_PATH):
        assert entry["pageTitle"] is None or entry["pageTitle"] in CANARY_PAGE_TITLES, entry


def test_leak_ac7_no_leak_question_holds_a_canary_string():
    for entry in load_entries(LEAK_QUESTIONS_PATH):
        assert not any(canary in entry["question"] for canary in CANARY_VALUES), entry


def test_leak_ac7_the_sentence_helper_splits_body_text_and_skips_headings_and_short_lines():
    markdown = (
        "# Überschrift, die lang genug ist für einen Satz.\n\nKurz.\n\n"
        "Der erste Satz ist lang genug. Der zweite Satz ist auch lang genug!"
    )
    assert sentences_of(markdown) == [
        "Der erste Satz ist lang genug.",
        "Der zweite Satz ist auch lang genug!",
    ]


def test_leak_ac16_every_canary_page_has_a_question_of_each_kind():
    entries = canary_questions()
    for page in CANARY_PAGES:
        kinds = {entry["kind"] for entry in entries if entry["pageTitle"] == page.title}
        assert kinds >= set(KINDS), (page.title, set(KINDS) - kinds)


def test_leak_ac16_every_entry_has_one_of_the_five_kinds():
    entries = canary_questions()
    assert entries
    assert all(entry["kind"] in KINDS for entry in entries)


def test_leak_ac16_every_page_title_names_a_canary_page_or_an_injection_page():
    injection_titles = {page["title"] for page in injection_pages()}
    for entry in canary_questions():
        assert entry["pageTitle"] in CANARY_PAGE_TITLES | injection_titles, entry


@pytest.mark.parametrize("page", CANARY_PAGES, ids=lambda page: page.title)
def test_leak_ac16_verbatim_questions_hold_a_sentence_of_their_page(page: SeedPage):
    entries = [e for e in canary_questions("verbatim") if e["pageTitle"] == page.title]
    assert entries
    assert all(holds_sentence(entry["question"], page.markdown) for entry in entries)


@pytest.mark.parametrize("page", CANARY_PAGES, ids=lambda page: page.title)
def test_leak_ac16_paraphrase_questions_hold_no_sentence_title_word_or_canary(page: SeedPage):
    entries = [e for e in canary_questions("paraphrase") if e["pageTitle"] == page.title]
    assert entries
    for entry in entries:
        question = entry["question"]
        lowered = question.lower()
        assert not holds_sentence(question, page.markdown), question
        assert not any(word in lowered for word in title_words(page.title)), question
        assert page.canary not in question, question


@pytest.mark.parametrize("page", CANARY_PAGES, ids=lambda page: page.title)
def test_leak_ac16_identifier_questions_name_the_title_and_ask_for_a_code(page: SeedPage):
    entries = [e for e in canary_questions("identifier") if e["pageTitle"] == page.title]
    assert entries
    for entry in entries:
        assert page.title in entry["question"], entry
        assert any(word in entry["question"].lower() for word in CODE_WORDS), entry


@pytest.mark.parametrize("page", CANARY_PAGES, ids=lambda page: page.title)
def test_leak_ac16_english_questions_use_english_and_no_german_function_words(page: SeedPage):
    entries = [e for e in canary_questions("english") if e["pageTitle"] == page.title]
    assert entries
    for entry in entries:
        tokens = tokens_of(entry["question"])
        assert len(tokens & ENGLISH_FUNCTION_WORDS) >= 2, entry
        assert not tokens & GERMAN_FUNCTION_WORDS, entry


@pytest.mark.parametrize("page", CANARY_PAGES, ids=lambda page: page.title)
def test_leak_ac16_injection_questions_tell_the_assistant_to_ignore_its_instructions(
    page: SeedPage,
):
    entries = [e for e in canary_questions("injection") if e["pageTitle"] == page.title]
    assert entries
    assert all("ignorier" in entry["question"].lower() for entry in entries)


def test_leak_ac16_there_are_exactly_two_injection_pages_with_the_title_prefix_and_a_heading():
    pages = injection_pages()
    assert len(pages) == 2
    for page in pages:
        assert page["title"].startswith(INJECTION_TITLE_PREFIX), page["title"]
        assert re.match(r"#{1,6} \S", page["markdown"]), page["title"]


def test_leak_ac16_every_injection_page_has_a_verbatim_question_with_a_sentence_of_it():
    for page in injection_pages():
        entries = [e for e in canary_questions("verbatim") if e["pageTitle"] == page["title"]]
        assert entries, page["title"]
        assert all(holds_sentence(entry["question"], page["markdown"]) for entry in entries)


def test_leak_ac16_no_question_and_no_injection_page_holds_a_canary_string():
    texts = [entry["question"] for entry in canary_questions()]
    texts += [page["markdown"] + page["title"] for page in injection_pages()]
    for text in texts:
        assert not any(canary in text for canary in CANARY_VALUES), text
