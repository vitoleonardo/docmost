from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, make_url, pool

from ai_service.db_setup import AI_SCHEMA
from ai_service.settings import MigrationSettings

if context.config.config_file_name is not None:
    fileConfig(context.config.config_file_name)


def run_migrations_online() -> None:
    settings = MigrationSettings()  # pyright: ignore[reportCallIssue]
    url = make_url(settings.ai_database_url).set(drivername="postgresql+psycopg")
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, version_table_schema=AI_SCHEMA)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
