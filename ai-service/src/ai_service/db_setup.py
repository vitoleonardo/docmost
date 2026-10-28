import sys

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from ai_service.db_check import WIKI_SCHEMA, RoleNotIsolatedError, check_database_role
from ai_service.settings import DbSetupSettings

AI_SCHEMA = "ai"
CREATE_OUTSIDE_AI_SCHEMA_MESSAGE = "Database role must not create tables outside schema ai"


class DbSetupError(RuntimeError):
    pass


def ai_role_from(database_url: str) -> tuple[str, str]:
    target = conninfo_to_dict(database_url)
    role = target.get("user")
    password = target.get("password")
    if not role or not password:
        raise DbSetupError("AI_DATABASE_URL must contain the AI role's user name and password")
    return str(role), str(password)


def set_up_role(admin: psycopg.Connection, role: str, password: str) -> str:
    role_id = sql.Identifier(role)
    exists = admin.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
    command = sql.SQL("ALTER" if exists else "CREATE")
    admin.execute(
        sql.SQL("{} ROLE {} WITH LOGIN PASSWORD {}").format(command, role_id, sql.Literal(password))
    )
    schema = sql.Identifier(AI_SCHEMA)
    wiki_schema = sql.Identifier(WIKI_SCHEMA)
    admin.execute(
        sql.SQL("CREATE SCHEMA IF NOT EXISTS {} AUTHORIZATION {}").format(schema, role_id)
    )
    admin.execute(sql.SQL("ALTER SCHEMA {} OWNER TO {}").format(schema, role_id))
    admin.execute(
        sql.SQL("REVOKE ALL ON ALL TABLES IN SCHEMA {} FROM {}").format(wiki_schema, role_id)
    )
    admin.execute(
        sql.SQL("REVOKE ALL ON ALL SEQUENCES IN SCHEMA {} FROM {}").format(wiki_schema, role_id)
    )
    admin.execute(sql.SQL("REVOKE ALL ON SCHEMA {} FROM {}").format(wiki_schema, role_id))
    row = admin.execute("SELECT current_database()").fetchone()
    database = str(row[0]) if row else ""
    admin.execute(
        sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(sql.Identifier(database), role_id)
    )
    return database


def assert_creates_only_in_ai_schema(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        row = conn.execute(
            """
            SELECT EXISTS (
                SELECT 1
                FROM pg_namespace
                WHERE nspname <> %s
                  AND nspname !~ '^pg_(toast_)?temp_'
                  AND has_schema_privilege(oid, 'CREATE')
            )
            """,
            (AI_SCHEMA,),
        ).fetchone()
    if row is None or row[0]:
        raise DbSetupError(CREATE_OUTSIDE_AI_SCHEMA_MESSAGE)


def main() -> None:
    settings = DbSetupSettings()  # pyright: ignore[reportCallIssue]
    try:
        role, password = ai_role_from(settings.ai_database_url)
        with psycopg.connect(settings.ai_db_admin_url) as admin:
            database = set_up_role(admin, role, password)
        check_database_role(settings.ai_database_url)
        assert_creates_only_in_ai_schema(settings.ai_database_url)
    except (DbSetupError, RoleNotIsolatedError) as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
    print(
        f"Role {role} ready in database {database}: owns schema {AI_SCHEMA}, "
        f"no access to tables in schema {WIKI_SCHEMA}"
    )


if __name__ == "__main__":
    main()
