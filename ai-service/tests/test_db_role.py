import os
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, LiteralString

import psycopg
import pytest
from psycopg import sql

import ai_service.__main__ as entry
from ai_service.db_check import ROLE_NOT_ISOLATED_MESSAGE, RoleNotIsolatedError
from tests.conftest import BRIDGE_SECRET, SERVICE_TOKEN, TEST_REDIS_URL, make_settings

POSTGRES_SERVER = "postgresql://docmost:docmost@127.0.0.1:5433"
TEST_DATABASE = "docmost_ai_role_test"
TEST_ROLE = "docmost_ai_test"
TEST_ROLE_PASSWORD = "test-ai-role-password"
ADMIN_URL = f"{POSTGRES_SERVER}/{TEST_DATABASE}"
AI_URL = f"postgresql://{TEST_ROLE}:{TEST_ROLE_PASSWORD}@127.0.0.1:5433/{TEST_DATABASE}"
PAGE_ID = "0192f000-0000-7000-8000-0000000000aa"
WIKI_ROW_CHANGES: list[LiteralString] = [
    "INSERT INTO public.pages VALUES ('0192f000-0000-7000-8000-0000000000bb', 'x')",
    "UPDATE public.pages SET title = 'changed'",
    "DELETE FROM public.pages",
]
WIKI_TABLE_STATEMENTS: list[LiteralString] = ["SELECT * FROM public.pages", *WIKI_ROW_CHANGES]


@dataclass
class SetupRun:
    returncode: int
    stdout: str
    stderr: str


def drop_test_database_and_role(server: psycopg.Connection) -> None:
    server.execute(
        sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DATABASE))
    )
    server.execute(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(TEST_ROLE)))


@pytest.fixture
def wiki_database() -> Iterator[str]:
    with psycopg.connect(f"{POSTGRES_SERVER}/postgres", autocommit=True) as server:
        drop_test_database_and_role(server)
        server.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DATABASE)))
        with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
            admin.execute("CREATE TABLE public.pages (id uuid PRIMARY KEY, title text)")
            admin.execute("INSERT INTO public.pages VALUES (%s, %s)", (PAGE_ID, "Wiki page"))
        try:
            yield ADMIN_URL
        finally:
            drop_test_database_and_role(server)


def run_module(module: str, cwd: Path, **env: str) -> SetupRun:
    completed = subprocess.run(
        [sys.executable, "-m", module],
        cwd=cwd,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        timeout=20,
    )
    return SetupRun(completed.returncode, completed.stdout, completed.stderr)


def run_setup(cwd: Path) -> SetupRun:
    return run_module("ai_service.db_setup", cwd, AI_DB_ADMIN_URL=ADMIN_URL, AI_DATABASE_URL=AI_URL)


def connect_as_ai_role() -> psycopg.Connection:
    return psycopg.connect(AI_URL, autocommit=True)


def assert_wiki_table_refused(ai: psycopg.Connection) -> None:
    for statement in WIKI_TABLE_STATEMENTS:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            ai.execute(statement)


@pytest.fixture
def set_up(wiki_database: str, tmp_path: Path) -> SetupRun:
    run = run_setup(tmp_path)
    assert run.returncode == 0, run.stderr
    return run


@pytest.mark.integration
def test_bridge_ac32_ai_role_creates_and_drops_a_table_in_schema_ai(set_up: SetupRun):
    with connect_as_ai_role() as ai:
        ai.execute("CREATE TABLE ai.probe (id int)")
        ai.execute("INSERT INTO ai.probe VALUES (1)")
        ai.execute("DROP TABLE ai.probe")
        row = ai.execute("SELECT to_regclass('ai.probe')").fetchone()
    assert row == (None,)


@pytest.mark.integration
def test_bridge_ac32_ai_role_owns_schema_ai(set_up: SetupRun):
    with psycopg.connect(ADMIN_URL) as admin:
        row = admin.execute(
            "SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'ai'"
        ).fetchone()
    assert row == (TEST_ROLE,)


@pytest.mark.integration
def test_bridge_ac33_ai_role_cannot_read_wiki_table(set_up: SetupRun):
    with connect_as_ai_role() as ai, pytest.raises(psycopg.errors.InsufficientPrivilege):
        ai.execute("SELECT * FROM public.pages")


@pytest.mark.integration
@pytest.mark.parametrize("statement", WIKI_ROW_CHANGES)
def test_bridge_ac34_ai_role_cannot_change_wiki_rows(set_up: SetupRun, statement: LiteralString):
    with connect_as_ai_role() as ai, pytest.raises(psycopg.errors.InsufficientPrivilege):
        ai.execute(statement)
    with psycopg.connect(ADMIN_URL) as admin:
        rows = admin.execute("SELECT id::text, title FROM public.pages").fetchall()
    assert rows == [(PAGE_ID, "Wiki page")]


@pytest.mark.integration
def test_bridge_ac77_ai_role_cannot_create_a_table_in_schema_public(set_up: SetupRun):
    with connect_as_ai_role() as ai, pytest.raises(psycopg.errors.InsufficientPrivilege):
        ai.execute("CREATE TABLE public.x (id int)")


@pytest.mark.integration
def test_bridge_ac78_setup_twice_exits_zero_and_keeps_isolation(wiki_database: str, tmp_path: Path):
    first = run_setup(tmp_path)
    second = run_setup(tmp_path)
    assert (first.returncode, second.returncode) == (0, 0), second.stderr
    with connect_as_ai_role() as ai:
        ai.execute("CREATE TABLE ai.probe (id int)")
        ai.execute("DROP TABLE ai.probe")
        assert_wiki_table_refused(ai)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            ai.execute("CREATE TABLE public.x (id int)")


@pytest.mark.integration
def test_bridge_ac78_setup_prints_one_line_without_the_password(wiki_database: str, tmp_path: Path):
    run = run_setup(tmp_path)
    assert run.returncode == 0, run.stderr
    assert len(run.stdout.strip().splitlines()) == 1
    assert TEST_ROLE in run.stdout
    assert TEST_ROLE_PASSWORD not in run.stdout + run.stderr


@pytest.mark.integration
def test_bridge_ac78_rerun_removes_privileges_granted_in_between(
    wiki_database: str, tmp_path: Path
):
    assert run_setup(tmp_path).returncode == 0
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute(sql.SQL("GRANT ALL ON public.pages TO {}").format(sql.Identifier(TEST_ROLE)))
        admin.execute(
            sql.SQL("GRANT CREATE ON SCHEMA public TO {}").format(sql.Identifier(TEST_ROLE))
        )
        admin.execute(
            sql.SQL("ALTER ROLE {} PASSWORD 'other-test-password'").format(
                sql.Identifier(TEST_ROLE)
            )
        )
    assert run_setup(tmp_path).returncode == 0
    with connect_as_ai_role() as ai:
        assert_wiki_table_refused(ai)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            ai.execute("CREATE TABLE public.x (id int)")


@pytest.mark.integration
def test_bridge_ac78_rerun_gives_back_an_ai_schema_owned_by_someone_else(
    wiki_database: str, tmp_path: Path
):
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute("CREATE SCHEMA ai")
    assert run_setup(tmp_path).returncode == 0
    with connect_as_ai_role() as ai:
        ai.execute("CREATE TABLE ai.probe (id int)")
        ai.execute("DROP TABLE ai.probe")


@pytest.mark.integration
def test_bridge_ac33_setup_fails_when_public_grants_expose_wiki_tables(
    wiki_database: str, tmp_path: Path
):
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute("GRANT SELECT ON public.pages TO PUBLIC")
    run = run_setup(tmp_path)
    assert run.returncode == 1
    assert ROLE_NOT_ISOLATED_MESSAGE in run.stderr


@pytest.mark.integration
def test_bridge_ac77_setup_fails_when_everyone_may_create_in_schema_public(
    wiki_database: str, tmp_path: Path
):
    with psycopg.connect(ADMIN_URL, autocommit=True) as admin:
        admin.execute("GRANT CREATE ON SCHEMA public TO PUBLIC")
    run = run_setup(tmp_path)
    assert run.returncode == 1
    assert "Database role must not create tables outside schema ai" in run.stderr


@pytest.mark.integration
def test_bridge_ac76_startup_refuses_a_role_that_reads_wiki_tables(
    wiki_database: str, tmp_path: Path
):
    run = run_module(
        "ai_service",
        tmp_path,
        AI_BRIDGE_SECRET=BRIDGE_SECRET,
        AI_SERVICE_TOKEN=SERVICE_TOKEN,
        REDIS_URL=TEST_REDIS_URL,
        AI_DATABASE_URL=wiki_database,
        AI_SERVICE_PORT="0",
    )
    assert run.returncode == 1
    assert ROLE_NOT_ISOLATED_MESSAGE in run.stderr


@pytest.mark.integration
def test_bridge_ac76_startup_accepts_the_isolated_ai_role(
    set_up: SetupRun, monkeypatch: pytest.MonkeyPatch
):
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(entry, "load_settings", lambda: make_settings(ai_database_url=AI_URL))
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: calls.append(kwargs))
    entry.main()
    assert len(calls) == 1


def test_bridge_ac76_failed_role_check_exits_1_with_the_message(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    calls: list[dict[str, Any]] = []

    def refuse(database_url: str) -> None:
        raise RoleNotIsolatedError()

    monkeypatch.setattr(entry, "load_settings", lambda: make_settings())
    monkeypatch.setattr(entry, "check_database_role", refuse)
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: calls.append(kwargs))
    with pytest.raises(SystemExit) as exit_info:
        entry.main()
    assert exit_info.value.code == 1
    assert capsys.readouterr().err.strip() == "Database role must not read wiki tables"
    assert calls == []


def test_bridge_ac76_role_check_uses_the_configured_database_url(
    monkeypatch: pytest.MonkeyPatch,
):
    checked: list[str] = []
    monkeypatch.setattr(entry, "load_settings", lambda: make_settings(ai_database_url=AI_URL))
    monkeypatch.setattr(entry, "check_database_role", checked.append)
    monkeypatch.setattr(entry.uvicorn, "run", lambda *args, **kwargs: None)
    entry.main()
    assert checked == [AI_URL]
