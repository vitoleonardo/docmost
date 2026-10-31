from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg

from ai_service.embedding import Embedder
from ai_service.index_store import IndexStore, PageEntry, StoredSection
from ai_service.indexer import search_text
from tests.hashing_embedder import HashingEmbedder
from tests.test_db_role import AI_URL
from tests.test_migrations import fresh_ai_schema, migrate

WORKSPACE_A = "0192f000-0000-7000-8000-00000000a000"
WORKSPACE_B = "0192f000-0000-7000-8000-00000000b000"
SPACE_A = "0192f000-0000-7000-8000-00000000a001"
SPACE_B = "0192f000-0000-7000-8000-00000000a002"
SPACE_C = "0192f000-0000-7000-8000-00000000b001"
UPDATED_AT = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


@contextmanager
def migrated_index_store(tmp_path: Path, options: str | None = None) -> Iterator[IndexStore]:
    with fresh_ai_schema(tmp_path):
        migrate()
        with psycopg.connect(AI_URL, autocommit=True, options=options) as conn:
            yield IndexStore(conn)


def page_id(number: int) -> str:
    return f"0192f000-0000-7000-8000-{number:012d}"


def attachment_id(number: int) -> str:
    return f"0192f000-0000-7000-9000-{number:012d}"


def make_entry(
    number: int,
    space_id: str = SPACE_A,
    workspace_id: str = WORKSPACE_A,
    title: str = "Seite",
    updated_at: datetime = UPDATED_AT,
    embedding_model: str = "test-hashing",
) -> PageEntry:
    return PageEntry(
        page_id=page_id(number),
        workspace_id=workspace_id,
        space_id=space_id,
        title=title,
        page_updated_at=updated_at,
        embedding_model=embedding_model,
    )


def embedded_sections(
    embedder: HashingEmbedder, texts: Sequence[str], heading_path: Sequence[str] = ()
) -> list[StoredSection]:
    return [
        StoredSection(position, list(heading_path), text, vector)
        for position, (text, vector) in enumerate(zip(texts, embedder.embed(texts), strict=True))
    ]


def index_page(
    store: IndexStore, embedder: HashingEmbedder, entry: PageEntry, texts: Sequence[str]
) -> list[StoredSection]:
    sections = embedded_sections(embedder, texts)
    assert store.replace_page(entry, sections)
    return sections


def indexed_ids(store: IndexStore) -> list[str]:
    return [entry.page_id for entry in store.list_entries()]


def stored_and_fresh_embeddings(
    store: IndexStore, embedder: Embedder
) -> list[tuple[StoredSection, list[float]]]:
    pairs: list[tuple[StoredSection, list[float]]] = []
    for entry in store.list_entries():
        assert entry.embedding_model == embedder.model_name
        sections = store.sections_of(entry.page_id)
        if not sections:
            continue
        fresh = embedder.embed(
            [search_text(entry.title, s.heading_path, s.text, s.file_name) for s in sections]
        )
        pairs.extend(zip(sections, fresh, strict=True))
    return pairs


def max_component_difference(first: Sequence[float], second: Sequence[float]) -> float:
    assert len(first) == len(second)
    return max(abs(a - b) for a, b in zip(first, second, strict=True))


def later(minutes: int) -> datetime:
    return UPDATED_AT + timedelta(minutes=minutes)
