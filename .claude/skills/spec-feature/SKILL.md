---
name: spec-feature
description: Write or extend a feature spec with numbered, testable acceptance criteria before any code is planned. Use when the user asks to spec a feature, or to change what an existing feature should do.
argument-hint: <feature idea or existing feature name>
---

# Spec a feature

Request: $ARGUMENTS

The spec is the contract: it says WHAT "done" means, never HOW. No technology, file names, code, status or dates in it (except in Decisions).

## 1. New spec or existing one?

Read `specs/README.md` and the specs it lists. If the request changes or extends an existing feature, extend that spec; one feature has exactly one spec. If it is unclear which one applies, ask.

## 2. Interview

Ask only what the code, the existing specs and sensible defaults cannot answer. Ask in one batch of at most five questions, covering:

- Who uses it and what problem it solves.
- The expected behaviour, as concrete examples.
- Edge cases: errors, empty data, duplicates, double submits, missing permissions, limits.
- What is explicitly out of scope.

Never invent an answer. Anything still open goes under Open questions.

## 3. Write it

Path: `specs/<feature-slug>.md`. The ID prefix is a short uppercase name for the feature (`INVITE`).

```markdown
# <Feature name>

ID prefix: INVITE

## Goal
<Who uses it and why, from the user's point of view. One or two sentences.>

## User flow
1. <What the user sees and does, step by step, including where errors show up.>
2. <Link to the visual design (Figma or similar) if there is one.>

## Acceptance criteria
- **INVITE-AC1**: Given <starting state>, when <action>, then <observable result>.
- **INVITE-AC2**: ...

## Edge cases
- **INVITE-AC5**: Given <state>, when <unusual action>, then <result>.

## Out of scope
- <What this feature deliberately does not do.>

## Open questions
- <Question, and who can answer it.>

## Decisions
- <DD.MM.YYYY>: <decision>, because <reason>.
```

Each criterion is a single yes/no check that a test can prove:

- Exactly one Given, when and then, in that order. Two results means two criteria.
- Observable results: exact text, numbers with units, states. No "fast", "correctly", "user-friendly", "handles", "etc.".
- At least one edge case: errors, empty data, duplicates, missing permissions, limits.

When you extend a spec, continue the numbering. Never renumber or reuse an ID. Mark a dropped criterion as `**INVITE-AC3** (removed DD.MM.YYYY: reason)` instead of deleting it.

## 4. Check it

1. Run `.claude/bin/spec-lint specs/<feature-slug>.md` and fix every finding. This is a hard gate: never ask for approval while it fails.
2. Dispatch the `reviewer` subagent to review the spec (not a diff). Fix what it finds, or add it to Open questions.

## 5. Status and approval

Add or update the feature's row in `specs/README.md` with status `draft`. Then run `.claude/bin/gate spec`.

- `ask`: show the spec and the reviewer's remaining points, and ask for approval. Only after the user approves, set the status to `approved`.
- `auto`: answer each open question yourself with a Decisions entry, set the status to `approved`, and log the approval (see "Decisions to review" in `CLAUDE.md`).

spec-lint then also requires that no open questions remain. Do not plan or write code in this step.
