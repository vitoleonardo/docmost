import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import psycopg
import pytest

from ai_service.agent_store import (
    RUN_RETENTION,
    AgentStore,
    ProposalNotFound,
    ProposalNotOpen,
    ProposalStatus,
    StoredProposal,
)
from ai_service.proposals import Change, DiffOp, ProposalDraft
from tests.test_db_role import AI_URL
from tests.test_migrations import fresh_ai_schema, migrate

pytestmark = pytest.mark.integration

USER = "0192f000-0000-7000-8000-0000000000e1"
OTHER_USER = "0192f000-0000-7000-8000-0000000000e2"
WORKSPACE = "0192f000-0000-7000-8000-0000000000e3"
SPACE = "0192f000-0000-7000-8000-0000000000e4"
PAGE = "0192f000-0000-7000-8000-0000000000e5"
SECOND_PAGE = "0192f000-0000-7000-8000-0000000000e6"
UNKNOWN_PROPOSAL = "0192f000-0000-7000-8000-0000000000e7"
NOW = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)
STATUSES: list[ProposalStatus] = ["open", "applying", "applied", "discarded", "stale"]
ALLOWED: set[tuple[ProposalStatus, ProposalStatus]] = {
    ("open", "applying"),
    ("applying", "applied"),
    ("applying", "open"),
    ("open", "stale"),
    ("applying", "stale"),
    ("open", "discarded"),
}
REFUSED = [
    (source, target)
    for source in STATUSES
    for target in STATUSES
    if (source, target) not in ALLOWED and (source, target) != ("applying", "applying")
]


def run_id(number: int) -> str:
    return f"0192f000-0000-7000-8000-{number:012d}"


def draft(page_id: str = PAGE) -> ProposalDraft:
    change = Change(
        block=3,
        heading="Kilometerpauschale",
        old_text="0,30 € pro Kilometer",
        new_text="0,38 € pro Kilometer",
        ops=(DiffOp("remove", "0,30"), DiffOp("add", "0,38"), DiffOp("keep", " € pro Kilometer")),
    )
    return ProposalDraft(
        page_id=page_id,
        page_title="Reisekosten Richtlinie 2022",
        fingerprint="fingerprint-1",
        reason="Kilometerpauschale ist veraltet",
        changes=(change,),
        added=1,
        removed=1,
    )


@pytest.fixture(scope="module")
def database(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    with fresh_ai_schema(tmp_path_factory.mktemp("agent-store")):
        migrate()
        yield


@pytest.fixture
def raw(database: None) -> Iterator[psycopg.Connection]:
    with psycopg.connect(AI_URL, autocommit=True) as conn:
        conn.execute("TRUNCATE ai.agent_runs CASCADE")
        yield conn


@pytest.fixture
def agent_store(raw: psycopg.Connection) -> AgentStore:
    return AgentStore(raw)


def started_run(agent_store: AgentStore, number: int = 1, user_id: str = USER) -> str:
    run = run_id(number)
    agent_store.create_run(run, user_id, WORKSPACE, SPACE, "Finde veraltete Seiten")
    return run


def open_proposal(agent_store: AgentStore) -> StoredProposal:
    return agent_store.save_proposal(started_run(agent_store), USER, draft())


def force_status(
    raw: psycopg.Connection, proposal_id: str, status: str, claimed_seconds_ago: int | None = None
) -> None:
    raw.execute(
        """
        UPDATE ai.agent_proposals
        SET status = %s,
            claimed_at = CASE WHEN %s::int IS NULL THEN NULL
                ELSE now() - make_interval(secs => %s::int) END
        WHERE id = %s
        """,
        (status, claimed_seconds_ago, claimed_seconds_ago, proposal_id),
    )


def database_now(raw: psycopg.Connection) -> datetime:
    row = raw.execute("SELECT now()").fetchone()
    assert row is not None
    return row[0]


def columns_of(raw: psycopg.Connection, table: str) -> set[str]:
    rows = raw.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'ai' AND table_name = %s
        """,
        (table,),
    ).fetchall()
    return {name for (name,) in rows}


def test_agent_ac82_applied_proposal_records_user_run_page_and_time(
    agent_store: AgentStore, raw: psycopg.Connection
):
    proposal = open_proposal(agent_store)
    agent_store.transition(proposal.id, USER, "applying")
    before = database_now(raw)
    agent_store.transition(proposal.id, USER, "applied")
    after = database_now(raw)

    stored = agent_store.get_proposal(proposal.id, USER)

    assert stored is not None
    assert stored.status == "applied"
    assert stored.applied_by == USER
    assert stored.run_id == run_id(1)
    assert stored.page_id == PAGE
    assert stored.applied_at is not None
    assert before <= stored.applied_at <= after


def test_agent_ac82_saved_proposal_is_open_and_holds_the_draft_and_the_run_space(
    agent_store: AgentStore,
):
    proposal = open_proposal(agent_store)

    assert proposal.status == "open"
    assert proposal.user_id == USER
    assert proposal.space_id == SPACE
    assert proposal.page_title == "Reisekosten Richtlinie 2022"
    assert proposal.reason == "Kilometerpauschale ist veraltet"
    assert proposal.fingerprint == "fingerprint-1"
    assert proposal.changes == [change.to_json() for change in draft().changes]
    assert (proposal.added, proposal.removed) == (1, 1)
    assert proposal.applied_by is None and proposal.applied_at is None
    assert agent_store.get_proposal(proposal.id, USER) == proposal


def test_agent_ac46_second_proposal_for_a_page_in_one_run_is_refused_by_the_store(
    agent_store: AgentStore,
):
    first = open_proposal(agent_store)

    with pytest.raises(psycopg.errors.UniqueViolation):
        agent_store.save_proposal(first.run_id, USER, draft())
    second_page = agent_store.save_proposal(first.run_id, USER, draft(SECOND_PAGE))

    assert agent_store.get_proposal(first.id, USER) == first
    assert second_page.page_id == SECOND_PAGE


@pytest.mark.parametrize("source", ["applied", "discarded"])
@pytest.mark.parametrize("target", ["applying", "discarded"])
def test_agent_ac84_applied_or_discarded_proposal_cannot_be_claimed_or_discarded(
    agent_store: AgentStore, raw: psycopg.Connection, source: str, target: ProposalStatus
):
    proposal = open_proposal(agent_store)
    force_status(raw, proposal.id, source)

    with pytest.raises(ProposalNotOpen):
        agent_store.transition(proposal.id, USER, target)

    stored = agent_store.get_proposal(proposal.id, USER)
    assert stored is not None and stored.status == source


@pytest.mark.parametrize(("source", "target"), REFUSED)
def test_agent_ac84_transition_outside_the_allowed_set_leaves_the_proposal_unchanged(
    agent_store: AgentStore, raw: psycopg.Connection, source: str, target: ProposalStatus
):
    proposal = open_proposal(agent_store)
    force_status(raw, proposal.id, source, 0 if source == "applying" else None)
    before = agent_store.get_proposal(proposal.id, USER)

    with pytest.raises(ProposalNotOpen):
        agent_store.transition(proposal.id, USER, target)

    assert agent_store.get_proposal(proposal.id, USER) == before


@pytest.mark.parametrize(("source", "target"), sorted(ALLOWED))
def test_agent_ac84_every_allowed_transition_succeeds(
    agent_store: AgentStore, raw: psycopg.Connection, source: str, target: ProposalStatus
):
    proposal = open_proposal(agent_store)
    force_status(raw, proposal.id, source, 0 if source == "applying" else None)

    moved = agent_store.transition(proposal.id, USER, target)

    assert moved.status == target
    assert agent_store.get_proposal(proposal.id, USER) == moved


def test_agent_ac85_claim_sets_claimed_at(agent_store: AgentStore):
    proposal = open_proposal(agent_store)

    claimed = agent_store.transition(proposal.id, USER, "applying")

    assert claimed.status == "applying"
    assert claimed.claimed_at is not None


def test_agent_ac85_two_concurrent_claims_let_exactly_one_win(
    agent_store: AgentStore, raw: psycopg.Connection
):
    proposal = open_proposal(agent_store)
    outcomes: list[str] = []
    ready = threading.Barrier(2)

    def claim() -> None:
        with psycopg.connect(AI_URL, autocommit=True) as conn:
            ready.wait()
            try:
                AgentStore(conn).transition(proposal.id, USER, "applying")
                outcomes.append("claimed")
            except ProposalNotOpen:
                outcomes.append("not_open")

    with psycopg.connect(AI_URL, autocommit=True) as holder, holder.transaction():
        holder.execute("SELECT 1 FROM ai.agent_proposals WHERE id = %s FOR UPDATE", (proposal.id,))
        claims = [threading.Thread(target=claim) for _ in range(2)]
        for thread in claims:
            thread.start()
        wait_for_lock_waiters(raw, 2)
    for thread in claims:
        thread.join(timeout=10)

    assert sorted(outcomes) == ["claimed", "not_open"]


def wait_for_lock_waiters(raw: psycopg.Connection, count: int) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        row = raw.execute(
            """
            SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
            """
        ).fetchone()
        if row is not None and row[0] >= count:
            return
        time.sleep(0.02)
    raise AssertionError(f"fewer than {count} claims waited for the row lock")


def test_agent_ac85_abandoned_claim_older_than_60_seconds_can_be_claimed_again(
    agent_store: AgentStore, raw: psycopg.Connection
):
    proposal = open_proposal(agent_store)
    agent_store.transition(proposal.id, USER, "applying")
    force_status(raw, proposal.id, "applying", 61)
    abandoned = agent_store.get_proposal(proposal.id, USER)

    reclaimed = agent_store.transition(proposal.id, USER, "applying")

    assert abandoned is not None and abandoned.claimed_at is not None
    assert reclaimed.status == "applying"
    assert reclaimed.claimed_at is not None
    assert reclaimed.claimed_at > abandoned.claimed_at


def test_agent_ac85_claim_younger_than_60_seconds_cannot_be_claimed_again(
    agent_store: AgentStore, raw: psycopg.Connection
):
    proposal = open_proposal(agent_store)
    agent_store.transition(proposal.id, USER, "applying")
    force_status(raw, proposal.id, "applying", 59)

    with pytest.raises(ProposalNotOpen):
        agent_store.transition(proposal.id, USER, "applying")


def test_agent_ac87_failed_write_reopens_the_proposal_and_clears_the_claim(
    agent_store: AgentStore,
):
    proposal = open_proposal(agent_store)
    agent_store.transition(proposal.id, USER, "applying")

    reopened = agent_store.transition(proposal.id, USER, "open")
    claimed_again = agent_store.transition(proposal.id, USER, "applying")

    assert reopened.status == "open"
    assert reopened.claimed_at is None
    assert claimed_again.status == "applying"


@pytest.mark.parametrize("source", ["open", "applying"])
def test_agent_ac96_stale_proposal_cannot_be_claimed(
    agent_store: AgentStore, raw: psycopg.Connection, source: str
):
    proposal = open_proposal(agent_store)
    force_status(raw, proposal.id, source, 0 if source == "applying" else None)
    agent_store.transition(proposal.id, USER, "stale")

    with pytest.raises(ProposalNotOpen):
        agent_store.transition(proposal.id, USER, "applying")
    force_status(raw, proposal.id, "stale", 61)
    with pytest.raises(ProposalNotOpen):
        agent_store.transition(proposal.id, USER, "applying")


def test_agent_ac102_proposal_of_another_user_is_not_found(agent_store: AgentStore):
    proposal = open_proposal(agent_store)

    assert agent_store.get_proposal(proposal.id, OTHER_USER) is None
    assert agent_store.get_proposal(UNKNOWN_PROPOSAL, USER) is None
    with pytest.raises(ProposalNotFound):
        agent_store.transition(proposal.id, OTHER_USER, "applying")
    with pytest.raises(ProposalNotFound):
        agent_store.transition(UNKNOWN_PROPOSAL, USER, "discarded")
    stored = agent_store.get_proposal(proposal.id, USER)
    assert stored is not None and stored.status == "open"


def test_agent_ac109_run_started_30_days_and_1_minute_ago_goes_with_its_proposals(
    agent_store: AgentStore, raw: psycopg.Connection
):
    old_run = started_run(agent_store, 1)
    kept_run = started_run(agent_store, 2)
    agent_store.append_step(old_run, {"kind": "read", "title": "Reisekosten"}, 1)
    old_proposal = agent_store.save_proposal(old_run, USER, draft())
    kept_proposal = agent_store.save_proposal(kept_run, USER, draft())
    raw.execute(
        "UPDATE ai.agent_runs SET started_at = %s WHERE id = %s",
        (NOW - RUN_RETENTION - timedelta(minutes=1), old_run),
    )
    raw.execute(
        "UPDATE ai.agent_runs SET started_at = %s WHERE id = %s",
        (NOW - timedelta(days=29), kept_run),
    )

    deleted = agent_store.delete_runs_started_before(NOW - RUN_RETENTION)

    assert deleted == 1
    assert agent_store.get_run(old_run) is None
    assert agent_store.get_proposal(old_proposal.id, USER) is None
    assert agent_store.get_run(kept_run) is not None
    assert agent_store.get_proposal(kept_proposal.id, USER) == kept_proposal


def test_agent_ac109_retention_keeps_a_run_started_exactly_at_the_cutoff(
    agent_store: AgentStore, raw: psycopg.Connection
):
    run = started_run(agent_store)
    raw.execute("UPDATE ai.agent_runs SET started_at = %s WHERE id = %s", (NOW, run))

    assert agent_store.delete_runs_started_before(NOW) == 0
    assert agent_store.get_run(run) is not None


def test_agent_ac110_run_records_task_space_steps_and_outcome_only(agent_store: AgentStore):
    run = started_run(agent_store)
    agent_store.append_step(run, {"kind": "search", "query": "Reisekosten", "count": 2}, 1)
    agent_store.append_step(run, {"kind": "refused"}, 2)
    agent_store.end_run(run, "finished", 2, 1234)

    stored = agent_store.get_run(run)

    assert stored is not None
    assert (stored.user_id, stored.workspace_id, stored.space_id) == (USER, WORKSPACE, SPACE)
    assert stored.task == "Finde veraltete Seiten"
    assert stored.steps == [
        {"kind": "search", "query": "Reisekosten", "count": 2},
        {"kind": "refused"},
    ]
    assert (stored.outcome, stored.step_count, stored.token_count) == ("finished", 2, 1234)
    assert stored.ended_at is not None and stored.ended_at >= stored.started_at


def test_agent_ac110_running_run_has_no_outcome_and_no_end(agent_store: AgentStore):
    run = started_run(agent_store)

    stored = agent_store.get_run(run)

    assert stored is not None
    assert (stored.steps, stored.outcome, stored.step_count, stored.token_count) == ([], None, 0, 0)
    assert stored.ended_at is None


def test_agent_ac110_store_has_no_column_for_messages_or_other_page_text(raw: psycopg.Connection):
    tables = raw.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'ai'"
        " AND table_name LIKE 'agent%' ORDER BY table_name"
    ).fetchall()

    assert tables == [("agent_proposals",), ("agent_runs",)]
    assert columns_of(raw, "agent_runs") == {
        "id",
        "user_id",
        "workspace_id",
        "space_id",
        "task",
        "steps",
        "outcome",
        "step_count",
        "token_count",
        "started_at",
        "ended_at",
    }
    assert columns_of(raw, "agent_proposals") == {
        "id",
        "run_id",
        "user_id",
        "page_id",
        "page_title",
        "reason",
        "fingerprint",
        "changes",
        "added",
        "removed",
        "status",
        "claimed_at",
        "applied_by",
        "applied_at",
        "created_at",
    }
