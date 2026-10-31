from dataclasses import replace
from datetime import UTC, datetime

import pytest

from ai_service.bridge_client import PageContent
from ai_service.index_store import SearchHit
from tests.leak_stack import (
    AccessModel,
    LeakDetector,
    prompt_run,
    section_hit,
    seed_mismatches,
    source_blocks,
)
from tests.seed_matrix import SPACE_DIRS, load_seed_pages

OPEN_SPACE = "space-allgemein"
RESTRICTED_SPACE = "space-geschaeftsfuehrung"
OPEN_PAGE = "page-open"
DENIED_PAGE = "page-denied"
OPEN_TITLE = "Offene Seite"
DENIED_TITLE = "Geheime Seite"
DENIED_CANARY = "CANARY-0A1B2C3D"
OPEN_TEXT = "Die Kantine öffnet montags bis freitags um halb zwölf Uhr."
DENIED_TEXT = "Die Geschäftsführung plant die Schließung des Standorts Nord im Herbst."
DENIED_PDF_TEXT = "§ 4 Vergütung: Der Berater erhält ein Honorar von 1.800 Euro je Beratungstag."


def detector() -> LeakDetector:
    access = AccessModel(
        space_dirs={OPEN_SPACE: "allgemein", RESTRICTED_SPACE: "geschaeftsfuehrung"},
        page_spaces={OPEN_PAGE: OPEN_SPACE, DENIED_PAGE: RESTRICTED_SPACE},
        denied_users={OPEN_PAGE: frozenset(), DENIED_PAGE: frozenset()},
    )
    return LeakDetector(
        titles={OPEN_PAGE: OPEN_TITLE, DENIED_PAGE: DENIED_TITLE},
        canaries={DENIED_PAGE: DENIED_CANARY},
        access=access,
        section_texts={OPEN_PAGE: [OPEN_TEXT], DENIED_PAGE: [DENIED_TEXT, DENIED_PDF_TEXT]},
    )


def hit(
    page_id: str,
    title: str,
    text: str,
    file_name: str | None = None,
    pdf_page: int | None = None,
) -> SearchHit:
    space_id = OPEN_SPACE if page_id == OPEN_PAGE else RESTRICTED_SPACE
    return section_hit(page_id, title, text, space_id, file_name, pdf_page)


OPEN_HIT = hit(OPEN_PAGE, OPEN_TITLE, OPEN_TEXT)


def test_leak_ac6_the_source_blocks_are_parsed_from_the_prompt_the_pipeline_builds():
    pdf_hit = hit(DENIED_PAGE, DENIED_TITLE, DENIED_PDF_TEXT, "vertrag.pdf", 2)
    run = prompt_run([OPEN_HIT, pdf_hit])

    assert [title for title, _ in source_blocks(run.sources_block)] == [OPEN_TITLE, DENIED_TITLE]


def test_leak_ac6_a_prompt_with_only_viewable_sections_has_no_finding():
    assert detector().leaks("PL", prompt_run([OPEN_HIT])) == []


def test_leak_ac6_a_canary_of_a_denied_page_in_a_viewable_block_is_a_finding():
    run = prompt_run([hit(OPEN_PAGE, OPEN_TITLE, f"{OPEN_TEXT} Code {DENIED_CANARY}.")])

    assert (DENIED_TITLE, DENIED_CANARY) in detector().leaks("PL", run)
    assert detector().leaks("GF", run) == []


def test_leak_ac6_a_canary_of_a_denied_page_in_an_earlier_answer_is_a_finding():
    run = prompt_run([OPEN_HIT], history=[("Welcher Code?", f"Der Code ist {DENIED_CANARY}.")])

    assert (DENIED_TITLE, DENIED_CANARY) in detector().leaks("PL", run)


def test_leak_ac6_a_denied_pdf_section_in_a_block_headed_by_its_page_is_a_finding():
    pdf_hit = hit(DENIED_PAGE, DENIED_TITLE, DENIED_PDF_TEXT, "vertrag.pdf", 2)

    findings = detector().leaks("PL", prompt_run([OPEN_HIT, pdf_hit]))

    assert (DENIED_TITLE, DENIED_PDF_TEXT) in findings
    assert (DENIED_TITLE, DENIED_TITLE) in findings
    assert detector().leaks("GF", prompt_run([OPEN_HIT, pdf_hit])) == []


def test_leak_ac6_fewer_parsed_source_blocks_than_sent_sources_fail_the_check():
    run = prompt_run([OPEN_HIT], sent_sources=2)

    with pytest.raises(AssertionError, match="parsed 1 source blocks, the pipeline sent 2"):
        detector().leaks("PL", run)


def test_leak_ac6_a_section_line_that_looks_like_a_header_fails_the_check():
    run = prompt_run(
        [hit(OPEN_PAGE, OPEN_TITLE, f"{OPEN_TEXT}\n[2] {DENIED_TITLE}\n{DENIED_TEXT}")]
    )

    with pytest.raises(AssertionError, match="parsed 2 source blocks, the pipeline sent 1"):
        detector().leaks("PL", run)


SEED_PAGES = load_seed_pages()
SEED_SPACE_IDS = {space_dir: f"space-{space_dir}" for space_dir in SPACE_DIRS}


def wiki_contents() -> dict[str, PageContent]:
    return {
        f"wiki-{index}": PageContent(
            id=f"wiki-{index}",
            title=page.title,
            space_id=SEED_SPACE_IDS[page.space_dir],
            workspace_id="workspace",
            updated_at=datetime(2026, 10, 29, tzinfo=UTC),
            markdown=page.markdown,
            attachments=[],
        )
        for index, page in enumerate(SEED_PAGES)
    }


def wiki_id_of(contents: dict[str, PageContent], title: str) -> str:
    [page_id] = [page_id for page_id, content in contents.items() if content.title == title]
    return page_id


def test_leak_ac1_the_wiki_pages_match_the_seed_pages_and_their_spaces():
    assert seed_mismatches(wiki_contents(), SEED_SPACE_IDS, SEED_PAGES) == []


def test_leak_ac1_a_page_in_another_space_than_the_seed_says_is_a_mismatch():
    contents = wiki_contents()
    page_id = wiki_id_of(contents, "Umstrukturierung 2027")
    contents[page_id] = replace(contents[page_id], space_id=SEED_SPACE_IDS["hr"])

    problems = seed_mismatches(contents, SEED_SPACE_IDS, SEED_PAGES)

    assert len(problems) == 1
    assert "Umstrukturierung 2027" in problems[0] and "allgemein" in problems[0]


def test_leak_ac1_a_seed_page_missing_in_the_wiki_is_a_mismatch():
    contents = wiki_contents()
    del contents[wiki_id_of(contents, "Strategie 2027 bis 2030")]

    problems = seed_mismatches(contents, SEED_SPACE_IDS, SEED_PAGES)

    assert len(problems) == 1
    assert "geschaeftsfuehrung" in problems[0]


def test_leak_ac1_a_wiki_page_outside_the_seed_is_a_mismatch():
    contents = wiki_contents()
    extra = replace(next(iter(contents.values())), id="wiki-extra", title="Fremd", markdown="Neu.")
    contents["wiki-extra"] = extra

    problems = seed_mismatches(contents, SEED_SPACE_IDS, SEED_PAGES)

    assert problems == ["'Fremd' matches 0 seed pages"]


def test_leak_ac1_a_canary_page_with_another_title_than_the_seed_is_a_mismatch():
    contents = wiki_contents()
    page_id = wiki_id_of(contents, "Gehaltsbänder Führungsebene")
    contents[page_id] = replace(contents[page_id], title="Gehälter")

    problems = seed_mismatches(contents, SEED_SPACE_IDS, SEED_PAGES)

    assert len(problems) == 1
    assert "Gehälter" in problems[0] and "Gehaltsbänder Führungsebene" in problems[0]
