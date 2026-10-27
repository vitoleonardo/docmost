---
name: plan-feature
description: Turn an approved spec into a short implementation plan (tasks, files, tests, risks, which criterion each task covers) and wait for approval before any code is written.
argument-hint: <feature name or spec path>
disable-model-invocation: true
---

# Plan a feature

Feature: $ARGUMENTS

Do not edit source files in this step. The only files you write are the state file and the status row.

## 1. Read

- The spec in `specs/`. If its status in `specs/README.md` is not `approved`, stop and say so. For a small fix without a spec, write two or three acceptance criteria into the plan instead and have them approved with it.
- The code the feature touches. For a large codebase, explore the affected areas with parallel `Explore` subagents, passing `model` from `.claude/bin/route explore`, so you read their conclusions, not file dumps. Collect `path:line` anchors, existing pieces to reuse, and the pattern to mirror.

## 2. Write the plan

Write it to `.work/<branch>.md`, using the current branch or, if you are on `main`, the branch name you propose (`<issue>-<slug>`). Do not create the branch yet.

```markdown
# Plan: <feature> (spec: specs/<feature>.md)

## Design
- Parts: <which UI, server and data pieces change, and how they connect>
- Data: <new or changed tables/fields/types, precise enough that nobody has to guess>
- Contract: <only when a frontend and a backend talk: route, method, request, response, errors, required role>
- Permissions: <who may see and change what; how user A is kept out of user B's data>
- States and errors: <loading, empty, failure; what the user sees in each>
- Decisions: <choice, the alternatives considered, and why>
- Reused: <existing modules and patterns this builds on, with path:line>
- Approved dependencies: <none, or the new packages the user approved, comma-separated; verify fails on any other>

## Tasks
| # | Task | Files | Criteria | Test cases | Depends on | Tier |
|---|------|-------|----------|------------|------------|------|
| 1 | <one concern> | <paths> | INVITE-AC1, INVITE-AC5 | <file>: duplicate email, missing role | – | standard |

## Risks
- <What could break, and how the plan guards against it.>

## Human-only steps
- <Dashboards, keys, DNS, third-party settings: what, where, which value.>

## Progress
- [ ] 1 <task>

## Verify log
| Criterion | Test | Red seen | Green | Notes |
|-----------|------|----------|-------|-------|

## Stops
- <step> | <class> | <trigger> | <what was tried> | <resolution>

## Notes
- <Per finished task, one or two lines that later tasks need: deviations from the plan, open issues, new helpers or interfaces with path:line.>
```

Rules for the plan:

- The design covers every criterion; it introduces nothing the spec does not ask for.
- Every criterion appears in at least one task. List the coverage; if a criterion has no task, the plan is not done.
- Each task is one concern and fits a fresh context: at most about five files. Split anything bigger.
- Each task is worth a fresh context. Fold a pure rename or a one-line change into the task whose files it touches.
- Name the test cases, not just "add tests".
- Order the tasks so nothing is built before what it depends on. Tasks run one after another, in this order.
- Tier: the model tier the implementer runs on. The default is `.claude/bin/route tier implement`. Raise a task to `deep` when it touches auth, data migrations, concurrency, money or a protected contract, or when there is no existing pattern to copy. Lower it to `fast` for pure renames and copy tasks. Every tier other than the default gets a one-line reason under the table (`Task 3 deep: changes the permission check`).

## 3. Ask for approval

Summarise: the design decisions, the tasks, the files touched, the risks, the human-only steps, and an estimate of the changed lines. If the estimate is over 400 lines, propose how to split it into several PRs.

Then stop and wait. When the user approves, set the feature's status in `specs/README.md` to `planned`.
