import pytest

from ai_service.sections import (
    MAX_PDF_BYTES,
    MAX_PDF_PAGES,
    MAX_SECTION_CHARS,
    PdfSkipped,
    Section,
    markdown_sections,
    pdf_sections,
)
from tests.pdf_fixtures import build_blank_pdf, build_pdf


def test_index_ac5_paragraph_below_two_headings_has_both_in_its_path():
    sections = markdown_sections("# A\n\n## B\n\nBody text.")
    assert sections == [Section(("A", "B"), "Body text.")]


def test_index_ac6_heading_of_the_same_level_replaces_its_sibling_in_the_path():
    markdown = "# A\n\n## B\n\nFirst.\n\n## C\n\nSecond."
    sections = markdown_sections(markdown)
    assert [s.heading_path for s in sections] == [("A", "B"), ("A", "C")]
    assert sections[1].text == "Second."


def test_index_ac7_skipped_level_keeps_the_path_without_a_gap():
    sections = markdown_sections("# A\n\n### D\n\nDeep text.")
    assert sections == [Section(("A", "D"), "Deep text.")]


def test_index_ac7_a_shallower_heading_pops_deeper_entries():
    markdown = "# A\n\n### D\n\nDeep.\n\n## E\n\nMiddle.\n\n# F\n\nTop."
    paths = [s.heading_path for s in markdown_sections(markdown)]
    assert paths == [("A", "D"), ("A", "E"), ("F",)]


def test_index_ac8_text_before_the_first_heading_has_an_empty_path():
    sections = markdown_sections("Intro paragraph.\n\n# A\n\nBody.")
    assert sections == [Section((), "Intro paragraph."), Section(("A",), "Body.")]


def test_index_ac9_long_section_is_split_with_all_words_in_order():
    words = [f"w{i}" for i in range(900)]
    paragraphs = [" ".join(words[i : i + 100]) + "." for i in range(0, 900, 100)]
    original = "\n\n".join(paragraphs)
    assert len(original) >= 4000
    sections = markdown_sections(f"# A\n\n## B\n\n{original}")
    assert len(sections) > 1
    assert all(len(s.text) <= MAX_SECTION_CHARS for s in sections)
    assert {s.heading_path for s in sections} == {("A", "B")}
    assert " ".join(s.text for s in sections).split() == original.split()


def test_index_ac9_single_paragraph_without_breaks_is_split_at_sentences_then_words():
    sentences = ". ".join(f"Sentence number {i} has some words" for i in range(150)) + "."
    sections = markdown_sections(sentences)
    assert all(len(s.text) <= MAX_SECTION_CHARS for s in sections)
    assert " ".join(s.text for s in sections).split() == sentences.split()
    assert all(s.text.endswith(".") for s in sections)

    words = " ".join(f"word{i}" for i in range(1000))
    pieces = markdown_sections(words)
    assert all(len(s.text) <= MAX_SECTION_CHARS for s in pieces)
    assert " ".join(s.text for s in pieces).split() == words.split()


def test_index_ac9_word_longer_than_the_limit_is_cut_hard():
    sections = markdown_sections("x" * 3200)
    assert [len(s.text) for s in sections] == [1500, 1500, 200]


def test_index_ac9_text_of_exactly_the_limit_stays_one_section():
    assert len(markdown_sections("y" * MAX_SECTION_CHARS)) == 1


def test_index_ac5_heading_without_text_gives_no_section():
    sections = markdown_sections("# A\n\n## B\n\n## C\n\nText.")
    assert sections == [Section(("A", "C"), "Text.")]


def test_index_ac62_empty_whitespace_and_headings_only_bodies_have_no_sections():
    assert markdown_sections("") == []
    assert markdown_sections("  \n\n \t\n") == []
    assert markdown_sections("# A\n\n## B\n\n### C") == []


def test_index_ac5_hash_lines_inside_a_code_fence_are_not_headings():
    markdown = "# A\n\n```\n# not a heading\ncode\n```\n\nAfter."
    sections = markdown_sections(markdown)
    assert len(sections) == 1
    assert sections[0].heading_path == ("A",)
    assert "# not a heading" in sections[0].text
    assert "After." in sections[0].text


def test_index_ac5_heading_markers_and_closing_hashes_are_stripped():
    sections = markdown_sections("## Title ##\n\nText with C# inside.")
    assert sections == [Section(("Title",), "Text with C# inside.")]


def test_index_ac10_each_text_page_gives_a_section_with_its_number():
    sections = pdf_sections(build_pdf(["Alpha page", "Beta page", "Gamma page"]))
    assert [(s.pdf_page, s.text) for s in sections] == [
        (1, "Alpha page"),
        (2, "Beta page"),
        (3, "Gamma page"),
    ]


def test_index_ac11_page_without_text_is_left_out():
    sections = pdf_sections(build_pdf(["First", "", "Third"]))
    assert [s.pdf_page for s in sections] == [1, 3]


def test_index_ac9_long_pdf_page_is_split_within_the_same_page_number():
    text = " ".join(f"word{i}" for i in range(600))
    sections = pdf_sections(build_pdf([text, "Short"]))
    first_page = [s for s in sections if s.pdf_page == 1]
    assert len(first_page) > 1
    assert all(len(s.text) <= MAX_SECTION_CHARS for s in sections)
    assert " ".join(s.text for s in first_page).split() == text.split()
    assert [s.pdf_page for s in sections][-1] == 2


def test_index_ac63_pdf_without_a_text_layer_is_skipped():
    with pytest.raises(PdfSkipped) as skipped:
        pdf_sections(build_blank_pdf(2))
    assert skipped.value.reason == "no text layer"


def test_index_ac66_pdf_with_301_pages_is_skipped_for_the_page_limit():
    with pytest.raises(PdfSkipped) as skipped:
        pdf_sections(build_pdf(["text"] * (MAX_PDF_PAGES + 1)))
    assert "more than 300 pages" in skipped.value.reason


def test_index_ac67_pdf_with_exactly_300_pages_is_indexed():
    sections = pdf_sections(build_pdf(["text"] * MAX_PDF_PAGES))
    assert len(sections) == 300
    assert sections[-1].pdf_page == 300


def test_index_ac68_bytes_that_are_not_a_pdf_are_skipped_as_unreadable():
    with pytest.raises(PdfSkipped) as skipped:
        pdf_sections(b"this is not a pdf at all")
    assert skipped.value.reason == "unreadable PDF"


def test_index_ac68_truncated_pdf_is_skipped_as_unreadable():
    with pytest.raises(PdfSkipped) as skipped:
        pdf_sections(build_pdf(["Alpha"])[:60])
    assert skipped.value.reason == "unreadable PDF"


def test_index_ac64_limits_are_the_specified_numbers():
    assert MAX_PDF_BYTES == 20_971_520
    assert MAX_PDF_PAGES == 300
    assert MAX_SECTION_CHARS == 1500
