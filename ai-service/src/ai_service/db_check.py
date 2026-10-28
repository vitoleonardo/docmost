import psycopg

WIKI_SCHEMA = "public"
ROLE_NOT_ISOLATED_MESSAGE = "Database role must not read wiki tables"


class RoleNotIsolatedError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(ROLE_NOT_ISOLATED_MESSAGE)


def assert_role_isolated(conn: psycopg.Connection) -> None:
    row = conn.execute(
        """
        SELECT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = %s
              AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND has_table_privilege(c.oid, 'SELECT, INSERT, UPDATE, DELETE')
        )
        """,
        (WIKI_SCHEMA,),
    ).fetchone()
    if row is None or row[0]:
        raise RoleNotIsolatedError()


def check_database_role(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        assert_role_isolated(conn)
