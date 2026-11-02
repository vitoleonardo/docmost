import os
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
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
INDEX_REVISION = "0001_index_tables"
INDEX_TABLES = ["indexed_pages", "page_sections"]
AGENT_TABLES = ["agent_proposals", "agent_runs"]
RUN_ID = "0192f000-0000-7000-8000-0000000000d1"
PROPOSAL_ID = "0192f000-0000-7000-8000-0000000000d2"
PAGE_ID = "0192f000-0000-7000-8000-0000000000c1"
INDEX_ROWS: LiteralString = """
    SELECT p.page_id::text, p.title, s.position, s.heading_path, s.text, s.embedding::text
    FROM ai.indexed_pages p
    JOIN ai.page_sections s ON s.page_id = p.page_id
    ORDER BY s.position
"""


@contextmanager
def fresh_ai_schema(tmp_path: Path) -> Iterator[None]:
    with psycopg.connect(f"{POSTGRES_SERVER}/postgres", autocommit=True) as server:
        drop_test_database_and_role(server)
        server.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DATABASE)))
        try:
            setup = run_setup(tmp_path)
            assert setup.returncode == 0, setup.stderr
            yield
        finally:
            drop_test_database_and_role(server)


@pytest.fixture
def ai_schema(tmp_path: Path) -> Iterator[None]:
    with fresh_ai_schema(tmp_path):
        yield


def run_alembic(command: str) -> SetupRun:
    completed = subprocess.run(
        command.split(),
        cwd=SERVICE_ROOT,
        env={**os.environ, "AI_DATABASE_URL": AI_URL},
        capture_output=True,
        text=True,
        timeout=120,
    )
    return SetupRun(completed.returncode, completed.stdout, completed.stderr)


def run_migrations() -> SetupRun:
    return run_alembic(MIGRATION_COMMAND)


def migrate() -> None:
    run = run_migrations()
    assert run.returncode == 0, run.stderr


def schemas_holding_index_tables() -> list[tuple[str, str]]:
    return schemas_holding(INDEX_TABLES)


def schemas_holding(tables: list[str]) -> list[tuple[str, str]]:
    with psycopg.connect(ADMIN_URL) as admin:
        return admin.execute(
            """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_name = ANY(%s)
            ORDER BY table_name
            """,
            (tables,),
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


def insert_agent_proposal(ai: psycopg.Connection, status: str = "open") -> None:
    ai.execute(
        """
        INSERT INTO ai.agent_runs (id, user_id, workspace_id, space_id, task)
        VALUES (%s, %s, %s, %s, 'Finde veraltete Seiten')
        ON CONFLICT (id) DO NOTHING
        """,
        (RUN_ID, PAGE_ID, PAGE_ID, PAGE_ID),
    )
    ai.execute(
        """
        INSERT INTO ai.agent_proposals (id, run_id, user_id, page_id, page_title, reason,
            fingerprint, changes, added, removed, status)
        VALUES (%s, %s, %s, %s, 'Urlaub', 'veraltet', 'f', '[]', 1, 1, %s)
        """,
        (PROPOSAL_ID, RUN_ID, PAGE_ID, PAGE_ID, status),
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


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_agent_ac110_upgrade_as_ai_role_creates_the_agent_tables_in_schema_ai():
    migrate()
    assert schemas_holding(AGENT_TABLES) == [("ai", "agent_proposals"), ("ai", "agent_runs")]


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_agent_ac109_proposals_of_a_deleted_run_go_with_it():
    migrate()
    with psycopg.connect(AI_URL, autocommit=True) as ai:
        insert_agent_proposal(ai)
        ai.execute("DELETE FROM ai.agent_runs WHERE id = %s", (RUN_ID,))
        row = ai.execute("SELECT count(*) FROM ai.agent_proposals").fetchone()
    assert row == (0,)


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_agent_ac84_proposal_status_outside_the_five_states_is_refused():
    migrate()
    with (
        psycopg.connect(AI_URL, autocommit=True) as ai,
        pytest.raises(psycopg.errors.CheckViolation),
    ):
        insert_agent_proposal(ai, status="übernommen")


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_agent_ac46_second_proposal_for_a_page_in_one_run_is_refused():
    migrate()
    with psycopg.connect(AI_URL, autocommit=True) as ai:
        insert_agent_proposal(ai)
        with pytest.raises(psycopg.errors.UniqueViolation):
            ai.execute(
                """
                INSERT INTO ai.agent_proposals (id, run_id, user_id, page_id, page_title, reason,
                    fingerprint, changes, added, removed, status)
                VALUES (gen_random_uuid(), %s, %s, %s, 'Urlaub', 'neu', 'f', '[]', 1, 1, 'open')
                """,
                (RUN_ID, PAGE_ID, PAGE_ID),
            )


@pytest.mark.integration
@pytest.mark.usefixtures("ai_schema")
def test_agent_ac110_downgrade_to_the_index_revision_drops_the_agent_tables_and_keeps_the_index():
    migrate()
    with psycopg.connect(AI_URL, autocommit=True) as ai:
        insert_indexed_page(ai)
        before = ai.execute(INDEX_ROWS).fetchall()
    downgrade = run_alembic(f"uv run alembic downgrade {INDEX_REVISION}")
    assert downgrade.returncode == 0, downgrade.stderr
    with psycopg.connect(AI_URL) as ai:
        after = ai.execute(INDEX_ROWS).fetchall()
        version = ai.execute("SELECT version_num FROM ai.alembic_version").fetchall()
    assert schemas_holding(AGENT_TABLES) == []
    assert after == before
    assert version == [(INDEX_REVISION,)]
    migrate()
    assert schemas_holding(AGENT_TABLES) == [("ai", "agent_proposals"), ("ai", "agent_runs")]
