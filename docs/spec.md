# Docmost AI: Specification v1

Working name: `docmost-ai` (final name open).

## 1. Purpose

A public portfolio project that demonstrates the freelance offer "KI-Feature-Sprint" end to end:

> I build an LLM, RAG or agent feature into your existing stack, with evals, cost control, permissions and monitoring. Built in your code, handed over to your team.

The project adds an AI knowledge assistant to Docmost, an existing open-source wiki (Confluence/Notion alternative, NestJS + React + Postgres). Working inside a real, foreign codebase is the point: it is what clients buy.

Target audience of the demo: CTOs, Heads of Engineering and IT leads in German Mittelstand companies who run internal tools and care about data protection, permissions and running models on their own infrastructure.

## 2. The feature in one sentence

"Your company wiki answers questions, turns attached documents into structured pages and keeps itself up to date, but only with what each employee is allowed to see, and on request entirely on your own servers."

## 3. Hard rules

1. Fork Docmost at a pinned release tag. Do not chase upstream during v1.
2. Never read, copy, modify or depend on code in `apps/server/src/ee`, `apps/client/src/ee` or `packages/ee` (enterprise license). Do not reimplement enterprise features 1:1.
3. Keep changes inside Docmost minimal and isolated: one NestJS module, one client feature folder, required wiring. All AI logic lives in the separate Python service.
4. The full fork stays public under AGPL-3.0 (required when hosted publicly).
5. No real company data. All demo content is fictional seed data.

## 4. Phase 0: codebase check (do this first, then stop for review)

Claude Code clones Docmost at the latest stable tag and writes `docs/phase0-report.md` with:

1. Repo size and structure (apps, packages, lines of code per area), build and local dev setup that works.
2. How permissions work: spaces, groups, roles, CASL abilities. How to ask "can user U read page P?" from the server.
3. How pages are stored (Tiptap/ProseMirror JSON, Yjs collaboration state) and how to get clean text or markdown per page.
4. How attachments are stored and accessed.
5. Existing events, queues or hooks for page create/update/delete (for incremental indexing).
6. Where the enterprise AI features live and what they do, at the level of public docs and UI only. No ee code is read in detail.
7. Proposed integration points: server module location, client UI location (side panel, slash command, page action), auth handoff.
8. Risks and open questions.
9. Existing AI plumbing in the core (outside ee): check for AI-related environment getters, a `page_embeddings` table, an AI queue and page events such as `PAGE_CREATED` / `PAGE_CONTENT_UPDATED`. The restyler fork (section 13) suggests these exist. Reuse core plumbing where it is AGPL; never use ee code.
10. Competitive check (section 13): run the restyler fork locally and test it with the seed data. If a Docmost cloud trial or enterprise trial is legally available, test the enterprise AI Answers with the same golden questions, especially permission behaviour. Record results in `docs/competitive-analysis.md`. Do not copy code from the fork; our implementation stays independent.

I review and approve before Phase 1.

## 5. Architecture

```
Docmost fork (TypeScript)
  apps/client   React + Mantine   -> AI panel, page actions, admin pages
  apps/server   NestJS            -> new module: ai-bridge
        |  signed user context (short-lived JWT: user id, workspace id, readable space ids)
        v
ai-service (Python, FastAPI)
  ingestion     LlamaIndex: page + attachment ingestion, chunking, retrieval
  extraction    Pydantic AI: attachment -> typed schema -> structured page or table
  agent         LangGraph: multi-step tasks with tools that call back into Docmost
  inference     own provider layer with 4 modes (section 6)
  evals         eval suites run in CI and on demand
        |
Postgres + pgvector (separate schema or DB for AI data)
Redis (queues, budgets, rate limits)
Langfuse (self-hosted) + OpenTelemetry (traces, cost, scores)
```

Why three frameworks: each has one job. LlamaIndex for ingestion and retrieval, Pydantic AI for typed extraction, LangGraph for the agent. Document this as an ADR. If one framework adds no value during the build, drop it and record why.

## 6. Inference modes

The user (admin) chooses the mode per workspace and optionally per task (extraction, RAG answer, agent, embeddings).

| Mode | Use case | Implementation |
|---|---|---|
| Local inference | development, offline demo, maximum privacy | Ollama on the local machine |
| LiteLLM | switch between API providers | LiteLLM proxy (Claude, OpenAI, others) |
| Amazon Bedrock | companies already on AWS | Bedrock in an EU region |
| Own GPU server | full data sovereignty in production | vLLM with an open-weights model, provisioned by Terraform |

Requirements:

- One `InferenceProvider` interface, four adapters. Business logic never knows which mode is active.
- One central model registry that hands each framework (LlamaIndex, Pydantic AI, LangGraph) its matching model object from the same config, so there is one switch, not three.
- Capability matrix per model: tool calling, structured output, prompt caching, context size. Startup check warns if a mode cannot serve a task well.
- Fallback chain configurable, e.g. GPU server then Bedrock.
- Embeddings: vectors are stored per embedding model (separate collection or column per model). Switching the embedding model triggers a re-index job. Default: one embedding model per deployment.
- GPU server is not always on. Terraform plus scripts to start, stop and health-check it. Demo shows a cost comparison and break-even: at what monthly volume the own server beats API pricing.
- Verify current model names, features and prices of every provider at build time. Do not hardcode prices without a source and date.

## 7. Feature scope v1

### 7.1 Ask the wiki (RAG)
- Side panel "Ask" on every page and a global ask page.
- Answers with citations linking to the exact pages and sections.
- Retrieval only over spaces the user can read. Filter at retrieval time by space ids from the signed context, then re-check each cited page through Docmost's own permission check before returning.
- "I don't know" when sources are insufficient.

### 7.2 Attachments to structure (extraction)
- Page action on an attached PDF: "Extract".
- Built-in schemas: contract (parties, term, notice period, value, renewal), meeting minutes (date, attendees, decisions, action items with owners), specification (requirements list).
- Output validated against the schema, shown for human review, then inserted as a structured page section or table.
- Low-confidence fields are flagged, never silently filled.

### 7.3 Wiki agent
Tools call Docmost through the ai-bridge with the user's permissions, never with admin rights.
- "Find pages about X that look outdated and propose updates" (proposals as drafts, never auto-published).
- "Create a project page from these meeting notes."
- "Which contracts end in the next 90 days?" (uses extracted data).
- Every write action requires user confirmation in the UI.

### 7.4 Cost control
- Cost per request logged (model, tokens in/out, cached tokens, cost).
- Budget per workspace per day and month; requests are refused with a clear message when exceeded.
- Task routing: small model for extraction and classification, larger model for agent and complex answers.
- Prompt caching where the provider supports it.
- Public demo shows a live counter, e.g. "Today: 1.20 USD of 5 USD budget".

### 7.5 Monitoring
- Langfuse traces for every request, linked to user (pseudonymized), workspace, mode and task.
- Admin page in Docmost "AI usage": cost per 1,000 requests, latency p50/p95, error rate, eval scores over time, thumbs up/down feedback.

### 7.6 Evals
- Seed dataset (section 8) with a golden set of questions, expected source pages and expected extraction outputs.
- Suites:
  - RAG: answer correctness, citation accuracy, groundedness, refusal when no source.
  - Extraction: field-level accuracy per schema.
  - Permissions: leak tests. A user without access to space "Geschäftsführung" asks about its content in many phrasings, including prompt injection. Any leak fails the build.
  - Agent: task success on scripted scenarios, no write without confirmation.
- Runs in CI on every PR against the default mode (cheap model), with thresholds that block the merge.
- Comparison run across all four modes on demand, producing `reports/mode-comparison.md`: quality, cost per 1,000 requests, latency per mode. This report is a key portfolio artifact.

## 8. Seed data

A fictional Mittelstand company, e.g. "Rheinwerk Maschinenbau GmbH" (check the name is not a real company), in German:

- Spaces: Allgemein, HR, Vertrieb, Projekte, IT, Geschäftsführung (restricted).
- 60 to 100 pages, some deliberately outdated or contradictory.
- 15 to 25 PDF attachments: supplier contracts, meeting minutes, specifications.
- Users with different roles: Geschäftsführer, Projektleiterin, Vertriebler, Werkstudent.
- A seed script that rebuilds everything from scratch.

## 9. Handover artifacts (part of the deliverable)

- `docs/adr/` architecture decisions (framework split, inference layer, permission model, embedding strategy).
- `docs/runbook.md` operations: start/stop GPU server, rotate keys, re-index, budget changes, incident checklist.
- `docs/extending.md` how to add an extraction schema, an agent tool, a new inference mode.
- `docs/case-study.md` problem, approach, results with numbers from the eval reports. Source for the website case and LinkedIn posts.
- A clean, well-described PR in the fork: "Add AI knowledge assistant" with before/after screenshots.

## 10. Hosting

- Live demo: low-cost hosting in EU regions. Docmost and ai-service as containers, managed Postgres with pgvector, managed Redis, Langfuse self-hosted on the same small server if feasible.
- Terraform in the repo for an AWS production setup (ECS or similar, RDS, S3, Bedrock access) and for the GPU server. Not permanently deployed.
- Public demo logins for each role, reset nightly by the seed script.

## 11. Acceptance criteria

- A role switch in the demo visibly changes what the assistant can answer.
- Leak test suite passes with zero leaks in all four modes.
- Extraction of a seed contract produces a correct, reviewed table in under 30 seconds in API mode.
- Mode can be switched by an admin without restart; a request trace shows the active mode.
- Budget limit stops requests with a clear message.
- `reports/mode-comparison.md` exists with real numbers for all four modes.
- Fresh setup from README works locally in under 30 minutes, with local inference mode.
- No code from the ee directories is used; no client or real company data anywhere.

## 12. Milestones (about 4 weeks)

| Week | Milestone |
|---|---|
| 1 | Phase 0 report approved, fork running locally, seed data, ai-bridge with signed user context |
| 2 | Inference layer with 4 modes, ingestion and permission-aware RAG with citations, leak tests |
| 3 | Extraction with review UI, agent with confirmed write actions, budgets and cost logging |
| 4 | Evals in CI, mode comparison report, admin usage page, hosting, docs, case study, launch |

## 13. Competitive analysis (desk research, 23.10.2026)

Based on public docs and repos only. To be verified hands-on in Phase 0.

### 13.1 Docmost Enterprise AI

What it offers (per docs.docmost.com/docs/user-guide/ai):
- Ask AI in the editor: improve writing, continue writing, custom prompts on selected text.
- AI Answers in search: natural-language questions answered from workspace pages via vector embeddings.
- Provider choice: OpenAI, Google Gemini, or local LLMs via Ollama.
- MCP server (enterprise): external AI clients can search, read, create and update pages via API key.
- Requires an active enterprise license; admins enable features in AI settings.

Strengths:
- Native UX, built by the maintainers, maintained with every release.
- Local LLM option via Ollama answers the data-protection question.
- MCP opens the wiki to external agents such as Claude.
- Covers the two most common needs: writing help and Q&A.

Weaknesses or gaps (from docs; verify, do not overclaim):
- Paid enterprise license; not available in the open-source core.
- No documented evals, quality metrics or regression tests for answers.
- No documented cost control: budgets, per-request cost, task routing.
- No documented monitoring or usage dashboard for admins.
- No structured extraction from attachments (contracts, minutes, specs).
- No in-product agent for multi-step tasks; agentic work requires an external MCP client.
- Provider list does not mention Amazon Bedrock or vLLM on own GPU servers.
- Permission behaviour of AI Answers is not documented in detail. Test it, do not assume it is weak.

### 13.2 restyler/docmost (open BYOK fork)

Facts (github.com/restyler/docmost and its BYOK_AI_AGENT.md):
- Experimental alpha, 1 star, 0 forks at time of research.
- OpenAI and OpenAI-compatible APIs only, configured via environment variables.
- Endpoints for generate, streaming generate and ask (RAG with sources), implemented as a NestJS module in `core/ai`.
- Embeddings in pgvector `page_embeddings`, filled via queue jobs on page events, with space-level filtering.
- The BYOK document is an integration plan; check how much of the "agent" actually exists.
- Licensing note: the plan mentions a GPL-3.0 module inside an AGPL project. Not our concern, but a reason not to copy code.

Gaps: no evals, no cost control, no monitoring, no extraction, no Bedrock or GPU mode, no agent with confirmed writes, single provider config.

### 13.3 How this project stands out

| Capability | Docmost Enterprise AI | restyler fork | This project |
|---|---|---|---|
| License | paid enterprise | open (alpha) | open (AGPL), production-grade |
| Q&A over wiki with sources | yes | yes | yes, plus re-check of every cited page against Docmost permissions |
| Permission leak tests | not documented | no | automated, blocking in CI |
| Structured extraction from attachments | no | no | yes, typed schemas with human review |
| In-product agent | no (external via MCP) | unclear | yes, with user permissions and confirmed writes |
| Inference modes | OpenAI, Gemini, Ollama | OpenAI-compatible | local, LiteLLM, Bedrock, own GPU (vLLM), routing and fallback |
| Evals and mode comparison | not documented | no | yes, report across all modes |
| Cost control and budgets | not documented | no | yes |
| Monitoring dashboard | not documented | no | yes |

Positioning line for README and case study: not "a better Docmost", but "what a production-grade AI feature looks like when you build it into an existing product". Be fair and accurate about Docmost; credit the maintainers.

## 14. How it is built

Built with the Agentic Workflow Kit (rules, hooks, quality gates) from day one. Keep `docs/build-log.md` with notable moments where the workflow caught problems. This connects both portfolio projects.
