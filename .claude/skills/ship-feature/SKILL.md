---
name: ship-feature
description: Run a feature end to end - spec, plan, test-first build in fresh subagent contexts, simplify, independent review, verify with an evidence pack, PR description - with approval gates after the spec, after the plan and before anything is pushed (KIT_APPROVAL decides which ones ask). Use when the user asks to build or ship a feature. Resumes from the state file after a break.
argument-hint: <feature idea or existing feature name>
---

# Ship a feature

Feature: $ARGUMENTS

You orchestrate. Subagents do the implementation in fresh contexts; you own the gates, the state file and the outcome.

## Approval gates

Run `.claude/bin/gate level` once and tell the user the level. Every gate below runs `.claude/bin/gate <name>` first. `ask`: stop and ask, as written. `auto`: decide, add one line under Decisions to review in the state file, and continue. Failure stops (retries, review and verify rounds, the budget, the `spec`, `kit` and `env` classes) ask at every level.

## 0. Resume or start

Run `git branch --show-current`. If `.work/<branch>.md` exists, read its Progress section and continue at the first open step; do not redo finished ones. Otherwise start at step 1.

Run `.claude/bin/route check`. If it warns that `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set, tell the user that every subagent will run on one model and the tiers are ignored.

**Model routing.** Every dispatch passes the Agent tool's `model` parameter from `.claude/bin/route`: `route explore` for `Explore`, `route <tier>` for an implementer (the task's Tier column), `route tests` for the `test-writer`, `route review` for the `reviewer`. Put the task number and the step in the dispatch's description (`task 3: invite form`, `task 3 retry deep: invite form`, `review round 2`), because the usage record maps agents to tasks through it. The usage hook blocks a dispatch once `KIT_BUDGET_TOKENS` is used up; then stop and ask.

## 1. Spec (gate: spec)

If the feature has no approved spec, follow `${CLAUDE_SKILL_DIR}/../spec-feature/SKILL.md`. Do not continue until the spec is approved.

## 2. Plan (gate: plan)

Follow `${CLAUDE_SKILL_DIR}/../plan-feature/SKILL.md` until the plan is approved. Then create the branch (`git checkout -b <issue>-<slug>`), move the state file to the branch name if it differs, and run `.claude/bin/usage adopt <the branch you started on>`, so the tokens of the spec and the plan count for this feature.

Everything the build needs is now in files. If the plan gate asked, suggest that the user runs `/clear` and then `/ship-feature` again: it resumes at step 3 with a context that no longer carries the interview and the exploration.

## 3. Build, one task at a time

For each task in the plan's order:

1. Dispatch the `implementer` subagent on the task's tier. Give it the spec path, the state file path (its Notes section holds what earlier tasks left for later ones), the task row, its criteria, the test cases and the `path:line` anchors from planning. It shares none of your context, so be complete. One task at a time: implementers share the working tree and the edit hooks, so a second one would typecheck the first one's half-finished edits.
2. Check what it returns. Every criterion needs a red run and a green run. Run `.claude/bin/check typecheck` and `.claude/bin/check test-related <files>` yourself. Do not take its word for it.
3. Update the state file: tick the task in Progress, add the evidence to the Verify log, and add one or two lines to Notes: its deviations, open issues, and any new helper or interface a later task needs (`path:line`).
4. Commit the task (one logical change per commit, gate: commit), so every finished task is a safe point to stop.

If a task fails its checks once, dispatch it again one tier higher (`.claude/bin/route up <tier>`; a deep task stays on deep) and say so in the description (`task 3 retry deep: ...`). If it fails again, stop and ask the user. If the implementer reports that the spec is wrong, stop and ask; never change an approved spec on your own. See "When something does not work" below.

## 4. Simplify

Run `.claude/bin/check duplicates` and `.claude/bin/check similar` and keep their clone lists that touch files changed on this branch. Then dispatch the `implementer` (`model` from `.claude/bin/route implement`, description `simplify`) with the base branch, the state file path, those clone lists as its worklist, and this task: in the code changed on this branch only, replace each listed copy with the existing code (or move both into the shared home of `.claude/rules/structure.md`), then remove dead code, needless abstraction and leftover debug output; do not change behaviour or tests; run the related tests. A "not configured" check gives no list; the simplifier then looks for duplication itself. Check its result with `.claude/bin/check typecheck` and `.claude/bin/check test-related <files>` as for any task, and commit it.

## 5. Independent review

Dispatch the `reviewer` agent with the Agent tool (description `review round <n>`), `model` from `.claude/bin/route review`, and the same instructions as `/review-diff`: the base branch, and that it reviews the diff against the spec and the rules. The reviewer never runs on a lower tier than the highest tier an implementer used on this branch; raise it if it would. Fix every high finding through the implementer, then review again. After two review rounds with open high findings, stop and ask the user.

## 6. Verify

Follow `${CLAUDE_SKILL_DIR}/../verify-feature/SKILL.md`: hard gates, edge-case matrix, data runs, screenshots, and the evidence pack. If verify fails, the fix goes through the implementer and then back to step 5. After two failed verify rounds, stop and ask. Pushing the pack is gate push.

## 7. PR (gate: push)

Follow `${CLAUDE_SKILL_DIR}/../pr-description/SKILL.md`, and add the line from `.claude/bin/usage line` (tokens per tier, review rounds, escalations). The description is a file in `.work/`, so write it without asking; it changes no commit. The run record for `/improve-kit`, if any, was committed in step 6 before the pack; do not commit anything now. Pushing and creating the PR are gate push; with `auto`, push and run `gh pr create` yourself. The feature stays `in-review` until the user has checked it and marks it `done` themselves.

Finally, report in at most eight lines: the branch, the commits, the review verdict, the checks, the decisions you made at `auto` gates, and anything left open. Be faithful: a skipped check or an unmet criterion is stated plainly.

## When something does not work

The loops in steps 3, 5 and 6 are the only automatic recovery: one retry a tier higher, two review rounds, two verify rounds, and a stop when the same fix failed twice. Every retry and every stop, including a review round with open high findings and a failed verify round, gets one line under Stops in the state file:

`- <step> | <class> | <trigger> | <what was tried> | <resolution>`

Pick the class by the cause, not the symptom, and fix it where it belongs:

- `spec`: the spec is wrong, unclear or untestable. Stop and ask. Once the user has decided, amend it through `${CLAUDE_SKILL_DIR}/../spec-feature/SKILL.md` (new criterion IDs or a `removed` mark, a Decisions entry, `spec-lint`, approval again), update the affected tasks, and continue.
- `plan`: a task is too big, in the wrong order, or misses an anchor. Propose the change to the plan and continue once the user approves it.
- `tier`: the model was too weak for the task. Retry a tier higher as in step 3.
- `test`: a test is flaky or tests the wrong thing. Dispatch the `test-writer`; never weaken the test.
- `kit`: a hook, the guard, a check command or a rule is wrong, too slow, or blocks something harmless. Never edit `.claude/` to get past it; ask the user, and write the fix you would propose into the resolution.
- `env`: a dependency, the network, credentials or a step only a human can do. Ask, and add it to the plan's Human-only steps.
- `budget`: the token budget blocked a dispatch. Ask whether to raise it or stop.
