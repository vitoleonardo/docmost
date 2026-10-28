import os
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import LiteralString

import psycopg
import pytest
from psycopg import sql

from ai_service.migrations_check import MigrationsMissingError, assert_migrated
from tests.test_db_role import (
    ADMIN_URL,
    AI_URL,
    POSTGRES_SERVER,
    TEST_DATABASE,
    SetupRun,
    drop_test_database_and_role,
    run_setup,
)

SERVICE_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_COMMAND = "uv run alembic upgrade head"
INDEX_TABLES = ["indexed_pages", "page_sections"]
PAGE_ID = "0192f000-0000-7000-8000-0000000000c1"
INDEX_ROWS: LiteralString = """
    SELECT p.page_id::text, p.title, s.position, s.heading_path, s.text, s.embedding::text
    FROM ai.indexed_pages p
    JOIN ai.page_sections s ON s.page_id = p.page_id
    ORDER BY s.position
"""


@pytest.fixture
def ai_schema(tmp_path: Path) -> Iterator[None]:
    with psycopg.connect(f"{POSTGRES_SERVER}/postgres", autocommit=True) as server:
        drop_test_database_and_role(server)
        server.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DATABASE)))
        try:
            setup = run_setup(tmp_path)
            assert setup.returncode == 0, setup.stderr
            yield
        finally:
            drop_test_database_and_role(server)


def run_migrations() -> SetupRun:
    completed = subprocess.run(
        MIGRATION_COMMAND.split(),
        cwd=SERVICE_ROOT,
        env={**os.environ, "AI_DATABASE_URL": AI_URL},
        capture_output=True,
        text=True,
        timeout=120,
    )
    return SetupRun(completed.returncode, completed.stdout, completed.stderr)


def migrate() -> None:
    run = run_migrations()
    assert run.returncode == 0, run.stderr


def schemas_holding_index_tables() -> list[tuple[str, str]]:
    with psycopg.connect(ADMIN_URL) as admin:
        return admin.execute(
            """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_name = ANY(%s)
            ORDER BY table_name
            """,
            (INDEX_TABLES,),
        ).fetchall()


def insert_indexed_page(ai: psycopg.Connection) -> None:
    ai.execute(
        """
        INSERT INTO ai.indexed_pages
            (page_id, workspace_id, space_id, title, page_updated_at, embedding_model)
        VALUES (%s, %s, %s, 'Urlaub', now(), 'test-model')
        """,
        (PAGE_ID, PAGE_ID, PAGE_ID),
    )
    ai.execute(
        """
        INSERT INTO ai.page_sections (page_id, position, heading_path, text, embedding)
        VALUES (%s, 0, ARRAY['Antrag'], 'Urlaub beantragen', '[1,2,3]'),
               (%s, 1, '{}', 'Ohne Kopf', '[0.5,0.25]')
        """,
        (PAGE_ID, PAGE_ID),
    )


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_index_ac1_upgrade_as_ai_role_creates_index_tables_in_schema_ai():
    run = run_migrations()
    assert run.returncode == 0, run.stderr
    assert schemas_holding_index_tables() == [("ai", "indexed_pages"), ("ai", "page_sections")]


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_index_ac1_sections_of_a_removed_page_go_with_it_and_pdf_fields_come_together():
    migrate()
    with psycopg.connect(AI_URL, autocommit=True) as ai:
        insert_indexed_page(ai)
        with pytest.raises(psycopg.errors.CheckViolation):
            ai.execute(
                """
                INSERT INTO ai.page_sections (page_id, position, attachment_id, text, embedding)
                VALUES (%s, 2, %s, 'PDF ohne Seite', '[1]')
                """,
                (PAGE_ID, PAGE_ID),
            )
        ai.execute("DELETE FROM ai.indexed_pages WHERE page_id = %s", (PAGE_ID,))
        row = ai.execute("SELECT count(*) FROM ai.page_sections").fetchone()
    assert row == (0,)


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_index_ac1_setup_rerun_keeps_pgvector_on_the_ai_role_search_path(tmp_path: Path):
    rerun = run_setup(tmp_path)
    assert rerun.returncode == 0, rerun.stderr
    with psycopg.connect(AI_URL) as ai:
        search_path = ai.execute("SHOW search_path").fetchone()
        distance = ai.execute("SELECT '[1,0]'::vector <=> '[0,1]'::vector").fetchone()
    assert search_path == ("ai",)
    assert distance == (1.0,)


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_index_ac75_second_upgrade_exits_zero_and_keeps_the_index():
    migrate()
    with psycopg.connect(AI_URL, autocommit=True) as ai:
        insert_indexed_page(ai)
        before = ai.execute(INDEX_ROWS).fetchall()
    second = run_migrations()
    assert second.returncode == 0, second.stderr
    with psycopg.connect(AI_URL) as ai:
        after = ai.execute(INDEX_ROWS).fetchall()
    assert len(before) == 2
    assert after == before


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_index_ac74_check_names_the_migration_command_on_a_schema_without_index_tables():
    with psycopg.connect(AI_URL) as ai, pytest.raises(MigrationsMissingError) as error:
        assert_migrated(ai)
    assert MIGRATION_COMMAND in str(error.value)


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM ai.alembic_version",
        "UPDATE ai.alembic_version SET version_num = 'unknown_revision'",
    ],
)
def test_index_ac74_check_refuses_a_version_table_not_at_head(statement: LiteralString):
    migrate()
    with psycopg.connect(AI_URL, autocommit=True) as ai:
        ai.execute(statement)
        with pytest.raises(MigrationsMissingError) as error:
            assert_migrated(ai)
    assert MIGRATION_COMMAND in str(error.value)


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_index_ac74_check_passes_after_upgrade():
    migrate()
    with psycopg.connect(AI_URL) as ai:
        assert_migrated(ai)
