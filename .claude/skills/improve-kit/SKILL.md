---
name: improve-kit
description: Optional retrospective over recorded feature runs - read the run records, token usage and lead time, check whether earlier kit changes worked, and propose evidence-backed changes to routing, rules, hooks, checks and skills. Proposes only; changes nothing before approval and never touches application code. Needs KIT_IMPROVE in .claude/kit.conf.
argument-hint: [focus, for example "tokens" or "stops"]
disable-model-invocation: true
---

# Improve the kit

Focus: $ARGUMENTS (everything if empty)

This is a retrospective, not a pipeline step. Run it every five merged features or once a month. You propose; the user decides. Never edit application code, and never change `.claude/` or `kit.conf` before the user approves the proposal.

## 0. Is it on?

Run `.claude/bin/runs report`. If it says run records are off, tell the user that `/improve-kit` needs `KIT_IMPROVE="1"` in `.claude/kit.conf`, that `/verify-feature` then writes `reports/runs/<branch>.tsv` with each PR, and that the first useful report needs about five runs. Stop.

## 1. Read

- `reports/runs.md`, just written: tokens, tasks, escalations, review rounds and every stop with its class.
- If `gh` works, run `.claude/bin/leadtime` and read `reports/lead-time.md`: lead time, review rounds and rework from GitHub.
- `reports/improvements.md`, the log of earlier changes, if it exists.
- For a recurring review finding, the merged PRs' review comments (`gh pr view <n> --comments`). Read only what a rule below needs.

## 2. Check earlier changes first

For each entry in `reports/improvements.md` that has at least three runs after it, compare the metric it names with the value before. Mark it `kept` when the metric moved the expected way, and propose reverting it when it did not. With fewer runs, say "too early".

## 3. Apply the rules

Each rule needs its minimum sample; below it, write "not enough data" instead of a proposal. Never propose more than five changes at once; pick the ones with the largest effect.

| Signal (from the report) | Minimum | Proposal |
|---|---|---|
| Escalations above 25 % of tasks | 5 tasks | Read the `tier` stops. Raise `KIT_ROUTE_IMPLEMENT` one tier, or sharpen the plan's rule for which tasks get `deep` when the escalations share a kind of task. |
| No escalations and no `tier` stops | 10 tasks | Trial `KIT_ROUTE_IMPLEMENT` one tier lower for the next five features, measured by escalations and review rounds. |
| Median review rounds above 1 | 5 runs | Group what the reviewer found. Turn the most frequent finding into a check (lint rule, hook, CI step) rather than a longer rule. |
| The same `kit` stop twice | 2 stops | Fix the hook, guard, check command or rule the stops name, with a test in the kit's tests. |
| `spec` or `plan` stops of one kind twice | 2 stops | Add the missing question to the interview in `/spec-feature`, or the missing rule to `/plan-feature`. |
| Any `env` stop | 1 stop | Add the step to "Things only a human can do" in `CLAUDE.md`. |
| Main-session share above 50 %, or tokens per task rising over the last five runs | 5 runs | Find the cause in the runs (no `/clear` after the plan, oversized tasks, long exploration in the main session) and propose the matching change. |
| Any `budget` stop, or no `KIT_BUDGET_TOKENS` set | 5 runs | Propose `KIT_BUDGET_TOKENS` at the p75 of tokens per run, rounded up. |

## 4. Write the proposal

Write `.work/improve/<YYYY-MM-DD>.md`:

```markdown
# Kit improvements, <date> (<n> runs, <from>..<to>)

## Earlier changes
- <date> <change>: <metric> <before> -> <now>, kept / revert proposed / too early

## Proposals
### 1. <short title>
- Observation: <the numbers, and which runs or stops>
- Change: <file and the exact change>
- Expected effect: <which metric moves, and which way>
- Measure: <the metric to watch, and its value now>

## Not enough data
- <rule>: <what is missing>
```

Summarise the proposals for the user and stop. Wait for the user to pick which ones to apply.

## 5. Apply the approved ones

1. Create `kit-improve-<date>` from the default branch. Check `git status` first.
2. Apply each approved change. A change to a hook, the guard or a check gets a test; run the kit's tests.
3. Append one entry per change to `reports/improvements.md`: `- <date> | <change> | <metric> | <value before>`.
4. Commit, one change per commit. Ask before `git push` and before opening the PR.
