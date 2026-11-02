# Review: 403 for forbidden pages and spaces

Last `/review-diff` round, 02.11.2026, on the unsplit branch `forbidden-403-wiki`. Its tree is identical to `forbidden-403-server`.

Fixes after this report:
- Finding 1: split into PR #14, #15 and #16; this branch has 777 changed lines against `forbidden-403-client`.
- Finding 2: test renamed to ASK-AC31.
- Finding 3: client red/green runs and the e2e result (107 passed) recorded in `.work/forbidden-403-client.md` and `.work/forbidden-403-server.md`.
- Finding 4: AGENT-AC102 case with a restricted page added.
- Findings 5 and 6: left (low).

The 403/404 split is correct on every path you named, and every listed criterion has passing tests. I found no high findings. What stands in the way of the PR is the diff size: 1,170 changed lines, which `/verify-feature` will fail.

## Criteria
| Criterion | Verdict | Evidence |
|---|---|---|
| BRIDGE-AC79 | pass | `ai-page-access.service.spec.ts` "BRIDGE-AC79: a page in a deleted space, in the trash, of another workspace or unknown…" plus "not found wins…"; e2e "BRIDGE-AC79: read-page answers a trashed, deleted-space or unknown page…" |
| BRIDGE-AC80 | pass | "BRIDGE-AC80: a restricted page and a page of a space the user is not a member of throw 403"; e2e read-page 403 |
| BRIDGE-AC81 | pass | `requireReadableSpace` tests (deleted space, other workspace, unknown id, deleted space of a non-member); e2e search 404 |
| BRIDGE-AC82 | pass | "BRIDGE-AC82: a space the user is not a member of throws 403 space_forbidden"; e2e search 403 |
| BRIDGE-AC35 | pass | Contract JSON updated; `ai-bridge.contract.spec.ts` and ai-service `test_contract.py` both pass |
| ASK-AC78, 79, 80, 81 | pass | `ai-ask.service.spec.ts` (each asserts `requests` is empty) and the matching e2e tests |
| ASK-AC82, 83 | pass | `ask-answer.test.tsx`, `use-ask-conversation.test.ts`, `ai-assistant-service.test.ts` |
| ASK-AC84 | pass | `use-ask-conversation.test.ts` "ASK-AC84: %s marks the turn no_source" |
| EXTRACT-AC44, 70, 71, 73 | pass | `ai-extract.service.spec.ts`, `ai-page-access.service.spec.ts`, e2e EXTRACT-AC70/71 |
| EXTRACT-AC72, 74 | pass | `extraction-dialog.test.tsx`; `extractErrorFrom` checks `page_forbidden` before the 403/404 fallback |
| AGENT-AC26, 28, 29, 132 | pass | `ai-agent-tools.service.spec.ts`: Vertrieb and Geschäftsführung pages are refused as `page_not_found` and the text is not leaked |
| AGENT-AC118, 120 | pass (server side) | 403 `page_forbidden`; e2e AGENT-AC120. The German tool text is in the ai-service code on the base branch, not in this diff |
| AGENT-AC119 | pass (server side) | Search answers `space_forbidden` (BRIDGE-AC82 tests). The tool text is not in this diff |
| AGENT-AC102 | pass | `records.get` runs before any page check; the tests cover view, apply and discard (low finding 4) |
| AGENT-AC121, 122, 131 | pass | `proposal-dialog.test.tsx` (no reason or diff shown, "Schließen" only) and the service mapping tests |
| AGENT-AC123–126 | pass | `ai-agent-proposal.service.spec.ts`: response bodies hold no reason or texts; no claim and no write |
| AGENT-AC127, 128 | pass | `ai-agent.service.spec.ts` (the AI service is not called) |
| AGENT-AC129 | pass | `agent-task-tab.test.tsx` and `use-agent-run.test.ts`: the task and space are kept and the "already running" hint is not shown |
| AGENT-AC130 | pass | The logging test includes the `page_forbidden` outcome |
| AGENT-AC133 | pass | `ai-page-access.service.spec.ts` AGENT-AC133 (403 inside the named space, 404 outside it) plus AGENT-AC28 and e2e AGENT-AC120 |

Your four focus points:
- **Not found wins:** I checked it against the repos.
  - `findManyByIds` with a `workspaceId` filters out other workspaces and the trash.
  - `spaceRepo.findById` is scoped to the workspace.
  - A page of a deleted space, a page outside the named space, another workspace's page id, and a deleted or foreign space all answer 404.
  - 403 is returned only for a restricted page, or for a live page or space where the user is not a member.
- **Callers:** read-page, the search tool, read-blocks (with the run's space), ask scope, agent run, extract and the proposal view/apply path all use the right method. `checkedSources` still uses `findViewablePage`, which behaves as before.
- **Client:** every forbidden state shows its own text and no proposal text. Unknown codes map as before: Ask and agent fall back to `assistant_unavailable`; a proposal 403 falls back to `not_editable`; an extract 403/404 without a code falls back to `not_available` (a new test covers this).
- **Tests:** each removed 404 case (restricted, non-member) became a 403 test with the same assertions. No assertions were dropped.

## Findings
1. [medium] The diff is 1,170 changed lines (949 added, 221 removed), more than twice `KIT_MAX_CHANGED_LINES=400`. `/verify-feature` fails above twice that limit. There is no split and no entry under Decisions to review in `/Users/vito/Documents/GitHub/docmost/.work/forbidden-403-wiki.md`. This breaks the architecture rule on diff size. Fix: split it into server plus contract, and client (the commit already separates cleanly that way), or log the decision.
2. [medium] `/Users/vito/Documents/GitHub/docmost/apps/server/src/integrations/ai-bridge/services/ai-ask.service.spec.ts:573`: the test was renamed from ASK-AC63 to "ASK-AC61: a viewable page scope is sent as pageId only". ASK-AC61 is about 400 `invalid_request`, so the name claims a criterion the test does not prove. Rename it to ASK-AC31.
3. [medium] `/Users/vito/Documents/GitHub/docmost/.work/forbidden-403-wiki.md` records red and green runs for the server suites only. It has nothing for the 7 changed client test files, and it says "e2e edited, not run". The testing rule requires a recorded failing run for each new test. Add the client red/green runs and the e2e result (107 passed).
4. [low] `ai-agent-proposal.service.spec.ts:724-744`: the AGENT-AC102 tests only run with an editable page. Add an OTHER_USER case with `pageState` set to `restricted` or `trashed`, so that "`proposal_not_found` before any page check" is pinned by a test, not only by the order of the code.
5. [low] `/Users/vito/Documents/GitHub/docmost/apps/server/src/integrations/ai-bridge/services/ai-page-access.service.ts`:
   - The "space exists and is not deleted" check is now written three times (lines 31, 76, 143).
   - `requireReadableSpace` loads the space, then loads every member space again through `readableSpaceIds`.
   - Fix: extract one private predicate, and check membership with `getUserSpaceIds` directly.
6. [low] `ai-bridge.contract.spec.ts:604`: the new BRIDGE-AC35 test only compares the contract file with a hard-coded list. It does not prove that the routes answer 403. The service tests and e2e cover that, so this is acceptable; just don't count it as behaviour evidence.

## Checks
typecheck pass (only the server baseline error), lint pass (client 94 vs baseline 95, server 5 vs 5, ai-service clean), tests pass on the related files only (server 566, client 314, ai-service contract and bridge client 91; full suites not run, as you asked), duplicates pass, structure pass (0 new files). `check similar` reports nothing that touches this diff.

## Ready for PR
No. There is no wrong behaviour and no security problem. The blocker is finding 1: the size gate fails `/verify-feature` unless the branch is split or you accept the size. Findings 2 and 3 are quick fixes to make before the PR.
