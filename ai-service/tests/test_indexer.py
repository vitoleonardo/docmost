import json
import logging
from dataclasses import dataclass, field
from datetime import datetime

import httpx
import pytest

from ai_service.bridge_client import (
    ATTACHMENT_PATH,
    PAGE_CONTENT_PATH,
    BridgeUnavailable,
)
from ai_service.index_store import IndexStore
from ai_service.indexer import Indexer, IndexOutcome, search_text
from ai_service.search import search_index
from ai_service.sections import MAX_PDF_BYTES
from tests.conftest import warnings
from tests.fake_bridge import TOKEN, mock_client
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import (
    SPACE_A,
    UPDATED_AT,
    WORKSPACE_A,
    attachment_id,
    later,
    page_id,
)
from tests.pdf_fixtures import build_blank_pdf, build_pdf

pytestmark = pytest.mark.integration


@dataclass
class FakeWiki:
    title: str = "Urlaubsregeln"
    markdown: str = ""
    updated_at: datetime = UPDATED_AT
    attachments: list[dict[str, object]] = field(default_factory=list)
    files: dict[str, bytes] = field(default_factory=dict)
    missing_page: bool = False
    missing_files: set[str] = field(default_factory=set)
    attachment_requests: list[str] = field(default_factory=list)

    def add_pdf(self, number: int, pdf: bytes, file_size: int | None = None) -> str:
        identifier = attachment_id(number)
        self.attachments.append(
            {
                "id": identifier,
                "fileName": f"datei-{number}.pdf",
                "mimeType": "application/pdf",
                "fileSize": len(pdf) if file_size is None else file_size,
            }
        )
        self.files[identifier] = pdf
        return identifier

    def remove_pdf(self, identifier: str) -> None:
        self.attachments = [item for item in self.attachments if item["id"] != identifier]

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Service-Token"] == TOKEN
        body = json.loads(request.content)
        if request.url.path == PAGE_CONTENT_PATH:
            if self.missing_page:
                return httpx.Response(404, json={"code": "page_not_found", "message": "gone"})
            return httpx.Response(
                200,
                json={
                    "id": body["pageId"],
                    "title": self.title,
                    "spaceId": SPACE_A,
                    "workspaceId": WORKSPACE_A,
                    "updatedAt": self.updated_at.isoformat(),
                    "markdown": self.markdown,
                    "attachments": self.attachments,
                },
            )
        assert request.url.path == ATTACHMENT_PATH
        self.attachment_requests.append(body["attachmentId"])
        if body["attachmentId"] in self.missing_files:
            return httpx.Response(404, json={"code": "attachment_not_found", "message": "gone"})
        return httpx.Response(200, content=self.files[body["attachmentId"]])


@pytest.fixture
def wiki() -> FakeWiki:
    return FakeWiki()


@pytest.fixture
def indexer(wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder) -> Indexer:
    return Indexer(mock_client(wiki.handle), store, embedder)


def top_page_ids(
    store: IndexStore, embedder: HashingEmbedder, question: str, limit: int = 5
) -> list[str]:
    return [hit.page_id for hit in search_index(store, embedder, question, [SPACE_A], limit)]


def all_text(store: IndexStore, number: int = 1) -> list[str]:
    return [section.text for section in store.sections_of(page_id(number))]


def test_index_ac21_a_new_page_is_listed_and_found_in_the_first_5_results(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    wiki.markdown = (
        "# Regeln\n\nDie Kantine öffnet um acht Uhr morgens."
        "\n\n# Urlaub\n\nUrlaub wird früh beantragt."
    )
    assert indexer.index_page(page_id(1)) == IndexOutcome.INDEXED

    entry = store.get_entry(page_id(1))
    assert entry is not None
    assert (entry.space_id, entry.workspace_id, entry.page_updated_at) == (
        SPACE_A,
        WORKSPACE_A,
        UPDATED_AT,
    )
    assert entry.embedding_model == embedder.model_name
    assert page_id(1) in top_page_ids(store, embedder, "Die Kantine öffnet um acht Uhr morgens.")
    sections = store.sections_of(page_id(1))
    assert [section.heading_path for section in sections] == [["Regeln"], ["Urlaub"]]
    assert [section.position for section in sections] == [0, 1]


def test_index_ac21_the_search_text_carries_title_and_heading_but_the_stored_text_does_not(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    wiki.markdown = "# Regeln\n\nKantine öffnet früh."
    indexer.index_page(page_id(1))
    assert embedder.calls == [["Urlaubsregeln\nRegeln\nKantine öffnet früh."]]
    assert all_text(store) == ["Kantine öffnet früh."]


def test_index_ac22_a_replaced_sentence_is_gone_and_the_new_one_is_found(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    wiki.markdown = "Die Parkplätze sind kostenlos für alle Mitarbeiter."
    indexer.index_page(page_id(1))
    wiki.markdown = "Fahrräder dürfen im Innenhof abgestellt werden."
    wiki.updated_at = later(5)
    assert indexer.index_page(page_id(1)) == IndexOutcome.INDEXED

    assert not any("Parkplätze" in text for text in all_text(store))
    assert page_id(1) in top_page_ids(
        store, embedder, "Fahrräder dürfen im Innenhof abgestellt werden."
    )
    entry = store.get_entry(page_id(1))
    assert entry is not None and entry.page_updated_at == later(5)


def test_index_ac31_a_text_only_edit_reuses_the_pdf_without_requesting_it(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    wiki.markdown = "Erster Text."
    identifier = wiki.add_pdf(1, build_pdf(["Brandschutz Uebung jeden Herbst"]))
    indexer.index_page(page_id(1))
    assert wiki.attachment_requests == [identifier]
    wiki.attachment_requests.clear()
    embedder.calls.clear()

    wiki.markdown = "Zweiter Text."
    wiki.updated_at = later(5)
    assert indexer.index_page(page_id(1)) == IndexOutcome.INDEXED

    assert wiki.attachment_requests == []
    pdf_sections = [s for s in store.sections_of(page_id(1)) if s.attachment_id == identifier]
    assert [s.text for s in pdf_sections] == ["Brandschutz Uebung jeden Herbst"]
    assert (pdf_sections[0].file_name, pdf_sections[0].pdf_page) == ("datei-1.pdf", 1)
    assert all_text(store) == ["Zweiter Text.", "Brandschutz Uebung jeden Herbst"]
    assert [s.position for s in store.sections_of(page_id(1))] == [0, 1]
    assert embedder.calls == [["Urlaubsregeln\nZweiter Text."]]
    assert page_id(1) in top_page_ids(store, embedder, "Brandschutz Uebung jeden Herbst")


def test_index_ac31_a_title_change_reembeds_the_reused_pdf_without_requesting_it(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    wiki.markdown = "Seitentext."
    identifier = wiki.add_pdf(1, build_pdf(["Brandschutz Uebung jeden Herbst"]))
    indexer.index_page(page_id(1))
    wiki.attachment_requests.clear()

    wiki.title = "Sicherheitsregeln"
    wiki.updated_at = later(5)
    assert indexer.index_page(page_id(1)) == IndexOutcome.INDEXED

    assert wiki.attachment_requests == []
    [pdf] = [s for s in store.sections_of(page_id(1)) if s.attachment_id == identifier]
    [expected] = embedder.embed(
        [search_text("Sicherheitsregeln", [], "Brandschutz Uebung jeden Herbst", "datei-1.pdf")]
    )
    assert pdf.embedding == pytest.approx(expected, abs=1e-5)
    assert (pdf.text, pdf.file_name, pdf.pdf_page) == (
        "Brandschutz Uebung jeden Herbst",
        "datei-1.pdf",
        1,
    )


def test_index_ac31_a_pdf_indexed_with_another_model_is_requested_again(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    identifier = wiki.add_pdf(1, build_pdf(["Brandschutz Uebung"]))
    indexer.index_page(page_id(1))
    wiki.attachment_requests.clear()
    other = HashingEmbedder(model_name="other-model")
    Indexer(mock_client(wiki.handle), store, other).index_page(page_id(1))
    assert wiki.attachment_requests == [identifier]


def test_index_ac32_a_pdf_removed_from_the_page_loses_its_sections(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, embedder: HashingEmbedder
):
    wiki.markdown = "Seitentext bleibt."
    identifier = wiki.add_pdf(1, build_pdf(["Brandschutz Uebung jeden Herbst"]))
    indexer.index_page(page_id(1))
    assert any(s.attachment_id == identifier for s in store.sections_of(page_id(1)))

    wiki.remove_pdf(identifier)
    wiki.updated_at = later(5)
    indexer.index_page(page_id(1))

    assert all_text(store) == ["Seitentext bleibt."]
    assert not any(s.attachment_id for s in store.sections_of(page_id(1)))


def test_index_ac53_a_page_the_bridge_no_longer_knows_leaves_the_index(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore
):
    wiki.markdown = "Text."
    indexer.index_page(page_id(1))
    wiki.missing_page = True

    assert indexer.index_page(page_id(1)) == IndexOutcome.REMOVED

    assert store.get_entry(page_id(1)) is None
    assert store.sections_of(page_id(1)) == []


def test_index_ac53_an_unknown_page_not_in_the_index_is_removed_without_error(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore
):
    wiki.missing_page = True
    assert indexer.index_page(page_id(9)) == IndexOutcome.REMOVED
    assert store.list_entries() == []


def test_index_ac61_older_content_reports_kept_newer(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore
):
    wiki.markdown = "Neuer Text."
    wiki.updated_at = later(10)
    indexer.index_page(page_id(1))
    wiki.markdown = "Alter Text."
    wiki.updated_at = later(1)

    assert indexer.index_page(page_id(1)) == IndexOutcome.KEPT_NEWER
    assert all_text(store) == ["Neuer Text."]


def test_index_ac64_a_pdf_over_the_size_limit_is_not_requested_and_the_limit_is_logged(
    indexer: Indexer,
    wiki: FakeWiki,
    store: IndexStore,
    caplog: pytest.LogCaptureFixture,
):
    wiki.markdown = "Seitentext bleibt."
    identifier = wiki.add_pdf(1, build_pdf(["Zu groß"]), file_size=MAX_PDF_BYTES + 1)
    caplog.set_level(logging.INFO)

    indexer.index_page(page_id(1))

    assert wiki.attachment_requests == []
    assert all_text(store) == ["Seitentext bleibt."]
    [warning] = warnings(caplog)
    assert identifier in warning
    assert "20971520" in warning


def test_index_ac65_a_pdf_of_exactly_the_size_limit_is_indexed(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, caplog: pytest.LogCaptureFixture
):
    wiki.markdown = "Seitentext."
    identifier = wiki.add_pdf(1, build_pdf(["Grenzfall Datei"]), file_size=MAX_PDF_BYTES)
    caplog.set_level(logging.INFO)

    indexer.index_page(page_id(1))

    assert wiki.attachment_requests == [identifier]
    assert any(s.attachment_id == identifier for s in store.sections_of(page_id(1)))
    assert [r for r in caplog.records if r.levelno >= logging.WARNING] == []


def test_index_ac69_a_listed_pdf_the_bridge_cannot_find_is_skipped(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, caplog: pytest.LogCaptureFixture
):
    wiki.markdown = "Seitentext bleibt."
    identifier = wiki.add_pdf(1, build_pdf(["Verschwunden"]))
    wiki.missing_files.add(identifier)
    caplog.set_level(logging.INFO)

    assert indexer.index_page(page_id(1)) == IndexOutcome.INDEXED

    assert all_text(store) == ["Seitentext bleibt."]
    assert any(identifier in r.getMessage() for r in caplog.records)


def test_index_ac63_a_pdf_without_text_layer_is_skipped_with_a_warning_naming_it(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, caplog: pytest.LogCaptureFixture
):
    wiki.markdown = "Seitentext bleibt."
    identifier = wiki.add_pdf(1, build_blank_pdf(2))
    caplog.set_level(logging.INFO)

    indexer.index_page(page_id(1))

    assert all_text(store) == ["Seitentext bleibt."]
    [warning] = warnings(caplog)
    assert identifier in warning and "no text layer" in warning


def test_index_ac21_an_unreachable_bridge_raises_unavailable_and_leaves_the_index_unchanged(
    store: IndexStore, embedder: HashingEmbedder
):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    indexer = Indexer(mock_client(refuse), store, embedder)
    with pytest.raises(BridgeUnavailable):
        indexer.index_page(page_id(1))
    assert store.list_entries() == []


def test_index_ac73_log_lines_contain_no_title_text_pdf_text_or_token(
    indexer: Indexer, wiki: FakeWiki, store: IndexStore, caplog: pytest.LogCaptureFixture
):
    wiki.title = "Quarzkäfer-Titel"
    wiki.markdown = "# Zebrafink-Überschrift\n\nMandelbaum-Satz im Seitentext."
    wiki.add_pdf(1, build_pdf(["Pfauenauge Satz im PDF"]))
    wiki.add_pdf(2, build_blank_pdf(1))
    wiki.add_pdf(3, build_pdf(["Wolkenkratzer"]), file_size=MAX_PDF_BYTES + 1)
    missing = wiki.add_pdf(4, build_pdf(["Nebelhorn"]))
    wiki.missing_files.add(missing)
    caplog.set_level(logging.DEBUG)

    indexer.index_page(page_id(1))
    wiki.updated_at = later(1)
    indexer.index_page(page_id(1))
    wiki.updated_at = later(0)
    indexer.index_page(page_id(1))
    wiki.missing_page = True
    indexer.index_page(page_id(1))

    assert caplog.records
    log = caplog.text + "\n".join(record.getMessage() for record in caplog.records)
    for secret in (
        "Quarzkäfer",
        "Zebrafink",
        "Mandelbaum",
        "Pfauenauge",
        "Wolkenkratzer",
        "Nebelhorn",
        "datei-1.pdf",
        TOKEN,
    ):
        assert secret not in log
