from collections.abc import Iterator
from contextlib import contextmanager

import psycopg

INDEX_WRITER_LOCK_KEY = "ai-index-writer"


@contextmanager
def index_writer_lock(conn: psycopg.Connection) -> Iterator[None]:
    conn.execute("SELECT pg_advisory_lock(hashtext(%s))", (INDEX_WRITER_LOCK_KEY,))
    try:
        yield
    finally:
        conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (INDEX_WRITER_LOCK_KEY,))
