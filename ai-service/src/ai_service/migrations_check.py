from pathlib import Path

import psycopg
from alembic.script import ScriptDirectory

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
MIGRATION_COMMAND = "uv run alembic upgrade head"


class MigrationsMissingError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(f"Index tables are missing or out of date. Run: {MIGRATION_COMMAND}")


def assert_migrated(conn: psycopg.Connection) -> None:
    heads = set(ScriptDirectory(str(MIGRATIONS_DIR)).get_heads())
    row = conn.execute("SELECT to_regclass('ai.alembic_version') IS NOT NULL").fetchone()
    if row is None or not row[0]:
        raise MigrationsMissingError()
    applied = {version for (version,) in conn.execute("SELECT version_num FROM ai.alembic_version")}
    if applied != heads:
        raise MigrationsMissingError()
