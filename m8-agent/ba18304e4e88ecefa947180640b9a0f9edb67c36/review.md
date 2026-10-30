# Review round 2 (reviewer, opus), 30.10.2026

Base: m7-extraction. Verdict: no high or medium findings. Ready for PR from the review side. Round 1 outcome: no high findings, mediums fixed or accepted (see Decisions to review in .work/m8-agent.md).

## Criteria
| Criterion | Verdict | Evidence |
|---|---|---|
| AGENT-AC1, AC3, AC12–AC15 | pass | `components/ai-assistant.test.tsx` |
| AGENT-AC2, AC4–AC11, AC17–AC22 | pass | `components/agent-task-tab.test.tsx`, `test_agent.py` |
| AGENT-AC16 | pass | unit test; browser flow `agent.screenshots.ts` sends only the `run` event, asserts "Schritt 0 von höchstens 20", no step lines, "Abbrechen" |
| AGENT-AC24 | pass | `test_agent.py`; browser flow checks search line above read line and "Schritt 2 von höchstens 20" |
| AGENT-AC23, AC25–AC47, AC49–AC58, AC60–AC64, AC67–AC81, AC83–AC88, AC90–AC117 | as round 1 | no code behind them changed; e2e-only and integration-only parts not run by the reviewer (run in verify) |
| AGENT-AC48 | pass | fixture reads 5 distinct titles, `pagesRead: 5`; card order now asserted (fe23dcc7, after finding 1) |
| AGENT-AC59 | pass | round-1 caveat fixed: `test_agent_ac59_the_deadline_closes_the_connection_to_the_model` |
| AGENT-AC65, AC66 | pass | round-1 tests plus three `test_agent_ac66_*` in `test_inference.py` |
| AGENT-AC82 | wiki side pass; store side integration-only | `ai-agent-proposal.service.spec.ts` "a view after the write of an apply in flight…" |
| AGENT-AC89 | pass | two new spec tests; browser flow captures `AGENT-AC89-card` with "Veraltet" |

## Findings
1. [low] `apps/client/e2e/agent.screenshots.ts`: AC48 flow did not assert card order. **Fixed** in fe23dcc7 (bounding-box order; red by swapping the fixture's proposal events: `Expected: < 536.15625, Received: 641.25`).
2. [low] `ai-service/src/ai_service/inference.py:194-216`: the abort relies on each tool call opening a new connection; a shared `httpx.Client` with an idle keep-alive connection would only abandon the call. Not reachable: `build_agent_services` gives the agent its own `ChatModel`. **Accepted**, listed in the PR.

Checked and correct: `ToolCallConnection` lock shared by trace and close; PEP 758 `except A, B:` valid on Python ≥3.14; `agentChangesApplicable` same semantics as before; `currentStatus` reports `applying` as `open`; d1b6017e leaves three test files identical to base; 821c7951 only the README row and run record.

## Checks (reviewer)
typecheck pass (1 baseline), lint pass (legacy only), tests pass (3,131: ai-service 829, client 704, server 1,598; 14 legacy failures, none new), duplicates pass, structure pass, spec-lint pass. The guard blocked the `KIT_BASE` prefix, so duplicates/structure compared against the default branch (older base, M8 code still counted as new). Not run by the reviewer: server e2e, ai-service integration, Playwright, AGENT-AC114.
