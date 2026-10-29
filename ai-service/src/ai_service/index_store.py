from collections.abc import Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, LiteralString

import psycopg

from ai_service.index_lock import index_writer_lock

ENTRY_COLUMNS: LiteralString = """
    page_id::text, workspace_id::text, space_id::text, title, page_updated_at,
    embedding_model, indexed_at
"""
SECTION_COLUMNS: LiteralString = """
    position, heading_path, text, embedding::text, attachment_id::text, file_name, pdf_page
"""


@dataclass(frozen=True)
class PageEntry:
    page_id: str
    workspace_id: str
    space_id: str
    title: str
    page_updated_at: datetime
    embedding_model: str
    indexed_at: datetime | None = None


@dataclass(frozen=True)
class StoredSection:
    position: int
    heading_path: list[str]
    text: str
    embedding: list[float] = field(repr=False)
    attachment_id: str | None = None
    file_name: str | None = None
    pdf_page: int | None = None


@dataclass(frozen=True)
class SearchHit:
    page_id: str
    title: str
    space_id: str
    heading_path: list[str]
    text: str
    score: float
    attachment_id: str | None
    file_name: str | None
    pdf_page: int | None


def vector_literal(vector: Sequence[float]) -> str:
    return "[" + ",".join(repr(float(component)) for component in vector) + "]"


def parse_vector(literal: str) -> list[float]:
    return [float(component) for component in literal.strip("[]").split(",")]


def section_from_row(row: tuple[Any, ...]) -> StoredSection:
    position, heading_path, text, embedding, attachment_id, file_name, pdf_page = row
    return StoredSection(
        position, heading_path, text, parse_vector(embedding), attachment_id, file_name, pdf_page
    )


class IndexStore:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def writer_lock(self) -> AbstractContextManager[None]:
        return index_writer_lock(self._conn)

    def get_entry(self, page_id: str) -> PageEntry | None:
        with self._conn.transaction():
            row = self._conn.execute(
                f"SELECT {ENTRY_COLUMNS} FROM ai.indexed_pages WHERE page_id = %s", (page_id,)
            ).fetchone()
        return None if row is None else PageEntry(*row)

    def list_entries(self) -> list[PageEntry]:
        with self._conn.transaction():
            rows = self._conn.execute(
                f"SELECT {ENTRY_COLUMNS} FROM ai.indexed_pages ORDER BY page_id"
            ).fetchall()
        return [PageEntry(*row) for row in rows]

    def sections_of(self, page_id: str) -> list[StoredSection]:
        with self._conn.transaction():
            rows = self._conn.execute(
                f"SELECT {SECTION_COLUMNS} FROM ai.page_sections WHERE page_id = %s"
                " ORDER BY position, id",
                (page_id,),
            ).fetchall()
        return [section_from_row(row) for row in rows]

    def replace_page(self, entry: PageEntry, sections: Sequence[StoredSection]) -> bool:
        with self._conn.transaction():
            written = self._conn.execute(
                """
                INSERT INTO ai.indexed_pages
                    (page_id, workspace_id, space_id, title, page_updated_at, embedding_model)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (page_id) DO UPDATE SET
                    workspace_id = excluded.workspace_id,
                    space_id = excluded.space_id,
                    title = excluded.title,
                    page_updated_at = excluded.page_updated_at,
                    embedding_model = excluded.embedding_model,
                    indexed_at = now()
                WHERE ai.indexed_pages.page_updated_at <= excluded.page_updated_at
                RETURNING page_id
                """,
                (
                    entry.page_id,
                    entry.workspace_id,
                    entry.space_id,
                    entry.title,
                    entry.page_updated_at,
                    entry.embedding_model,
                ),
            ).fetchone()
            if written is None:
                return False
            self._conn.execute("DELETE FROM ai.page_sections WHERE page_id = %s", (entry.page_id,))
            with self._conn.cursor() as cursor:
                cursor.executemany(
                    """
                    INSERT INTO ai.page_sections (page_id, position, heading_path, attachment_id,
                        file_name, pdf_page, text, embedding)
                    VALUES (%s, %s, %s::text[], %s, %s, %s, %s, %s::ai.vector)
                    """,
                    [
                        (
                            entry.page_id,
                            section.position,
                            section.heading_path,
                            section.attachment_id,
                            section.file_name,
                            section.pdf_page,
                            section.text,
                            vector_literal(section.embedding),
                        )
                        for section in sections
                    ],
                )
        return True

    def pdf_sections_for(
        self, page_id: str, attachment_ids: Sequence[str], embedding_model: str
    ) -> dict[str, list[StoredSection]]:
        with self._conn.transaction():
            rows = self._conn.execute(
                f"""
                SELECT {SECTION_COLUMNS}
                FROM ai.page_sections s
                JOIN ai.indexed_pages p ON p.page_id = s.page_id
                WHERE s.page_id = %s
                  AND s.attachment_id = ANY(%s::uuid[])
                  AND p.embedding_model = %s
                ORDER BY s.position, s.id
                """,
                (page_id, list(attachment_ids), embedding_model),
            ).fetchall()
        reusable: dict[str, list[StoredSection]] = {}
        for row in rows:
            section = section_from_row(row)
            reusable.setdefault(section.attachment_id or "", []).append(section)
        return reusable

    def remove_pages(self, page_ids: Sequence[str]) -> None:
        self._write("DELETE FROM ai.indexed_pages WHERE page_id = ANY(%s::uuid[])", list(page_ids))

    def remove_space(self, space_id: str) -> None:
        self._write("DELETE FROM ai.indexed_pages WHERE space_id = %s", space_id)

    def remove_workspace(self, workspace_id: str) -> None:
        self._write("DELETE FROM ai.indexed_pages WHERE workspace_id = %s", workspace_id)

    def rescope(self, page_ids: Sequence[str], space_id: str) -> None:
        with self._conn.transaction():
            self._conn.execute(
                "UPDATE ai.indexed_pages SET space_id = %s WHERE page_id = ANY(%s::uuid[])",
                (space_id, list(page_ids)),
            )

    def search(
        self,
        query_vector: Sequence[float],
        space_ids: Sequence[str],
        embedding_model: str,
        limit: int,
        page_id: str | None = None,
    ) -> list[SearchHit]:
        with self._conn.transaction():
            rows = self._conn.execute(
                """
                WITH active_sections AS MATERIALIZED (
                    SELECT p.page_id, p.title, p.space_id, s.position, s.heading_path, s.text,
                        s.embedding, s.attachment_id, s.file_name, s.pdf_page
                    FROM ai.page_sections s
                    JOIN ai.indexed_pages p ON p.page_id = s.page_id
                    WHERE p.space_id = ANY(%s::uuid[])
                      AND p.embedding_model = %s
                      AND (%s::uuid IS NULL OR p.page_id = %s::uuid)
                ),
                scored AS (
                    SELECT a.*, a.embedding OPERATOR(ai.<=>) %s::ai.vector AS distance
                    FROM active_sections a
                )
                SELECT page_id::text, title, space_id::text, heading_path, text,
                    1 - distance AS score, attachment_id::text, file_name, pdf_page
                FROM scored
                WHERE distance <> 'NaN'::float8
                ORDER BY score DESC, scored.page_id, scored.position
                LIMIT %s
                """,
                (
                    list(space_ids),
                    embedding_model,
                    page_id,
                    page_id,
                    vector_literal(query_vector),
                    limit,
                ),
            ).fetchall()
        return [SearchHit(*row) for row in rows]

    def _write(self, statement: LiteralString, value: object) -> None:
        with self._conn.transaction():
            self._conn.execute(statement, (value,))
