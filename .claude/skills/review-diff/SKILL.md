---
name: review-diff
description: Independent review of the current branch's diff against its spec and the project rules, with findings ranked by severity and a verdict per acceptance criterion. Runs in the read-only reviewer agent.
argument-hint: [base branch, default main]
context: fork
agent: reviewer
background: false
---

Review the current branch. Base branch: $ARGUMENTS (use `main` if empty).

Follow your agent instructions: gather the diff, the spec and the rules, run the checks yourself, and return the report in your agent's format. You did not write this code; verify every claim.
