# Status and handoff

Read this first in a new session. Current state only; history lives in git and `docs/build-log.md`.

Last updated: 2026-10-27. Branch: `ai-v1`.

## Where we are

| Step | State |
|---|---|
| Phase 0 codebase check | Done: `docs/phase0-report.md`, `docs/competitive-analysis.md` |
| Project spec | v1.2: `docs/spec.md` |
| Mockups for M5, M7, M8 | Approved 2026-10-27: `docs/design/ai-assistant.html`, `docs/design/README.md` |
| M1 kit setup | **Next.** Not started |
| M2 to M10 | Not started; order in spec section 8 |

Nothing is implemented yet. `ai-service/` holds only a README.

## Decisions (2026-10-27)

All are recorded in `docs/spec.md` (changelog v1.1, v1.2) or `docs/design/README.md`; this is the short list.

- **Inference:** local only in Must: Ollama on the MacBook Pro (M3 Pro, 18 GB), about 8B parameters at 4-bit. API mode (LiteLLM to Anthropic) is Should; Bedrock and own GPU are Later. All modes are configurations of one OpenAI-compatible adapter.
- **Embeddings:** fixed per deployment, open multilingual model in-process in ai-service on CPU. Not part of the mode switch.
- **Agent is Must** (M8), with a free-text task scoped to one readable space; its tools (search, read page, propose update) define what it can do. Nothing is written without confirmation of the exact diff.
- **No hosted demo in v1.** Deliverable is a 2 to 3 minute video plus published eval and leak-test reports.
- **Security hardening is deferred and documented** (spec section 12). The permission model (section 7) and leak tests stay Must.
- **Seed data:** new fictional company; "Rheinwerk" is taken. Name still to be chosen and checked in M2.
- **Workflow:** every feature goes through the Agentic Workflow Kit (`vitoleonardo/agentic-development-template`, `templates/agentic-workflow-kit`): spec in `specs/`, plan, tests first, review, PR. UI features need an approved mockup first.
- **Design:** one assistant panel in the aside with tabs "Fragen" and "Aufgabe", built like the Comments aside. A no-source answer reads the same for missing and restricted content. Sources show only after the citation check. Extraction is offered only to users who can edit the page. Diffs open in a modal.

## Next: M1 on the MacBook

Spec section 13 lists the M1 steps and the prerequisites found so far. In short:

1. Set up the fork locally (steps in `docs/phase0-report.md` section 1): `docker compose -f docker-compose.dev.yml up -d`, copy `.env.example` to `.env` and fill it in, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm --filter ./apps/server run migration:latest`, `pnpm start`. Docker Desktop's VM memory counts against the 18 GB the model also needs.
2. Do not init the `apps/server/src/ee` submodule. It points to a private repo, and the server runs without it.
3. Install Ollama natively (not in Docker, so it uses Metal). The model is picked in an ADR by German quality, tool calling and structured output.
4. Clone the kit and run `./install.sh <fork>` without an adapter, then `/onboard` in the fork.
5. Verify the ee lock on the Mac: with the sandbox on, `head packages/ee/LICENSE` through Bash must be blocked, also with the RTK hook active. macOS uses its built-in sandbox, so the Linux `bubblewrap`/`socat` gap does not apply there.
6. Record what breaks in `docs/build-log.md`; budget about a day.

## Local state that is not in the repo

- `.env` (gitignored). Recreate from `.env.example` on each machine.
- The Linux server's dev database holds only a throwaway workspace from Phase 0. Nothing in it needs to move to the Mac; M2's seed script rebuilds everything.
- The Linux server has no GPU and 7 GB RAM: it cannot run the local model, so model-dependent work and tests run on the MacBook.
