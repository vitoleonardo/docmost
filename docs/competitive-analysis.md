# Competitive analysis

Status: **desk research verified on 2026-10-23. Hands-on tests are pending** (see "Open").
Sources: public docs, public repo metadata, and core UI wiring of Docmost v0.96.0. No ee code and no restyler code were read beyond the file lists and the planning document.

## Docmost Enterprise AI

| Topic | Finding | Source |
|---|---|---|
| Licensing | Business ($6/seat/month billed annually, min. 10 seats) or Enterprise. Self-managed trial licenses are available through sales. | docmost.com/pricing |
| Features | Ask AI in the editor (improve, fix, shorten/lengthen, continue, explain, summarize, tone, translate into 11 languages, custom prompt), AI Answers in search, **AI Chat**, MCP | docs user-guide/ai; core client routes `/ai`, `/ai/chat/:chatId`, aside chat panel, home prompt |
| Providers | `AI_DRIVER` = openai, openai-compatible, gemini, ollama. pgvector is required. Embedding dimensions limited to 768/1024/1536/2000/3072. | docs self-hosting/ai/ai-search; `environment.validation.ts` |
| Permissions (claimed) | "AI Answers only searches content you have permission to access." "Results are scoped to the spaces and pages visible to your account." | docs user-guide/ai |
| Not documented | evals, cost/budgets, usage dashboard, structured extraction, Bedrock or vLLM | docs (absence) |

Corrections to spec section 13:
- Enterprise has an in-product AI Chat. Phrase our difference as "agent with tool use under user permissions and confirmed writes", not "no in-product agent", until hands-on testing shows what the chat can do.
- The docs claim page-level scoping, so do not imply weak permissions. Our differentiator is *proving* it with automated leak tests and publishing the results.

## restyler/docmost

| Topic | Finding |
|---|---|
| Activity | 1 star, 0 forks, last push 2025-12-24. 16 commits ahead of and 440 behind docmost/main. |
| License | AGPL-3.0 (repo). Its plan document mentions a GPL-3.0 module. |
| Changes | 23 files: `core/ai` (controller, module, queue processor, service, OpenAI service), a `page_embeddings` migration, env getters. **It also modifies files under `apps/client/src/ee/ai/*`.** |
| "Agent" | `BYOK_AI_AGENT.md` is an integration plan ("Next steps"). No agent code appears in the changed-file list, only generate/ask/embeddings. |

Consequences:
- The fork edits enterprise-licensed client files. That is one more reason to use it only as a black-box comparison and never as a code source.
- It is based on a much older upstream. Running it needs its own database (it is not schema-compatible with v0.96.0).

## Open (needs decisions)

1. **Run restyler hands-on**: needs our seed data (Phase 1, week 1) and an OpenAI or OpenAI-compatible key, or Ollama (not installed on this machine).
2. **Enterprise AI hands-on**: a trial license would have to be requested from Docmost sales, which means outward contact under your name. Then run the golden questions, especially the restricted-space and restricted-page cases.
3. Record results here: answer quality, citations, behaviour on restricted spaces and pages, and prompt-injection attempts.
