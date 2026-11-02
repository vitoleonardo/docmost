from alembic import op

revision = "0002_agent_tables"
down_revision = "0001_index_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai.agent_runs (
            id uuid PRIMARY KEY,
            user_id uuid NOT NULL,
            workspace_id uuid NOT NULL,
            space_id uuid NOT NULL,
            task text NOT NULL,
            steps jsonb NOT NULL DEFAULT '[]',
            outcome text NULL,
            step_count int NOT NULL DEFAULT 0,
            token_count int NOT NULL DEFAULT 0,
            started_at timestamptz NOT NULL DEFAULT now(),
            ended_at timestamptz NULL
        )
        """
    )
    op.execute("CREATE INDEX agent_runs_started_at_idx ON ai.agent_runs (started_at)")
    op.execute("CREATE INDEX agent_runs_user_id_idx ON ai.agent_runs (user_id)")
    op.execute(
        """
        CREATE TABLE ai.agent_proposals (
            id uuid PRIMARY KEY,
            run_id uuid NOT NULL REFERENCES ai.agent_runs (id) ON DELETE CASCADE,
            user_id uuid NOT NULL,
            page_id uuid NOT NULL,
            page_title text NOT NULL,
            reason text NOT NULL,
            fingerprint text NOT NULL,
            changes jsonb NOT NULL,
            added int NOT NULL,
            removed int NOT NULL,
            status text NOT NULL,
            claimed_at timestamptz NULL,
            applied_by uuid NULL,
            applied_at timestamptz NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT agent_proposals_status_check
                CHECK (status IN ('open', 'applying', 'applied', 'discarded', 'stale')),
            CONSTRAINT agent_proposals_run_id_page_id_key UNIQUE (run_id, page_id)
        )
        """
    )
    op.execute("CREATE INDEX agent_proposals_user_id_idx ON ai.agent_proposals (user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE ai.agent_proposals")
    op.execute("DROP TABLE ai.agent_runs")
