---
name: pr-description
description: Write a pull request description from the diff, the spec, the verify log and the evidence pack - what, why, how it was tested, and how to review it in five minutes. Does not push or open the PR.
argument-hint: [base branch, default main]
---

# Write the PR description

Base branch: $ARGUMENTS (use `main` if empty).

Read `git diff <base>...HEAD`, `git log <base>..HEAD`, the feature's spec (find it through the Branch column in `specs/README.md`), `.work/<branch>.md`, and the evidence pack in `.work/<branch>/evidence/` (`evidence.json`, `gates.md`, `matrix.tsv`, `data-runs.md`, `screenshots-review.md`). If `evidence.json` names another commit than `HEAD`, say that the pack is stale and that `/verify-feature` must run again; do not use it.

Write:

```markdown
<Title: imperative, at most 72 characters>

## What
- <One to three bullets on what changes for users.>

## Why
<One line, and a link to specs/<feature>.md.>

## Evidence
| Criterion | Tests | Edge cases | Seeded | Mocked | Screenshots |
|-----------|-------|------------|--------|--------|-------------|
| INVITE-AC1 | <test names> | 4 of 4 | pass | n/a | INVITE-AC1-1-desktop.png |

Gates: <one line from evidence.json, n/a with its reason>. <Legacy and flaky tests by name.>

## Review
- <At most three bullets: the screenshots to compare, the new edge cases, reviewer mediums left and why. Where to start reading.>

## Risks
<Only if there are migrations, feature flags, deployment config or human-only steps.>

Cost: <the line from `.claude/bin/usage line`, only if the branch has a usage record.>
```

Rules:

- Follow `.claude/rules/output.md`. At most 150 words outside the table. Omit an empty section.
- Take the evidence from `evidence.json`, the verify log and the test names. If a criterion has no test, or no recorded red run, say so in its row. Never fill a gap with a claim.
- Without an evidence pack, the table has the columns Criterion, Test and Result, and the PR says that verify did not run.
- The screenshots appear in CI's sticky comment; name the files here, do not try to attach them.

If the state file has a Decisions to review section, copy it into the description under that heading, so the reviewer sees every decision no human approved.

Save it to `.work/<branch>-pr.md` and show it. Then run `.claude/bin/gate push`. With `ask`, do not push or create the PR yourself: offer the command `gh pr create --base <base> --title "<title>" --body-file .work/<branch>-pr.md` for the user to approve. With `auto`, push the branch and run that command.
