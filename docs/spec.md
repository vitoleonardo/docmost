# Docmost AI: Specification v1.1

Working name: `docmost-ai` (final name open).

This is the project spec: purpose, rules, architecture, scope and order. The testable contract for each feature lives in `specs/<feature>.md`, written with the Agentic Workflow Kit's `/spec-feature` (section 13). Section 9 lists what each feature spec must cover.

## 1. Purpose

A public portfolio project that demonstrates the freelance offer "KI-Feature-Sprint" end to end:

> I build an LLM, RAG or agent feature into your existing stack, with evals, cost control, permissions and monitoring. Built in your code, handed over to your team.

The project adds an AI knowledge assistant to Docmost, an existing open-source wiki (Confluence/Notion alternative, NestJS + React + Postgres). Working inside a real, foreign codebase is the point: it is what clients buy.

Target audience: CTOs, Heads of Engineering and IT leads in German Mittelstand companies who run internal tools and care about data protection, permissions and running models on their own infrastructure.

The demo is a 2 to 3 minute video plus published eval and leak-test reports and a README that sets everything up locally. There is no hosted demo in v1 (section 8, Later).

## 2. The feature in one sentence

"Your company wiki answers questions, turns attached documents into structured pages and keeps itself up to date, but only with what each employee is allowed to see, and entirely on your own hardware."

## 3. Hard rules

1. Fork Docmost at a pinned release tag (v0.96.0). Do not chase upstream during v1.
2. Never read, copy, modify or depend on code in `apps/server/src/ee`, `apps/client/src/ee` or `packages/ee` (enterprise license). Do not reimplement enterprise features 1:1. Enforced by the kit's protected paths and sandbox (section 13), not by agent discipline.
3. Keep changes inside Docmost minimal and isolated: one NestJS module (`integrations/ai-bridge`), one client feature folder (`features/ai-assistant`), and the wiring listed in `docs/phase0-report.md` section 7. All AI logic lives in the Python ai-service.
4. The full fork stays public under AGPL-3.0.
5. No real company data. All demo content is fictional seed data.
6. Every feature goes through the kit's flow: spec, plan, test first, review, PR (section 13).

## 4. Phase 0 (done)

Report: `docs/phase0-report.md` (2026-10-23). Competitive check: `docs/competitive-analysis.md`. The findings are folded into this spec. Still open from Phase 0:

- Does `getUserSpaceIds` exclude soft-deleted spaces? Answered by a test in the ai-bridge feature.
- Hands-on tests of Docmost Enterprise AI and the restyler fork: moved to Later.

## 5. Architecture

```
Docmost fork (TypeScript)
  apps/client   React + Mantine   -> Ask panel, Extract action, agent proposals UI
  apps/server   NestJS            -> new module: integrations/ai-bridge
        |  ^
        |  |  user token (signed by ai-bridge, short-lived) + service token
        v  |
ai-service (Python, FastAPI)       never reachable from outside; only ai-bridge talks to it
  indexing      page + attachment ingestion, chunking, local embeddings
  retrieval     vector search, permission filter before generation
  extraction    attachment -> typed schema -> reviewed table
  agent         multi-step tasks with tools that call back into ai-bridge as the user
  inference     one OpenAI-compatible adapter, modes are configuration (section 6)
  evals         RAG, extraction, agent and leak suites
        |
Postgres + pgvector: Docmost's database, ai-service in its own schema `ai` (Alembic)
Redis: Docmost's queues; ai-service's own job queue
Ollama: native on the Mac (Metal), not in Docker
```

Framework choice is made per feature and recorded as an ADR. Start with the fewest frameworks that do the job; each one must earn its place:

- Pydantic AI: typed extraction and answer generation (default).
- LangGraph: the agent, if its interrupt/resume model is the simplest way to implement confirmed writes.
- LlamaIndex: only if it beats plain chunking plus pgvector without getting in the way of the permission filter. Otherwise dropped, with the reason in the ADR.

## 6. Inference

One `InferenceProvider` built on the OpenAI-compatible API. Ollama, vLLM and the LiteLLM proxy (which also reaches Anthropic and Bedrock) all speak it, so a "mode" is a configuration entry, not an adapter.

| Mode | v1 tier | Endpoint |
|---|---|---|
| Local | Must, the only mode in Must | Ollama on the developer's MacBook Pro (M3 Pro, 18 GB) |
| API | Should | LiteLLM proxy to Anthropic (Haiku 5.5 for extraction, Sonnet 5.5 for answers and agent) |
| Bedrock | Later | LiteLLM to Bedrock in an EU region |
| Own GPU | Later | vLLM; Terraform for the server as a showcase |

Requirements:

- One model registry hands each framework its model object from the same config. Business logic never knows which mode is active.
- Capability matrix per model: tool calling, structured output, prompt caching, context size. Startup check warns when the active model lacks a capability a task needs.
- Local model: about 8B parameters at 4-bit (5 to 6 GB) fits next to the Docker stack in 18 GB; about 14B fits only with little else running. Pick the model at build time by German quality, tool calling and structured output, and record the choice and its eval numbers in an ADR.
- Embeddings are fixed per deployment and are not part of the mode switch. Default: an open multilingual model running in-process in ai-service on CPU. Vectors are stored per embedding model; changing the model is a re-index job.
- Every request records its mode and model.
- Verify model names, features and prices at build time. Prices carry a source and a date.

## 7. Permission model

This is the core claim, so it is Must and not part of the deferred security work.

1. **User token.** The client calls `/api/ai/*` with the normal Docmost session. ai-bridge checks it and signs a token for ai-service with `AI_BRIDGE_SECRET` (not `APP_SECRET`): sub, workspaceId, readable spaceIds, aud `ai-service`, exp ≤ 60 s.
2. **Service token.** ai-service authenticates to ai-bridge's internal endpoints with a static service token. On calls made for a user it also passes the user token, and ai-bridge verifies that token itself. A user id sent without a valid user token is rejected.
3. **Filter before generation.** Retrieval narrows by spaceIds, then every candidate chunk's page goes through `filterAccessiblePageIds` via ai-bridge before any text reaches the model. Restricted pages inside readable spaces never enter the prompt.
4. **Final check.** Every cited page is checked with `validateCanView` before the answer is returned.
5. **Extracted data** belongs to its attachment's page. Any query over it (agent tools, lists) is filtered through the same page check.
6. **Agent tools** call ai-bridge as the user, through Docmost's own services, never with admin rights. Agent runs longer than the user token's lifetime use a task token bound to user, run and expiry, issued by ai-bridge.
7. **Deletes.** A page that is deleted, soft-deleted or moved out of a space is removed from, or re-scoped in, the index and the extracted data. A soft-deleted page is never retrieved.
8. **Output rendering.** The client renders AI output as markdown without raw HTML and without loading remote images.

## 8. Scope

### Must (weeks 1 to 3, plus video and docs in week 4)

| # | Feature (spec file) | Content |
|---|---|---|
| M1 | Kit setup (no spec, `/onboard`) | Kit installed, baseline recorded, ee paths protected, per-package configs, quality gates in CI |
| M2 | Seed data (`specs/seed-data.md`) | Fictional company, users, spaces, permission matrix, pages, generated PDFs with ground truth, rebuild script |
| M3 | AI bridge (`specs/ai-bridge.md`) | Tokens, internal endpoints (filter pages, page content, attachment stream, agent tools), queue processor, ai-service skeleton, health |
| M4 | Indexing (`specs/indexing.md`) | Initial full index, incremental updates from `{ai-queue}`, deletes, reconcile job |
| M5 | Ask (`specs/ask.md`) | Side panel, streaming German answers, section citations, "I don't know", permission model 7.3 and 7.4 |
| M6 | Leak tests (`specs/leak-tests.md`) | Model-independent prompt-content test in CI, canary suite on answers |
| M7 | Contract extraction (`specs/extraction.md`) | "Extract" on a PDF, contract schema, review UI, insert as table |
| M8 | Agent: outdated pages (`specs/agent.md`) | One scenario, proposals, confirmed writes, limits |
| M9 | Request log (`specs/request-log.md`) | One row per request: task, mode, model, tokens, latency, cost, status, pseudonymous user |
| M10 | Evals (`specs/evals.md`) | Golden set, RAG, extraction and agent suites, run locally, report in `reports/` |

### Should (week 4 if Must is done, else after)

- API mode and `reports/mode-comparison.md` (local vs API: quality, cost per 1,000 requests, latency).
- Budgets per workspace per day and month, with a clear refusal message.
- Admin pages: AI settings (mode switch without restart) and AI usage (cost per 1,000 requests, latency p50/p95, error rate, eval scores, feedback).
- Langfuse traces (needs ClickHouse, Redis and S3-compatible storage in current versions; verify before committing to it).
- Meeting-minutes schema; global `/ask` page; thumbs up/down feedback.
- Agent scenarios "Which contracts end in the next 90 days?" and "Create a project page from these meeting notes".
- `docs/data-protection.md` (needed as soon as API mode exists).

### Later

- Hosted public demo (needs API mode and the deferred security items in section 12).
- Bedrock and own-GPU modes, fallback chain, prompt caching.
- Terraform for the GPU server as a showcase: written and passing `terraform validate` and `plan`, applied at most once.
- Specification schema; slash command.
- Hands-on tests of Docmost Enterprise AI and the restyler fork.

## 9. What each feature spec must cover

Input for `/spec-feature`. Feature specs state observable behaviour; the mechanisms named here go into the plan. Features with UI link their mockup section in `docs/design/ai-assistant.html` in the User flow and refer to its state IDs (index and design decisions: `docs/design/README.md`).

**M2 Seed data**
- Company name checked against the Handelsregister and a web search; "Rheinwerk" is taken (Rheinwerk Verlag).
- Spaces Allgemein, HR, Vertrieb, Projekte, IT, Geschäftsführung (private). Users Geschäftsführer, Projektleiterin, Vertriebler, Werkstudent. At least one group-based membership.
- A permission matrix (user × space × page) as a table in the spec. It must include a restricted page inside an open space, written directly into `page_access`/`page_permissions` (core schema; the management UI is ee).
- About 30 pages, some outdated or contradictory on purpose. Each restricted page carries a unique canary string.
- About 8 PDFs (contracts, meeting minutes) generated by a script from structured data; that data is the extraction ground truth.
- One command rebuilds everything from scratch.

**M3 AI bridge**
- Section 7 items 1, 2 and 6. Rejection cases: expired token, wrong audience, missing service token, user id without user token.
- `{ai-queue}` processor hands jobs to ai-service's own durable queue (the core queue has `attempts: 1`).
- Docmost works unchanged when ai-service is down; the AI UI shows that the assistant is unavailable.
- Answers the open question about soft-deleted spaces in `getUserSpaceIds`.

**M4 Indexing**
- Markdown via `jsonToMarkdown`, chunks keep their heading path for section citations.
- Attachments: ai-service parses PDFs itself (core text extraction is ee-only). PDFs are searchable in Ask.
- Freshness: the time from a saved edit to searchable is measured and recorded; collaborative saves arrive with Hocuspocus' 10 to 45 s debounce.
- Section 7 item 7. Reconcile job compares `updated_at` and fixes gaps.
- German full-text search alongside vectors if the evals show it helps.

**M5 Ask** (design: overview, A1 to A4)
- Section 7 items 3, 4 and 8. Answers in German, streamed, each claim with a citation linking page and section.
- "I don't know" when no chunk passes the relevance threshold; the threshold is set from the eval baseline.
- Multi-turn within one panel session; history is kept in ai-service.

**M6 Leak tests**
- Prompt-content test: for every user in the permission matrix and every golden question, no chunk from a page the user cannot view is in the assembled prompt. Needs no model, runs in CI on every PR, any failure blocks.
- Canary suite: users without access ask about restricted content in many phrasings, including prompt injection in the question and inside readable pages. A canary string in any answer is a leak. Runs locally on the active mode.
- Revocation case: a user removed from a space gets no content from it on the next request.

**M7 Contract extraction** (design: E1 to E4)
- Fields: parties, term, notice period, value, renewal.
- Each field carries a source quote and page number. A field without a source is flagged as missing, never filled.
- Limits on file size and page count; scanned PDFs without a text layer are refused with a message (no OCR in v1).
- Insertion goes through Docmost's normal update path so live editors see it. If that is not workable, the plan inserts into a new child page instead and records the decision.
- Extraction time on the M3 Pro is measured and recorded.

**M8 Agent: outdated pages** (design: G1 to G6)
- "Find pages about X in space Y that look outdated and propose updates."
- Tools: search, read page, propose update. Reads and proposals run with the user's permissions.
- A proposal is stored in ai-service and shown as a diff. Nothing is written without the user's confirmation, and the confirmation applies exactly the shown diff.
- If the page changed after the proposal was made, applying is refused and the user can request a new proposal.
- A user with read-only access gets proposals but cannot apply them.
- Limits: maximum steps, run time and tokens per run; the user can cancel a run.
- Pages changed by the agent are recorded with user, run and time.

**M9 Request log**
- Cost per request from a dated price table per model; local mode costs 0 USD (hardware and energy not counted, stated in the report).
- User ids are stored as an HMAC with a secret, not in clear text.

**M10 Evals**
- Golden set: about 20 questions with expected source pages, the PDFs' ground truth, scripted agent scenarios.
- RAG: answer correctness, citation accuracy, groundedness, refusal when no source. Extraction: field-level accuracy. Agent: task success, no write without confirmation.
- First run sets the baseline; thresholds are set from it and recorded in the spec's Decisions.
- LLM-judged suites run locally (CI runners have no GPU); reports go to `reports/`.

## 10. Evals and CI split

| Suite | Needs a model | Where |
|---|---|---|
| Unit and integration tests (TS and Python) | no | CI, every PR |
| Prompt-content leak test | no | CI, every PR |
| Canary leak suite | yes | local, before each merge to `main` that touches retrieval, prompts or ai-bridge |
| RAG, extraction, agent evals | yes | local, on demand; results committed to `reports/` |

LLM suites are excluded from the kit's `KIT_TEST` (pytest marker) so CI stays deterministic.

## 11. Data protection

In local mode no page content, question or attachment leaves the developer's machine. The README and the video say so. Retention: request log and agent runs are kept for 30 days in the seed setup; conversation history until the panel session ends. `docs/data-protection.md` (data flows, AVV notes, TOMs) is written when API mode arrives (Should).

## 12. Deferred security

Known gaps, accepted for v1 because nothing is hosted and the model runs locally. Each must be closed before the trigger.

| Item | Risk | Planned fix | Due before |
|---|---|---|---|
| Public abuse | Strangers drain the API budget, upload content | Per-user and per-IP rate limits, per-user budget, upload limits, demo admin cannot switch modes | Hosted demo |
| CI secrets | Fork PRs could reach an API key | Paid evals only on trusted branches or manual dispatch; no key in PR workflows | API evals in CI |
| ee client code in builds | A public build bundles `apps/client/src/ee` | Build with ee client code stubbed out, or a legal answer on the ee license | Any published build or hosted demo |
| Indirect prompt injection | Pages or PDFs steer agent tools | v1 has confirmation per write and output sanitising; add tool allow-lists per scenario and injection cases in the canary suite | API mode or hosted demo |
| Trace content | Langfuse stores page text and questions | Retention limit, pseudonymous users, no raw attachments in traces | Langfuse in use |
| Service token | Static token, no rotation | Rotation procedure in the runbook | Hosted demo |
| Data processing | Anthropic receives content in API mode | `docs/data-protection.md`, EU options (Bedrock) | API mode |

## 13. Engineering and workflow

Built with the Agentic Workflow Kit (`vitoleonardo/agentic-development-template`, `templates/agentic-workflow-kit`).

**Setup (M1)**
1. `./install.sh <fork>` without an adapter, then `/onboard` in the fork. It records `.claude/baseline.tsv` so upstream test failures count as legacy.
2. Per-package configs (kit monorepo support):
   - `apps/server/.claude/kit.conf`: Jest (`jest`), NestJS preset. The server's `lint` script runs with `--fix`; the kit's lint command must not.
   - `apps/client/.claude/kit.conf`: Vitest, ESLint.
   - `ai-service/.claude/kit.conf`: Python adapter (uv, ruff, pyright, pytest), LLM suites excluded.
3. Protected paths: `apps/server/src/ee`, `apps/client/src/ee`, `packages/ee` through sandbox `denyRead`, deny rules and `KIT_PROTECTED_PATHS`. This replaces the current deny-only `.claude/settings.json` and closes the gap recorded in `docs/build-log.md`.
4. The kit's `quality-gates` workflow becomes the first CI test workflow in the fork (upstream only has `release.yml`), extended with the prompt-content leak test and a check that no new file imports from the ee paths.
5. Decide during `/onboard` how the 70 % coverage gate treats one-line wiring edits in untested upstream files (exclusion list or small tests).

**Per feature**
- Features with UI need an approved mockup in `docs/design/` before `/spec-feature`. A UI change that departs from the mockup updates the mockup in the same PR.
- `/ship-feature` in the order of section 8: spec in `specs/`, plan in `.work/`, tests first, review, PR into `ai-v1`.
- `docs/build-log.md` records where the kit caught problems, plus the kit's lead-time and token numbers per feature. This connects both portfolio projects.

**Development setup**
- Ollama runs natively on the MacBook. ai-service reaches it at a configurable base URL (localhost, or the Mac's address over LAN/Tailscale when developing on another machine).
- Docker on the Mac runs Postgres, Redis and optionally Docmost; memory left for the model is the constraint.

## 14. Deliverables

- The video, 2 to 3 minutes: role switch (Werkstudent vs Geschäftsführer on the same question), a refused answer, contract extraction with review, an agent proposal confirmed and applied, the leak-test and eval reports.
- `reports/eval-local.md` and `reports/leak-tests.md` with real numbers.
- `docs/adr/`: framework choice, inference layer, permission model, embedding strategy, local model choice.
- `docs/runbook.md`: start the stack, re-index, rotate secrets, reset seed data, incident checklist.
- `docs/extending.md`: add an extraction schema, an agent tool, an inference mode.
- `docs/case-study.md`: problem, approach, results with numbers from the reports.
- README with a local quickstart.
- A PR "Add AI knowledge assistant" from `ai-v1` into the fork's `main`, with screenshots.

## 15. Acceptance criteria (project level)

1. As Werkstudent, a question about content of space Geschäftsführung gets no content from it; as Geschäftsführer, the same question gets an answer citing the source page.
2. The prompt-content leak test passes in CI on every PR; the canary suite finds 0 canaries in all runs on the local mode.
3. Extraction of each seed contract matches the ground truth field by field or flags the field; the time on the M3 Pro is in the report.
4. No agent write happens without a confirmation, and a read-only user cannot apply a proposal (tested).
5. Every request appears in the request log with mode, model, tokens and latency.
6. `reports/eval-local.md` and `reports/leak-tests.md` exist with real numbers.
7. A fresh setup from the README on a Mac with Ollama works in under 30 minutes.
8. The kit's quality gates are a required check and green on the final PR.
9. No code from the ee directories is used; no client or real company data anywhere.

## 16. Milestones (about 4 weeks)

| Week | Must features |
|---|---|
| 1 | Mockups approved (done: `docs/design/`), M1 kit setup, M2 seed data, M3 AI bridge |
| 2 | M4 indexing, M5 Ask, M6 leak tests |
| 3 | M7 contract extraction, M8 agent, M9 request log |
| 4 | M10 evals and reports, video, docs and case study; then Should items |

## 17. Competitive position

Details and sources: `docs/competitive-analysis.md`. Summary, after the Phase 0 corrections:

| Capability | Docmost Enterprise AI | restyler fork | This project |
|---|---|---|---|
| License | paid (Business or Enterprise) | open, alpha, inactive | open (AGPL) |
| Q&A over wiki with sources | yes (AI Answers, AI Chat) | yes | yes |
| Permission scoping | claimed in docs, not published as tests | space-level filter | page-level filter before generation, leak tests in CI |
| Structured extraction from attachments | not documented | no | yes, with source per field and human review |
| Agent with confirmed writes | not documented | no (plan only) | yes, under the user's permissions |
| Local inference | Ollama | OpenAI-compatible | Ollama in v1; API, Bedrock, own GPU as configuration |
| Evals and reports | not documented | no | yes, published |
| Cost logging | not documented | no | per request; budgets in Should |

Positioning: not "a better Docmost", but "what a production-grade AI feature looks like when you build it into an existing product". Be fair about Docmost; credit the maintainers.

## Changelog

- **v1.1 (2026-10-27)**: Phase 0 findings folded in (permission filter before generation, enterprise AI Chat, core AI plumbing). Scope split into Must, Should and Later. Local inference on the MacBook is the only Must mode; the four modes become configurations of one OpenAI-compatible adapter. Hosted demo replaced by a video. Deferred security documented. Workflow through the Agentic Workflow Kit with feature specs in `specs/`. New seed company name. Mockups for M5, M7 and M8 in `docs/design/`.
- **v1 (2026-10-23)**: initial spec.
