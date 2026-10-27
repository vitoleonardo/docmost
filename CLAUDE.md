# Project guide for Claude

Rules in `.claude/rules/` load automatically. Stack rules from the adapter load when you touch matching files.

## Project facts

- Product: a fork of Docmost, pinned to upstream `main` at `de0b7d75` (after v0.96.0; AGPL-3.0 open-source wiki) that adds an AI knowledge assistant: permission-aware answers, document-to-page extraction and an update agent, on local models. Public portfolio project; purpose and scope in `docs/spec.md`, current state in `docs/status.md`.
- Stack: pnpm 11 (via corepack) and Nx monorepo. `apps/server`: NestJS on Fastify, Kysely on Postgres 18 with pgvector, Redis, Hocuspocus/Yjs. `apps/client`: React, Vite, Mantine, Tiptap 3, TanStack Query, Jotai. `packages/editor-ext`, `packages/base-formula`: shared libraries. `ai-service/`: planned Python service, empty so far. Auth: Docmost's JWT plus CASL abilities and `PageAccessService`. Runs locally only in v1.
- Install and dev server: `docker compose -f docker-compose.dev.yml up -d`, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm --filter ./apps/server run migration:latest`; then `pnpm dev` (Vite client plus server in watch mode) or `pnpm start` (production build on http://localhost:3000).
- Checks: always run them through `.claude/bin/check <typecheck|lint|test|test-related|coverage|format|build> [files]`. The stack adapter defines each one in `.claude/kit.conf` (a package can have its own `<package>/.claude/kit.conf`); a check that reports "not configured" or "n/a" does not exist in this project. Never invent commands. Full runs before a PR use `.claude/bin/check --against-baseline <test|lint|typecheck|coverage>`, which blocks only failures that are not in `.claude/baseline.tsv`.
- What CI runs on every PR: `.github/workflows/quality-gates.yml` (spec lint, then typecheck, lint and tests against `.claude/baseline.tsv`, then build). `release.yml` builds release images on tags.
- Things only a human can do: `.env` values, Docker Desktop, installing Ollama and pulling models, GitHub repository settings and required checks, recording the demo video. The `apps/server/src/ee` submodule is never initialised.

## How work flows here

Every feature goes through the same steps. Each step leaves a file behind, so a new session can pick up without the chat history.

1. **Spec** (`/spec-feature`): `specs/<feature>.md` holds the user flow and what "done" means as numbered acceptance criteria (`<FEATURE>-AC<n>`). One feature, one spec; extend it instead of creating a second one. `.claude/bin/spec-lint` must pass, then a human approves it.
2. **Plan** (`/plan-feature`): the technical design (data, contract, permissions, decisions), then tasks with files, tests and the criteria each covers. A human approves it before any code is written.
3. **Build**: implement against the plan. Every criterion gets a test that failed before the code made it pass. Progress and evidence go to `.work/<branch>.md`.
4. **Simplify**: a fresh subagent removes duplication, dead code and needless abstraction in the changed code, without changing behaviour.
5. **Review** (`/review-diff`): an independent reviewer that did not write the code checks the diff against the spec and these rules.
6. **Verify** (`/verify-feature`): hard gates, a passing test for every edge case, seeded and mocked runs, and screenshots checked against the criteria. The evidence pack in `.work/<branch>/evidence/` is pushed for CI; it is valid only for the commit it was made on.
7. **PR** (`/pr-description`): what, why, the evidence table, and how to review it in five minutes.
8. **Acceptance**: the user checks the result and marks the feature `done`. Claude never sets `done`.

`/ship-feature` runs steps 1 to 7 with the approval gates. Small fixes can skip the spec but not the test.

Where things live:

- `specs/README.md`: one row per feature with its current status. Update the row when the status changes; it is not a log.
- `specs/<feature>.md`: the contract. Do not change it during the build. If it is wrong, stop and say so; once the user has decided, amend it through `/spec-feature` (new criterion IDs, a Decisions entry, approval again) and update the plan.
- `.work/`: plan progress, verify logs, notes that tasks leave for later tasks, and evidence packs. Gitignored, never committed; packs go to the `kit-evidence` branch instead.

## Working agreements

- When a session starts on existing work, read `specs/README.md` and the matching `.work/<branch>.md` before doing anything else.
- Ask before deciding anything the code and the spec cannot answer. Do not fill gaps silently.
- Report faithfully: a skipped test, an unmet criterion, a red build or a check you did not run is stated plainly. "Build passed" is not "verified".
- Never edit the rules, hooks or settings in `.claude/` to make a check pass. Propose the change and wait for approval.
- Stop and ask when the same fix has failed twice. Explain what you tried and what you think is wrong.
- Record every retry and stop under Stops in `.work/<branch>.md` with its class (`spec`, `plan`, `tier`, `test`, `kit`, `env`, `budget`); `/ship-feature` says how each class is fixed. Optional: with `KIT_IMPROVE` set, these records and the token usage feed `/improve-kit`, which proposes changes to the kit.
