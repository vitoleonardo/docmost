from datetime import UTC, datetime

import pytest

from ai_service.bridge_client import AttachmentInfo, ListedPage, PageContent, PageListPart
from ai_service.eval_index_ready import check, missing_from_index
from ai_service.index_store import StoredSection

NOW = datetime(2026, 10, 30, tzinfo=UTC)
TEXT_PDF = "vertrag-a.pdf"
SCANNED_PDF = "scan-b.pdf"
TEXT_LAYER_FILES = {TEXT_PDF}


class FakeBridge:
    def __init__(self, contents: dict[str, PageContent]) -> None:
        self.contents = contents

    def list_pages(self, cursor: str | None) -> PageListPart:
        return PageListPart([ListedPage(id, "s", NOW) for id in self.contents], None)

    def page_content(self, page_id: str) -> PageContent:
        return self.contents[page_id]


def content(page_id: str, title: str, markdown: str, files: dict[str, str] | None = None):
    attachments = [
        AttachmentInfo(attachment_id, name, "application/pdf", 1)
        for name, attachment_id in (files or {}).items()
    ]
    return PageContent(page_id, title, "s", "w", NOW, markdown, attachments)


def section(attachment_id: str | None = None) -> StoredSection:
    return StoredSection(0, [], "text", [0.0], attachment_id=attachment_id)


def run(contents: dict[str, PageContent], sections: dict[str, list[StoredSection]]):
    pages = [ListedPage(page_id, "s", NOW) for page_id in contents]
    return missing_from_index(
        pages, contents, lambda page_id: sections.get(page_id, []), TEXT_LAYER_FILES
    )


def test_eval_ac64_a_page_with_body_text_and_no_section_is_named():
    contents = {"p1": content("p1", "Urlaub", "# Urlaub\n\nTage pro Jahr")}
    assert run(contents, {}) == ["Not searchable: Urlaub"]


def test_eval_ac64_a_text_layer_pdf_without_sections_is_named_with_its_page():
    contents = {"p1": content("p1", "Verträge", "# Verträge", {TEXT_PDF: "a1"})}
    assert run(contents, {"p1": [section("other")]}) == [f"Not searchable: {TEXT_PDF} on Verträge"]


def test_eval_ac64_the_scanned_pdf_is_not_required():
    contents = {"p1": content("p1", "Verträge", "# Verträge", {SCANNED_PDF: "a2"})}
    assert run(contents, {}) == []


def test_eval_ac64_a_heading_only_page_is_not_required():
    contents = {"p1": content("p1", "Übersicht", "# Übersicht\n\n## Unterpunkt\n  \n")}
    assert run(contents, {}) == []


def test_eval_ac64_a_complete_index_gives_no_missing_entry_and_exit_0(
    capsys: pytest.CaptureFixture[str],
):
    contents = {"p1": content("p1", "Verträge", "Text", {TEXT_PDF: "a1"})}
    sections = {"p1": [section(), section("a1")]}
    assert run(contents, sections) == []
    status = check(FakeBridge(contents), lambda page_id: sections[page_id], TEXT_LAYER_FILES)
    assert status == 0
    assert capsys.readouterr().out == "Index ready: 1 pages, 1 PDFs\n"


@pytest.mark.parametrize("sections", [{}, {"p1": [section()]}])
def test_eval_ac64_any_missing_entry_gives_exit_2_and_names_it(
    capsys: pytest.CaptureFixture[str], sections: dict[str, list[StoredSection]]
):
    contents = {"p1": content("p1", "Verträge", "Text", {TEXT_PDF: "a1"})}
    status = check(
        FakeBridge(contents), lambda page_id: sections.get(page_id, []), TEXT_LAYER_FILES
    )
    assert status == 2
    assert "Not searchable: " in capsys.readouterr().out
