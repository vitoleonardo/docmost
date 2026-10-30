# Review (round 3, base m9-request-log)

Reviewer: `reviewer` agent on opus, head `9a368aee` (before the round 3 fixes in `0b8ba885`, `5c5bc12a`).

## Verdict
No high findings. Every criterion passes except AC19 and AC50 (stack-level, no unit test by plan), which the reviewer could not check; verify checked both in stack runs.

## Findings and resolution
1. [medium] Diff size logged as about 2,000 lines; real 6,395 insertions, 130 deletions → fixed in the state file and the PR description.
2. [low] `check_wiki` let a malformed start-check response escape with status 1 → fixed: mapped to `StartFailed`, exit 2, three tests (`0b8ba885`).
3. [low] Runbook called `EVAL_MODEL` and friends display-only; they key the threshold list → fixed (`5c5bc12a`).
4. [low] Not-judged metrics show "0 of 0" in the report → accepted: the Result column says `not judged`.
5. [low] First-run `agent_no_unconfirmed_write` shows `passed`, not `baseline set` → accepted as the logged build decision (EVAL-AC37); a spec Decision entry is left to the user.
6. [low] `specs/README.md` row still `planned` → fixed: `in-review` (`b47560f1`).

Round 2 fixes (`e46850d5`) and the committed report and thresholds (`9a368aee`) checked against the spec: correct.

## Earlier rounds
Round 1: two high (index readiness ignored the minutes PDFs; the asker-access check ran after wiki requests) and mediums, fixed in `b832082a`, `781a870c`, `5e6c30fb`. Round 2: no high; one medium and four lows fixed in `e46850d5` (its report was not saved).

## Checks at review
ai-service pyright and ruff clean, 1225 unit tests passed; TypeScript failures are legacy and in `.claude/baseline.tsv`.

## Ready for PR
yes
