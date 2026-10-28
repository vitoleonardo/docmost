from dataclasses import replace

import pytest

from ai_service.index_store import IndexStore, StoredSection
from ai_service.indexer import Indexer
from tests.fake_bridge import seed_shaped_bridge
from tests.hashing_embedder import HashingEmbedder
from tests.index_db import (
    SPACE_A,
    SPACE_B,
    SPACE_C,
    WORKSPACE_B,
    attachment_id,
    embedded_sections,
    index_page,
    later,
    make_entry,
    max_component_difference,
    page_id,
    stored_and_fresh_embeddings,
)

pytestmark = pytest.mark.integration


def pdf_section(
    embedder: HashingEmbedder, position: int, attachment: str, pdf_page: int, text: str
) -> StoredSection:
    [vector] = embedder.embed([text])
    return StoredSection(position, [], text, vector, attachment, "handbuch.pdf", pdf_page)


def section_texts(store: IndexStore, number: int) -> list[str]:
    return [section.text for section in store.sections_of(page_id(number))]


def test_index_ac61_content_with_an_earlier_update_time_keeps_the_later_version(
    store: IndexStore, embedder: HashingEmbedder
):
    newer = make_entry(1, updated_at=later(10), title="Neu")
    index_page(store, embedder, newer, ["Stand T2 eins", "Stand T2 zwei"])

    older = make_entry(1, updated_at=later(5), title="Alt")
    kept = store.replace_page(older, embedded_sections(embedder, ["Stand T1"]))

    assert kept is False
    entry = store.get_entry(page_id(1))
    assert entry is not None
    assert entry.page_updated_at == later(10)
    assert entry.title == "Neu"
    assert section_texts(store, 1) == ["Stand T2 eins", "Stand T2 zwei"]


def test_index_ac61_content_with_the_same_or_a_later_update_time_replaces_the_page(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(store, embedder, make_entry(1), ["erste Fassung"])
    assert store.replace_page(make_entry(1), embedded_sections(embedder, ["gleiche Zeit"]))
    assert section_texts(store, 1) == ["gleiche Zeit"]
    assert store.replace_page(
        make_entry(1, updated_at=later(1), space_id=SPACE_B, title="Umbenannt"),
        embedded_sections(embedder, ["spätere Fassung"]),
    )
    entry = store.get_entry(page_id(1))
    assert entry is not None
    assert (entry.title, entry.space_id, entry.page_updated_at) == ("Umbenannt", SPACE_B, later(1))
    assert section_texts(store, 1) == ["spätere Fassung"]


def test_replacing_a_page_twice_stores_its_sections_once(
    store: IndexStore, embedder: HashingEmbedder
):
    texts = ["Abschnitt eins", "Abschnitt zwei", "Abschnitt drei"]
    index_page(store, embedder, make_entry(1), texts)
    index_page(store, embedder, make_entry(1), texts)

    assert section_texts(store, 1) == texts
    assert [entry.page_id for entry in store.list_entries()] == [page_id(1)]


def test_a_page_without_sections_is_listed_with_its_entry_fields(
    store: IndexStore, embedder: HashingEmbedder
):
    entry = make_entry(1, title="Leer")
    assert store.replace_page(entry, [])

    stored = store.get_entry(page_id(1))
    assert stored is not None
    assert replace(stored, indexed_at=None) == entry
    assert stored.indexed_at is not None
    assert store.sections_of(page_id(1)) == []
    assert store.get_entry(page_id(2)) is None


def test_index_ac12_an_indexed_section_embedded_again_equals_its_stored_embedding(
    store: IndexStore, embedder: HashingEmbedder
):
    bridge = seed_shaped_bridge()
    indexer = Indexer(bridge.client(), store, embedder)
    for listed in bridge.listed_ids():
        indexer.index_page(listed)

    pairs = stored_and_fresh_embeddings(store, embedder)

    assert any(section.attachment_id is None and section.heading_path for section, _ in pairs)
    assert any(section.attachment_id is not None for section, _ in pairs)
    for section, fresh in pairs:
        assert max_component_difference(section.embedding, fresh) <= 1e-5


def test_stored_embeddings_round_trip_through_the_store(
    store: IndexStore, embedder: HashingEmbedder
):
    texts = ["Urlaub beantragen im Portal", "Reisekosten bis 30 Tage einreichen"]
    written = index_page(store, embedder, make_entry(1), texts)
    store.replace_page(
        make_entry(2),
        [pdf_section(embedder, 0, attachment_id(1), 1, "Kapitel eins der Anleitung")],
    )

    stored = store.sections_of(page_id(1))
    [pdf] = store.sections_of(page_id(2))
    for section, original in zip(stored, written, strict=True):
        assert max_component_difference(section.embedding, original.embedding) <= 1e-5
    assert max_component_difference(pdf.embedding, embedder.embed([pdf.text])[0]) <= 1e-5


def test_sections_keep_heading_path_and_pdf_fields(store: IndexStore, embedder: HashingEmbedder):
    [text_vector] = embedder.embed(["Text unter Kopf"])
    sections = [
        StoredSection(0, ["Kapitel", "Unterkapitel"], "Text unter Kopf", text_vector),
        pdf_section(embedder, 1, attachment_id(1), 3, "PDF Seite drei"),
    ]
    store.replace_page(make_entry(1), sections)

    [text_section, pdf] = store.sections_of(page_id(1))
    assert (text_section.heading_path, text_section.attachment_id) == (
        ["Kapitel", "Unterkapitel"],
        None,
    )
    assert (pdf.attachment_id, pdf.file_name, pdf.pdf_page, pdf.heading_path) == (
        attachment_id(1),
        "handbuch.pdf",
        3,
        [],
    )


def test_pdf_sections_for_returns_sections_of_the_listed_attachments_of_the_same_model(
    store: IndexStore, embedder: HashingEmbedder
):
    sections = [
        pdf_section(embedder, 0, attachment_id(1), 1, "Erste PDF Seite eins"),
        pdf_section(embedder, 1, attachment_id(1), 2, "Erste PDF Seite zwei"),
        pdf_section(embedder, 2, attachment_id(2), 1, "Zweite PDF"),
    ]
    store.replace_page(make_entry(1), embedded_sections(embedder, ["Seitentext"]) + sections)

    reused = store.pdf_sections_for(page_id(1), [attachment_id(1)], embedder.model_name)

    assert list(reused) == [attachment_id(1)]
    assert [(s.pdf_page, s.text) for s in reused[attachment_id(1)]] == [
        (1, "Erste PDF Seite eins"),
        (2, "Erste PDF Seite zwei"),
    ]
    assert reused[attachment_id(1)][0].embedding == pytest.approx(sections[0].embedding, abs=1e-5)
    assert store.pdf_sections_for(page_id(1), [attachment_id(1)], "other-model") == {}
    assert store.pdf_sections_for(page_id(1), [], embedder.model_name) == {}
    assert store.pdf_sections_for(page_id(2), [attachment_id(1)], embedder.model_name) == {}


def test_remove_pages_removes_entries_and_all_their_sections(
    store: IndexStore, embedder: HashingEmbedder
):
    for number in (1, 2, 3):
        store.replace_page(
            make_entry(number),
            embedded_sections(embedder, [f"Text {number}"])
            + [pdf_section(embedder, 1, attachment_id(number), 1, f"PDF {number}")],
        )

    store.remove_pages([page_id(1), page_id(3)])
    store.remove_pages([])

    assert [entry.page_id for entry in store.list_entries()] == [page_id(2)]
    assert section_texts(store, 1) == []
    assert section_texts(store, 2) == ["Text 2", "PDF 2"]
    assert section_texts(store, 3) == []


def test_remove_space_and_remove_workspace_remove_only_their_pages(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(store, embedder, make_entry(1, space_id=SPACE_A), ["A"])
    store.replace_page(
        make_entry(2, space_id=SPACE_B),
        [pdf_section(embedder, 0, attachment_id(2), 1, "PDF in B")],
    )
    index_page(store, embedder, make_entry(3, space_id=SPACE_C, workspace_id=WORKSPACE_B), ["C"])

    store.remove_space(SPACE_B)
    assert [entry.page_id for entry in store.list_entries()] == [page_id(1), page_id(3)]
    assert section_texts(store, 2) == []

    store.remove_workspace(WORKSPACE_B)
    assert [entry.page_id for entry in store.list_entries()] == [page_id(1)]
    assert section_texts(store, 3) == []
    assert section_texts(store, 1) == ["A"]


def test_rescope_moves_pages_to_the_space_and_keeps_their_sections(
    store: IndexStore, embedder: HashingEmbedder
):
    index_page(store, embedder, make_entry(1), ["eins"])
    index_page(store, embedder, make_entry(2), ["zwei"])
    index_page(store, embedder, make_entry(3), ["drei"])

    store.rescope([page_id(1), page_id(2)], SPACE_B)

    spaces = {entry.page_id: entry.space_id for entry in store.list_entries()}
    assert spaces == {page_id(1): SPACE_B, page_id(2): SPACE_B, page_id(3): SPACE_A}
    assert section_texts(store, 1) == ["eins"]
    entry = store.get_entry(page_id(1))
    assert entry is not None
    assert entry.page_updated_at == make_entry(1).page_updated_at
