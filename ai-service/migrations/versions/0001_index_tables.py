from alembic import op

revision = "0001_index_tables"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE ai.indexed_pages (
            page_id uuid PRIMARY KEY,
            workspace_id uuid NOT NULL,
            space_id uuid NOT NULL,
            title text NOT NULL,
            page_updated_at timestamptz NOT NULL,
            embedding_model text NOT NULL,
            indexed_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX indexed_pages_space_id_idx ON ai.indexed_pages (space_id)")
    op.execute("CREATE INDEX indexed_pages_workspace_id_idx ON ai.indexed_pages (workspace_id)")
    op.execute(
        """
        CREATE TABLE ai.page_sections (
            id bigserial PRIMARY KEY,
            page_id uuid NOT NULL REFERENCES ai.indexed_pages (page_id) ON DELETE CASCADE,
            position int NOT NULL,
            heading_path text[] NOT NULL DEFAULT '{}',
            attachment_id uuid NULL,
            file_name text NULL,
            pdf_page int NULL,
            text text NOT NULL,
            embedding ai.vector NOT NULL,
            CONSTRAINT page_sections_pdf_fields_check
                CHECK ((attachment_id IS NULL) = (pdf_page IS NULL))
        )
        """
    )
    op.execute("CREATE INDEX page_sections_page_id_idx ON ai.page_sections (page_id)")
    op.execute("CREATE INDEX page_sections_attachment_id_idx ON ai.page_sections (attachment_id)")


def downgrade() -> None:
    op.execute("DROP TABLE ai.page_sections")
    op.execute("DROP TABLE ai.indexed_pages")
