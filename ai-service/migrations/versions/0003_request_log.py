from alembic import op

revision = "0003_request_log"
down_revision = "0002_agent_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai.request_log (
            id uuid PRIMARY KEY,
            created_at timestamptz NOT NULL,
            task text NOT NULL,
            mode text NOT NULL,
            model text NOT NULL,
            prompt_tokens int NULL,
            completion_tokens int NULL,
            latency_ms int NOT NULL,
            cost_usd numeric(18, 6) NULL,
            status text NOT NULL,
            user_pseudonym text NOT NULL,
            workspace_id uuid NOT NULL,
            CONSTRAINT request_log_task_check CHECK (task IN ('ask', 'extraction', 'agent')),
            CONSTRAINT request_log_prompt_tokens_check CHECK (prompt_tokens >= 0),
            CONSTRAINT request_log_completion_tokens_check CHECK (completion_tokens >= 0),
            CONSTRAINT request_log_latency_ms_check CHECK (latency_ms >= 0),
            CONSTRAINT request_log_user_pseudonym_check CHECK (user_pseudonym ~ '^[0-9a-f]{64}$')
        )
        """
    )
    op.execute("CREATE INDEX request_log_created_at_idx ON ai.request_log (created_at)")


def downgrade() -> None:
    op.execute("DROP TABLE ai.request_log")
