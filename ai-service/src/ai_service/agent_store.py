import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal, LiteralString

import psycopg
from psycopg.types.json import Jsonb

from ai_service.proposals import ProposalDraft

RUN_RETENTION = timedelta(days=30)

ProposalStatus = Literal["open", "applying", "applied", "discarded", "stale"]
RunOutcome = Literal[
    "finished",
    "out_of_scope",
    "cancelled",
    "step_limit",
    "time_limit",
    "token_limit",
    "context_too_small",
    "model_failed",
]

RUN_COLUMNS: LiteralString = """
    id::text, user_id::text, workspace_id::text, space_id::text, task, steps, outcome,
    step_count, token_count, started_at, ended_at
"""
PROPOSAL_COLUMNS: LiteralString = """
    p.id::text, p.run_id::text, p.user_id::text, p.page_id::text, p.page_title, r.space_id::text,
    p.reason, p.fingerprint, p.changes, p.added, p.removed, p.status, p.claimed_at,
    p.applied_by::text, p.applied_at, p.created_at
"""
TRANSITIONS: dict[ProposalStatus, tuple[LiteralString, LiteralString]] = {
    "applying": (
        "status = 'open' OR (status = 'applying' AND claimed_at < now() - interval '60 seconds')",
        "claimed_at = now()",
    ),
    "applied": ("status = 'applying'", "applied_by = %(user_id)s, applied_at = now()"),
    "open": ("status = 'applying'", "claimed_at = NULL"),
    "stale": ("status IN ('open', 'applying')", "claimed_at = NULL"),
    "discarded": ("status = 'open'", "claimed_at = NULL"),
}


@dataclass(frozen=True)
class StoredRun:
    id: str
    user_id: str
    workspace_id: str
    space_id: str
    task: str
    steps: list[dict[str, Any]]
    outcome: RunOutcome | None
    step_count: int
    token_count: int
    started_at: datetime
    ended_at: datetime | None


@dataclass(frozen=True)
class StoredProposal:
    id: str
    run_id: str
    user_id: str
    page_id: str
    page_title: str
    space_id: str
    reason: str
    fingerprint: str
    changes: list[dict[str, Any]]
    added: int
    removed: int
    status: ProposalStatus
    claimed_at: datetime | None
    applied_by: str | None
    applied_at: datetime | None
    created_at: datetime


class ProposalNotFound(Exception):
    pass


class ProposalNotOpen(Exception):
    pass


class AgentStore:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def create_run(
        self, run_id: str, user_id: str, workspace_id: str, space_id: str, task: str
    ) -> None:
        with self._conn.transaction():
            self._conn.execute(
                """
                INSERT INTO ai.agent_runs (id, user_id, workspace_id, space_id, task)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (run_id, user_id, workspace_id, space_id, task),
            )

    def append_step(self, run_id: str, label: dict[str, Any], step_count: int) -> None:
        with self._conn.transaction():
            self._conn.execute(
                """
                UPDATE ai.agent_runs SET steps = steps || %s, step_count = %s WHERE id = %s
                """,
                (Jsonb([label]), step_count, run_id),
            )

    def end_run(self, run_id: str, outcome: RunOutcome, step_count: int, token_count: int) -> None:
        with self._conn.transaction():
            self._conn.execute(
                """
                UPDATE ai.agent_runs
                SET outcome = %s, step_count = %s, token_count = %s, ended_at = now()
                WHERE id = %s
                """,
                (outcome, step_count, token_count, run_id),
            )

    def get_run(self, run_id: str) -> StoredRun | None:
        with self._conn.transaction():
            row = self._conn.execute(
                f"SELECT {RUN_COLUMNS} FROM ai.agent_runs WHERE id = %s", (run_id,)
            ).fetchone()
        return None if row is None else StoredRun(*row)

    def save_proposal(self, run_id: str, user_id: str, draft: ProposalDraft) -> StoredProposal:
        with self._conn.transaction():
            row = self._conn.execute(
                f"""
                WITH p AS (
                    INSERT INTO ai.agent_proposals (id, run_id, user_id, page_id, page_title,
                        reason, fingerprint, changes, added, removed, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open')
                    RETURNING *
                )
                SELECT {PROPOSAL_COLUMNS} FROM p JOIN ai.agent_runs r ON r.id = p.run_id
                """,
                (
                    str(uuid.uuid4()),
                    run_id,
                    user_id,
                    draft.page_id,
                    draft.page_title,
                    draft.reason,
                    draft.fingerprint,
                    Jsonb([change.to_json() for change in draft.changes]),
                    draft.added,
                    draft.removed,
                ),
            ).fetchone()
        assert row is not None
        return StoredProposal(*row)

    def get_proposal(self, proposal_id: str, user_id: str) -> StoredProposal | None:
        with self._conn.transaction():
            row = self._conn.execute(
                f"""
                SELECT {PROPOSAL_COLUMNS}
                FROM ai.agent_proposals p
                JOIN ai.agent_runs r ON r.id = p.run_id
                WHERE p.id = %s AND p.user_id = %s
                """,
                (proposal_id, user_id),
            ).fetchone()
        return None if row is None else StoredProposal(*row)

    def transition(self, proposal_id: str, user_id: str, to: ProposalStatus) -> StoredProposal:
        allowed_source, assignments = TRANSITIONS[to]
        parameters = {"proposal_id": proposal_id, "user_id": user_id, "to": to}
        with self._conn.transaction():
            row = self._conn.execute(
                f"""
                WITH p AS (
                    UPDATE ai.agent_proposals
                    SET status = %(to)s, {assignments}
                    WHERE id = %(proposal_id)s AND user_id = %(user_id)s AND ({allowed_source})
                    RETURNING *
                )
                SELECT {PROPOSAL_COLUMNS} FROM p JOIN ai.agent_runs r ON r.id = p.run_id
                """,
                parameters,
            ).fetchone()
            if row is not None:
                return StoredProposal(*row)
            owned = self._conn.execute(
                "SELECT 1 FROM ai.agent_proposals WHERE id = %(proposal_id)s"
                " AND user_id = %(user_id)s",
                parameters,
            ).fetchone()
        if owned is None:
            raise ProposalNotFound(proposal_id)
        raise ProposalNotOpen(proposal_id)

    def delete_runs_started_before(self, cutoff: datetime) -> int:
        with self._conn.transaction():
            deleted = self._conn.execute(
                "DELETE FROM ai.agent_runs WHERE started_at < %s", (cutoff,)
            ).rowcount
        return deleted
