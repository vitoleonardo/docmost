# Review round 2 (reviewer, opus), base m3-ai-bridge, head before fixes a5da57b1..d4e86376

Verdict: no high findings. Round-1 highs (INDEX-AC12 test bypass, INDEX-AC48 unsigned cursor) hold.

## Findings
1. [medium] `ai-page-list.service.ts` + `ai-bridge-internal.dto.ts`: `{"cursor": null}` → TypeError → 500 (INDEX-AC48). Fixed in 5394ca35 (null = start), unit + e2e tests.
2. [medium] `index_store.py` search: NaN predicate could compute distances on another model's sections before the model join → `different vector dimensions` (INDEX-AC20, AC37). Fixed in 5394ca35 (MATERIALIZED CTE), integration test red on old SQL.
3. [medium] `tests/test_stack.py` INDEX-AC23 rewritten in round 1, not yet run. Run in verify.
4. [low] worker: initial reconcile after an unreachable wiki waits 600 s. Not fixed.
5. [low] worker start: Postgres unreachable → traceback, not one line. Not fixed.
6. [low] `db_setup.py:40`: `vector` already in another schema is not detected. Not fixed.
7. [low] `indexer.py`: PDFs embedded before `kept-newer` decision. Not fixed.
8. [low] runbook stack variable list. Fixed in 5394ca35.

## Criteria
- Met in the fast suite: AC5–AC11, AC44, AC47, AC48, AC62, AC63, AC66–AC68, AC70–AC72, AC76, AC77.
- Not verifiable from the diff alone (integration, e2e, stack): the rest; run in verify.

## Checks (reviewer)
- typecheck: 1 legacy error (baseline). lint: feature paths clean. ai-service fast 139 passed; client 441 passed; server 1204 run, 14 legacy failures. structure: pass.

# Review round 3 (scoped to fixes 5394ca35..cb533207)
- high: test_worker.py:442 asserted the old literal after the rename (vacuous). Fixed b88b8dd4.
- low: test_bridge_client imports from tests.conftest. Not fixed.
- Search CTE, null cursor, stack fail, runbook: verified correct.

# Review round 4 (b88b8dd4)
No findings. Ready for verify: yes.
