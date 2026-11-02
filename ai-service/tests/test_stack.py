import json
import os
import re
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx
import psycopg
import pytest

from ai_service.bridge_client import BridgeClient, ListedPage, PageContent
from ai_service.embedding import FastEmbedEmbedder
from ai_service.eval_index_ready import list_all_pages
from ai_service.index_store import IndexStore, SearchHit, StoredSection
from ai_service.search import search_index
from ai_service.settings import WorkerSettings

pytestmark = [pytest.mark.integration, pytest.mark.stack]

STACK_VARIABLES = ["STACK_WIKI_URL", "STACK_AI_DATABASE_URL", "STACK_SERVICE_TOKEN"]
SEED_GENERATED = (
    Path(__file__).resolve().parents[2] / "apps/server/src/integrations/seed/content/generated"
)
OWNER_EMAIL = "joerg.ostmoor@ostmooimooi.example.com"
OWNER_PASSWORD = os.environ.get("STACK_SEED_PASSWORD", "seed-demo-password")
PAGE_SENTENCE = (
    "Die Personalabteilung verschickt den Vertrag, bestellt den Laptop"
    " und legt die Benutzerkonten an."
)
PDF_FILE = "kundenvertrag-stadtwerke-beispielstadt.pdf"
PDF_FIELD = "term"
TITLE_WORD = "zugangsregeln"
WRITABLE_SPACE_PAGE_TITLE = "Bürozeiten und Erreichbarkeit"
FRESHNESS_LIMIT_SECONDS = 60
POLL_SECONDS = 0.5
GIVE_UP_SECONDS = 180


@dataclass(frozen=True)
class Stack:
    wiki_url: str
    service_token: str
    bridge: BridgeClient
    store: IndexStore
    embedder: FastEmbedEmbedder
    listed: list[ListedPage]
    contents: dict[str, PageContent]

    @property
    def space_ids(self) -> list[str]:
        return sorted({page.space_id for page in self.listed})

    def search(self, question: str, limit: int = 10) -> list[SearchHit]:
        return search_index(self.store, self.embedder, question, self.space_ids, limit)


def normalised(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


@pytest.fixture(scope="module")
def stack() -> Iterator[Stack]:
    missing = [name for name in STACK_VARIABLES if not os.environ.get(name)]
    if missing:
        pytest.fail(f"no running stack configured, set {', '.join(missing)}")
    wiki_url = os.environ["STACK_WIKI_URL"]
    service_token = os.environ["STACK_SERVICE_TOKEN"]
    model = os.environ.get(
        "STACK_EMBEDDING_MODEL", str(WorkerSettings.model_fields["ai_embedding_model"].default)
    )
    bridge = BridgeClient(wiki_url, service_token)
    listed = list_all_pages(bridge)
    contents = {page.id: bridge.page_content(page.id) for page in listed}
    embedder = FastEmbedEmbedder(model)
    with psycopg.connect(os.environ["STACK_AI_DATABASE_URL"], autocommit=True) as conn:
        yield Stack(wiki_url, service_token, bridge, IndexStore(conn), embedder, listed, contents)


def wait_for_entries_equal_to_list(stack: Stack) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if {entry.page_id for entry in stack.store.list_entries()} == {
            page.id for page in stack.listed
        }:
            return
        time.sleep(POLL_SECONDS)


def test_index_ac2_index_entries_equal_the_bridge_page_list(stack: Stack):
    wait_for_entries_equal_to_list(stack)
    entries = {entry.page_id: entry for entry in stack.store.list_entries()}
    assert set(entries) == {page.id for page in stack.listed}
    assert len(stack.listed) >= 30
    for page in stack.listed:
        entry = entries[page.id]
        assert entry.title == stack.contents[page.id].title
        assert entry.space_id == page.space_id
        assert entry.page_updated_at == page.updated_at


def test_index_ac3_every_page_with_body_text_has_a_section(stack: Stack):
    pages_with_text = [
        page_id
        for page_id, content in stack.contents.items()
        if any(
            line.strip() and not line.lstrip().startswith("#")
            for line in content.markdown.splitlines()
        )
    ]
    assert len(pages_with_text) >= 20
    without_section = [
        page_id
        for page_id in pages_with_text
        if not any(section.attachment_id is None for section in stack.store.sections_of(page_id))
    ]
    assert without_section == []


def pdf_file_names_by_text_layer() -> tuple[set[str], set[str]]:
    ground_truth = json.loads((SEED_GENERATED / "ground-truth.json").read_text())
    scanned = {entry["pdf"] for entry in ground_truth if not entry["textLayer"]}
    all_files = {path.name for path in SEED_GENERATED.glob("*.pdf")}
    return all_files - scanned, scanned


def indexed_pdf_sections(stack: Stack) -> list[StoredSection]:
    return [
        section
        for page_id in stack.contents
        for section in stack.store.sections_of(page_id)
        if section.attachment_id is not None
    ]


def test_index_ac4_every_text_pdf_has_sections_with_attachment_file_and_page(stack: Stack):
    with_text, scanned = pdf_file_names_by_text_layer()
    attachments = {
        attachment.file_name: attachment.id
        for content in stack.contents.values()
        for attachment in content.attachments
    }
    assert with_text <= set(attachments)
    assert scanned <= set(attachments)
    pdf_sections = indexed_pdf_sections(stack)
    for file_name in with_text:
        own = [s for s in pdf_sections if s.attachment_id == attachments[file_name]]
        assert own, file_name
        assert all(s.file_name == file_name for s in own)
        assert all(s.pdf_page is not None and s.pdf_page >= 1 for s in own)
    for file_name in scanned:
        assert not [s for s in pdf_sections if s.attachment_id == attachments[file_name]]


def test_index_ac13_a_verbatim_page_sentence_gives_that_page_as_first_result(stack: Stack):
    sentence = normalised(PAGE_SENTENCE)
    owners = [
        page_id
        for page_id, content in stack.contents.items()
        if sentence in normalised(content.markdown)
    ]
    assert len(owners) == 1
    results = stack.search(PAGE_SENTENCE)
    assert results[0].page_id == owners[0]
    assert results[0].attachment_id is None
    assert stack.space_ids == sorted({page.space_id for page in stack.listed})
    assert len(stack.space_ids) >= 6


def test_index_ac14_a_verbatim_pdf_sentence_gives_that_pdf_in_the_first_5(stack: Stack):
    ground_truth = json.loads((SEED_GENERATED / "ground-truth.json").read_text())
    quote = next(entry for entry in ground_truth if entry["pdf"] == PDF_FILE)["fields"][PDF_FIELD][
        "quote"
    ]
    owners = {
        section.attachment_id
        for section in indexed_pdf_sections(stack)
        if normalised(quote) in normalised(section.text)
    }
    assert len(owners) == 1
    results = stack.search(quote, limit=5)
    assert owners <= {hit.attachment_id for hit in results}
    hit = next(hit for hit in results if hit.attachment_id in owners)
    assert hit.file_name == PDF_FILE
    assert hit.pdf_page is not None and hit.pdf_page >= 1


def test_index_ac15_a_word_only_in_one_title_gives_that_page_in_the_first_5(stack: Stack):
    titled = [
        page_id
        for page_id, content in stack.contents.items()
        if TITLE_WORD in normalised(content.title)
    ]
    assert len(titled) == 1
    elsewhere = [
        page_id
        for page_id, content in stack.contents.items()
        if page_id != titled[0] and TITLE_WORD in normalised(content.title + " " + content.markdown)
    ]
    assert elsewhere == []
    assert not [s for s in indexed_pdf_sections(stack) if TITLE_WORD in normalised(s.text)]
    assert TITLE_WORD not in normalised(stack.contents[titled[0]].markdown)
    results = stack.search(TITLE_WORD, limit=5)
    assert titled[0] in {hit.page_id for hit in results}


@contextmanager
def owner_session(wiki_url: str) -> Iterator[httpx.Client]:
    with httpx.Client(base_url=wiki_url, timeout=30) as session:
        response = session.post(
            "/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}
        )
        assert response.status_code == 200, response.text
        yield session


@contextmanager
def throwaway_page(session: httpx.Client, space_id: str, token: str) -> Iterator[str]:
    response = session.post(
        "/api/pages/create",
        json={
            "spaceId": space_id,
            "title": f"Wegwerfseite {token}",
            "content": f"Platzhalter {token}",
            "format": "markdown",
        },
    )
    assert response.status_code == 200, response.text
    page_id = response.json()["data"]["id"]
    try:
        yield page_id
    finally:
        deleted = session.post("/api/pages/delete", json={"pageId": page_id})
        assert deleted.status_code == 200, deleted.text


def wait_until_found(stack: Stack, sentence: str, page_id: str, token: str) -> float | None:
    started = time.monotonic()
    while time.monotonic() - started < GIVE_UP_SECONDS:
        results = stack.search(sentence, limit=5)
        if any(hit.page_id == page_id and token in hit.text for hit in results):
            return time.time()
        time.sleep(POLL_SECONDS)
    return None


def test_index_ac23_a_rest_content_update_is_searchable_within_60_seconds(stack: Stack):
    space_id = next(
        c.space_id for c in stack.contents.values() if c.title == WRITABLE_SPACE_PAGE_TITLE
    )
    token = uuid.uuid4().hex[:8]
    sentence = f"Die Kantine bietet donnerstags Linsensuppe mit Würstchen an, Kennung {token}."
    with (
        owner_session(stack.wiki_url) as session,
        throwaway_page(session, space_id, token) as page_id,
    ):
        previous_update = stack.bridge.page_content(page_id).updated_at
        response = session.post(
            "/api/pages/update",
            json={
                "pageId": page_id,
                "content": f"## Nachtrag {token}\n\n{sentence}",
                "operation": "append",
                "format": "markdown",
            },
        )
        assert response.status_code == 200, response.text
        found_at = wait_until_found(stack, sentence, page_id, token)
        assert found_at is not None, f"page not searchable after {GIVE_UP_SECONDS} s"
        new_update = stack.bridge.page_content(page_id).updated_at
    assert new_update > previous_update
    seconds = found_at - new_update.timestamp()
    print(f"INDEX-AC23 freshness: {seconds:.1f} s")
    assert seconds <= FRESHNESS_LIMIT_SECONDS
