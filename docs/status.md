# Status and handoff

Read this first in a new session. Current state only; history lives in git and `docs/build-log.md`.

Last updated: 28.10.2026. Branch: `ai-v1`.

## Where we are

| Step | State |
|---|---|
| Phase 0 codebase check | Done: `docs/phase0-report.md`, `docs/competitive-analysis.md` |
| Project spec | v1.3: `docs/spec.md` |
| Mockups for M5, M7, M8 | Approved 2026-10-27: `docs/design/ai-assistant.html`, `docs/design/README.md` |
| M1 kit setup | **In progress.** Fork runs locally; kit at 795eb90 onboarded, baseline recorded, quality gates in CI. Local model: `qwen3:8b` (`docs/adr/0001-local-model.md`). CI also runs duplicates, structure and the ee import check |
| M2 to M10 | Not started; order in spec section 8 |

Nothing is implemented yet. `ai-service/` holds only a README.

## Decisions (2026-10-27)

All are recorded in `docs/spec.md` (changelog v1.1, v1.2) or `docs/design/README.md`; this is the short list.

- **Inference:** local only in Must: Ollama on the MacBook Pro (M3 Pro, 18 GB), about 8B parameters at 4-bit. API mode (LiteLLM to Anthropic) is Should; Bedrock and own GPU are Later. All modes are configurations of one OpenAI-compatible adapter.
- **Embeddings:** fixed per deployment, open multilingual model in-process in ai-service on CPU. Not part of the mode switch.
- **Agent is Must** (M8), with a free-text task scoped to one readable space; its tools (search, read page, propose update) define what it can do. Nothing is written without confirmation of the exact diff.
- **No hosted demo in v1.** Deliverable is a 2 to 3 minute video plus published eval and leak-test reports.
- **Security hardening is deferred and documented** (spec section 12). The permission model (section 7) and leak tests stay Must.
- **Seed data:** new fictional company; "Rheinwerk" is taken. Chosen 28.10.2026: "Ostmooimooi Anlagenbau GmbH" (web search and Handelsregister clean).
- **Workflow:** every feature goes through the Agentic Workflow Kit (`vitoleonardo/agentic-development-template`, `templates/agentic-workflow-kit`): spec in `specs/`, plan, tests first, review, PR. UI features need an approved mockup first.
- **Branches:** each M step gets its own branch `m<n>-<slug>` off `ai-v1` and one PR into `ai-v1` (decision 28.10.2026).
- **Design:** one assistant panel in the aside with tabs "Fragen" and "Aufgabe", built like the Comments aside. A no-source answer reads the same for missing and restricted content. Sources show only after the citation check. Extraction is offered only to users who can edit the page. Diffs open in a modal.

## Next: finish M1, then M2

Done: fork runs locally, Ollama installed natively, kit installed and onboarded (`docs/build-log.md`, 28.10.2026). Do not init the `apps/server/src/ee` submodule.

1. ee lock: the sandbox stays off (spec v1.3). The guard blocks `head packages/ee/LICENSE`, but an indirect path passes it. CI's "ee imports" step (`scripts/check-ee-imports.sh`) fails a PR that adds an import from the ee code; it has not run on GitHub yet.
2. Make the quality-gates workflow a required check on GitHub (human).
3. M2 on branch `m2-seed-data`: spec `specs/seed-data.md` approved; 7 tasks built (`.work/m2-seed-data.md`), review round 1 fixes in progress, then verify and PR.

## Local state that is not in the repo

- `.env` (gitignored). Recreate from `.env.example` on each machine.
- The Linux server's dev database holds only a throwaway workspace from Phase 0. Nothing in it needs to move to the Mac; M2's seed script rebuilds everything.
- The Linux server has no GPU and 7 GB RAM: it cannot run the local model, so model-dependent work and tests run on the MacBook.
