# Review (round 2, last round)

Reviewer: `reviewer` agent, opus. Base: m5-ask. Head reviewed: ce2a1f4d.

## Round 1 findings
| # | Verdict |
|---|---------|
| 1 detector header from `format_source` + block count | fixed |
| 2 AC6 needs prompt-text findings; synthetic detector tests | fixed |
| 3 answer key's page spaces checked against the seed | fixed |
| 4 canary normalisation in `find_leaks` | fixed |
| 5 SSE parsing and login shared from `leak_suite` | fixed |
| 6 port-in-use and process-alive checks in the script | fixed |
| 7 workflow comment removed | fixed |
| 8 runbook step name "Leak check" | fixed |
| 9 report mode/model from settings defaults | accepted |
| 10 injection data checks | fixed |
| 11 chained error when deleting injection pages fails | fixed |
| 12 `os.environ` in stack tests (existing pattern) | accepted |

## Round 2 findings (all low, accepted)
1. `leak_stack.py:620`: `sentences_of(...)[0]` raises IndexError for a seed page without a sentence of 30+ characters.
2. `leak_stack.py:620`: first-sentence match assumes the bridge's markdown export keeps the sentence verbatim.
3. `leak_stack.py:291-294`: titles assumed unique.
4. `leak_suite.py:370`: no NFKC folding (full-width digits not matched).
5. `run-leak-check.sh:39-44`: missing `curl` reported as "port in use".
6. `test_leak_prompt.py:195-197`: AC6 can pass on the title finding alone; text rule proven by synthetic tests.

## Checks (reviewer's run)
typecheck pass (1 baseline error), lint pass (baseline only), tests pass (ai-service 485, client 531, server 1293; 14 baseline failures, none new), structure pass. The stack-backed leak check could not run in the reviewer's shell; main session ran it: 38 passed.

Ready for PR: yes, no high or medium findings.
