---
name: verify-feature
description: Prove a reviewed branch before its PR - hard gates, an edge-case matrix with a passing test per case, seeded and mocked data runs, screenshots on the branch and the base checked against the criteria - and push the evidence pack for CI. Runs after the last review round with no high findings.
argument-hint: [base branch, default main]
disable-model-invocation: true
---

# Verify a feature

Base branch: $ARGUMENTS (use `main` if empty). Set `KIT_BASE` to it for every command below.

Review finds problems in the code; verify proves the behaviour, with artefacts a human can check in minutes. The pack goes to `.work/<branch>/evidence/`. `.claude/bin/evidence` decides everything a script can decide; you write only the matrix and the screenshot judgement, and you never edit what the script wrote.

## 0. Preconditions

- The last `/review-diff` round has no high findings. Copy its report to `.work/<branch>/evidence/review.md`.
- Every task is committed. Then set the feature's status in `specs/README.md` to `in-review`, run `.claude/bin/runs record` (with `KIT_IMPROVE` on it writes `reports/runs/<branch>.tsv` for `/improve-kit`; off, it writes nothing), and commit the status and the record together, before the gates: the pack is valid only for the commit it was made on, so nothing may be committed after it. Any later commit, even a typo fix, makes it stale, and verify must run again.
- The working tree is clean.
- Read the spec (`specs/<feature>.md`) and the plan (`.work/<branch>.md`), including its test cases and its `Approved dependencies` line.

## 1. Hard gates

Run `.claude/bin/evidence gates`. All must pass; there is no soft mode. It runs typecheck, lint, build, the full test suite and coverage against the baseline, the duplicates check, the structure check, the focus and skip scan, the dependency check against the plan, protected paths, the secret scan and the diff size. A gate with an empty key in `kit.conf` fails; a check the project cannot have says `n/a: <reason>` there.

If a gate fails, stop. The fix goes through the `implementer` and then back to `/review-diff`. Do not fix it here.

## 2. Edge-case matrix

Write `.work/<branch>/evidence/edge-cases.md` with one table:

```markdown
| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| SPLIT-AC7 | empty data | no expenses | error, no total | SPLIT-AC7: no total without expenses | |
```

- Rows: for each criterion, the plan's test cases plus the reviewer's checklist: errors, empty data, duplicates, double submits, missing permissions, limits, concurrent edits.
- Test: the test's title (or the distinctive part of it) exactly as it appears in the test file. A case that cannot apply gets `n/a: <one-line reason>` in the Test cell.
- Leave Result empty; the script fills it in.

Run `.claude/bin/evidence matrix`. A case without a passing test is a failure, not a note. For each one, dispatch the `test-writer` (`model` from `.claude/bin/route tests`) with the criterion, the case and the files; it adds tests and does not change code. A new test that fails shows missing behaviour: that goes through the implementer and review, not here. Then run `evidence gates` and `evidence matrix` again.

## 3. Data runs

Run `.claude/bin/evidence data`. It runs `KIT_SEED` and then `KIT_E2E` against the seeded data, and `KIT_TEST_MOCKED` with external dependencies replaced, and records the seed version and the mock set. A run that is `not configured` or `n/a` is recorded as such; say so in the report, because a reviewer must see what was not checked.

The e2e run covers only the tests the change affects when `KIT_E2E_RELATED` is set: the changed e2e files and the ones that name this feature's criteria. Its row says what ran and why (`related: …`, `all: …`, or `n/a` when only tests and docs changed). Report that line as it is. Do not pass `--all` to make a selection go away; the whole suite runs in CI after the merge.

## 4. Screenshots

Run `.claude/bin/evidence screenshots`. It runs `KIT_SCREENSHOTS` (with the same selection as the e2e run) on the branch and, in a worktree, on the base, so each step has `<AC-ID>-<step>-<desktop|mobile>.png` and, where the page exists on the base, a `.main.png` next to it. A criterion without UI has no screenshots.

Then dispatch the `reviewer` (Agent tool, description `review screenshots`, `model` from `.claude/bin/route review`) with: the spec path, the screenshot folder, and the instruction to check the screenshots as described in its agent file. Save its report to `.work/<branch>/evidence/screenshots-review.md`. A mismatch between an image and the criterion text is a high finding: verify fails, and the fix goes through the implementer and review.

## 5. Pack and push

1. `.claude/bin/evidence json`. It refuses a dirty tree.
2. Show the user the gate table, the matrix summary, the data runs, the screenshots and the reviewer's verdict. Keep it short (`.claude/rules/output.md`).
3. Ask before pushing. Then `.claude/bin/evidence push` (or `--pr <number>` once the PR exists). It pushes the pack to the `kit-evidence` branch under `<pr-N|branch>/<head sha>/` and leaves the current branch alone. CI's `evidence` job fails for a head commit without a pack.

## Rounds

If verify fails, the fix goes implementer → review → verify. After two verify rounds that still fail, stop and ask the user. Explain what failed, what was tried, and what you think is wrong.

Report faithfully: a gate that is `n/a`, a data run that is not configured, a screenshot the reviewer could not judge, or a pack that was not pushed is stated plainly.
