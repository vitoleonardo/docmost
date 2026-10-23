# Phase 0 report: Docmost codebase check

Date: 2026-10-23. Fork: `vitoleonardo/docmost`, branch `ai-v1` at tag **v0.96.0** (2026-09-08, latest non-prerelease).

Rule followed throughout: nothing under `apps/server/src/ee`, `apps/client/src/ee` or `packages/ee` was read. Statements about ee come only from import/require lines in core files and from public docs. All file references are relative to `apps/server/src` unless stated otherwise.

## TL;DR

- Fork builds and runs locally (build ~1.5 min, migrations clean, health OK, setup/page APIs verified).
- `apps/server/src/ee` is a **git submodule** pointing to the private repo `docmost/ee`. It is not checked out, so the server is a pure core build. `apps/client/src/ee` and `packages/ee` are plain directories in the repo.
- Core already contains **AGPL AI plumbing without a consumer**: AI env getters, a `PageEmbeddings` type, `settings.ai.*` workspace flags, and an `{ai-queue}` that receives page lifecycle jobs (including collaborative edits). In a core build those jobs are never processed (verified: they pile up in Redis).
- Core has **page-level restrictions** (`page_access`, `page_permissions`) enforced in core, though only ee writes them. One service answers "can U read P?": `PageAccessService.validateCanView`.
- **Design change needed (spec 7.1):** space-id filtering plus re-checking *cited* pages is not enough. Restricted pages inside readable spaces would reach the LLM context before the re-check. Retrieved chunks must be permission-filtered **before generation**.

## 1. Repo size, structure, build

| Area | Files (.ts/.tsx, ee excluded) | Lines |
|---|---|---|
| `apps/server/src` | 444 | 45,036 |
| `apps/client/src` | 507 | 51,193 |
| `packages/editor-ext` | 128 | 14,401 |
| `packages/base-formula` | 21 | 1,584 |

- Working tree 13 MB, pack 19 MB, 52 migration files. Monorepo: pnpm 11.25 (corepack) + Nx 23. Server is NestJS + Fastify + Kysely, client is React + Vite + Mantine + Tiptap 3, collaboration is Hocuspocus/Yjs (runs inside the server process by default).
- **Local setup that works** (verified 2026-10-23, Node 24.22):
  1. `docker compose -f ../docker-compose.dev.yml up -d`: `pgvector/pgvector:pg18` on 5433 and `redis:8` on 6380. The pgvector image is chosen now because the AI schema needs it.
  2. Copy `.env.example` to `.env`. Set `APP_SECRET` (`openssl rand -hex 32`), `DATABASE_URL=postgresql://docmost:docmost@localhost:5433/docmost`, `REDIS_URL=redis://127.0.0.1:6380`. `MAIL_DRIVER` must be `smtp` or `postmark`; `log` is rejected by validation.
  3. `corepack enable` (installs pnpm), then `pnpm install --frozen-lockfile` (~70 s), `pnpm build` (~90 s), and `pnpm --filter ./apps/server run migration:latest`.
  4. Start with `pnpm start` (prod build on :3000) or `pnpm dev` (client on Vite plus server in watch mode).
  5. Checks: `/api/health` reported DB and Redis up, `POST /api/auth/setup` created the workspace, `POST /api/pages/create` with `format: markdown` and `POST /api/pages/info` with `format: markdown` both worked.
- The client build includes `apps/client/src/ee` (core client files import `@/ee/...`). The server runs without ee: `app.module.ts:34-46` requires `./ee/ee.module` in a try/catch.

## 2. Permissions

- **Roles** (`common/helpers/types/permission.ts`):
  - Workspace `UserRole`: owner, admin, member.
  - `SpaceRole`: admin, writer, reader.
  - Space visibility: open or private.
  - Page access: `restricted`, with `PagePermissionRole` reader or writer.
- **Membership**: `space_members` holds a userId or a groupId plus a role. Groups come via `groups` and `group_users`. The effective role is the highest of direct and group membership (`database/repos/space/space-member.repo.ts:228`, cached).
- **CASL**:
  - `core/casl/abilities/workspace-ability.factory.ts` works from the user role.
  - `core/casl/abilities/space-ability.factory.ts:20-38`: admin manages everything, writer manages Page and Share, reader reads. No role means `NotFoundException`.
- **Page-level restrictions** (`database/repos/page/page-permission.repo.ts`):
  - Inherited down the page tree. The user needs a permission on every restricted ancestor.
  - Implemented with recursive CTEs: `canUserAccessPage` (:371), `canUserEditPage` (:383), `filterAccessiblePageIds` (:656), `hasRestrictedPagesInSpace` (:889).
  - Core enforces restrictions but never creates them. Managing them is ee (UI import `@/ee/page-permission`).
- **"Can user U read page P?"**: `core/page/page-access/page-access.service.ts:24` `validateCanView(page, user)` checks the space ability `Read Page` first, then `canUserAccessPage`. It throws `ForbiddenException`. Load the page with `pageRepo.findById`.
- **Readable spaces for U**: `spaceMemberRepo.getUserSpaceIds(userId)` (:314), or the embeddable `getUserSpaceIdsQuery` (:298). Open question: whether it excludes soft-deleted spaces.
- **Bulk filter for retrieval**: `pagePermissionRepo.filterAccessiblePageIds({pageIds, userId, spaceId?})`. This is what core search uses (`core/search/search.service.ts:117-190`). It short-circuits when a space has no restricted pages.
- **Auth**:
  - JWT from the `authToken` cookie (httpOnly, lax) or a Bearer header (`core/auth/strategies/jwt.strategy.ts`). It is signed with `APP_SECRET`, validated against the workspace and the active session.
  - Token types include `access`, `collab` and `attachment`.
  - API keys: the table and token type are in core, but validation requires ee (`jwt.strategy.ts:104`). **API keys are not usable in a core build.**

## 3. Page storage and text

- `pages` stores three representations:
  - `content`: ProseMirror/Tiptap JSON.
  - `text_content`: plain text, generated with `jsonToText`.
  - `ydoc`: Yjs state as bytea.
  - Plus `tsv` (full-text index, English config, title weight A and text weight B).
- **Collab writes**: `collaboration/extensions/persistence.extension.ts:98` `onStoreDocument` (Hocuspocus debounce 10 s, max 45 s).
  - Rebuilds the JSON from the Yjs doc and computes `textContent`.
  - Skips the write if nothing changed.
  - Updates the row, then enqueues `PAGE_CONTENT_UPDATED` to `{ai-queue}` (:211).
- **REST writes**: `PageService.create` / `updatePageContent` produce all three representations, and content updates go through the collaboration gateway.
- **Conversion utilities**:
  - `collaboration/collaboration.util.ts`: `jsonToText` (:149), `jsonToHtml` (:134), `jsonToMarkdown` (:246, via turndown in `packages/editor-ext`).
  - `common/helpers/prosemirror/utils.ts`: `getAttachmentIds`, `getProsemirrorContent`.
  - `/api/pages/info` with `format: "markdown"` returns markdown (verified).
- **For chunking**: use markdown, which keeps headings for section-level citations. Our own code can compute heading anchors from the ProseMirror JSON.

## 4. Attachments

- **Table** `attachments`: id, fileName, filePath, fileSize, fileExt, mimeType, type, pageId, spaceId, workspaceId, creatorId, aiChatId, `text_content` + `tsv`.
- **Storage**: drivers local, S3 and Azure (`integrations/storage`). Path is `{workspaceId}/files/{attachmentId}/{fileName}`. The interface provides `read`/`readStream`/`getSignedUrl`.
- **Upload**: `POST /api/files/upload` (multipart, `pageId`, requires edit rights on the page).
- **Download**: `GET /api/files/:id/:name` (JWT plus `validateCanView` on the page; supports range requests).
- **Link to pages**: `attachments.pageId`, plus `attrs.attachmentId` on attachment and PDF nodes in the content.
- **PDF/DOCX text extraction is ee-only.** `core/attachment/processors/attachment.processor.ts:36-61` dispatches to ee and returns silently without it. `attachments.text_content` therefore stays NULL in our build. `@docmost/pdf-inspector` and `mammoth` are dependencies but unused in core. Consequence: **ai-service does its own PDF parsing** (it needs layout-aware parsing for extraction anyway).

## 5. Events, queues, hooks

- EventEmitter events (`common/events/event.contants.ts`) use the payload `{pageIds, workspaceId}`. They are handled in `database/listeners/page.listener.ts`.
  - `PAGE_CREATED`: `page.repo.ts:191`, duplicate, import.
  - `PAGE_UPDATED`: `page.repo.ts:156`. Fired **inside the caller's transaction, before commit**, and `workspaceId` is usually undefined.
  - `PAGE_SOFT_DELETED`, `PAGE_RESTORED`, `PAGE_DELETED`.
- **`{ai-queue}`** (BullMQ, `attempts: 1`, remove on complete/fail, `integrations/queue/queue.module.ts:70-77`) receives:
  - `PAGE_CREATED`, `PAGE_SOFT_DELETED`, `PAGE_RESTORED`, `PAGE_DELETED` (from the listener).
  - `PAGE_CONTENT_UPDATED` (collab store, after commit).
  - `PAGE_MOVED_TO_SPACE` (`core/page/services/page.service.ts:517`, includes the new `spaceId`).
  - `SPACE_DELETED`, `WORKSPACE_DELETED`.
  - Workspace embedding jobs when `settings.ai.search` is toggled (`core/workspace/services/workspace.service.ts:684-700`).
- **There is no `{ai-queue}` processor in core.** Verified: after creating a page, the job sits in `bull:{ai-queue}:wait`.
- Membership and permission changes emit nothing relevant. That is fine because permissions are applied at query time, not at index time.

## 6. Enterprise AI (public docs and core UI wiring only)

From docmost.com/docs/user-guide/ai, /docs/self-hosting/ai/ai-search and /pricing:

- **Plans**: AI requires a Business license ($6/seat/month billed annually, 10-seat minimum) or Enterprise. Self-managed trial licenses are available through sales.
- **Features**:
  - Ask AI in the editor: improve, fix, shorten/lengthen, continue, explain, summarize, tone, translate, custom prompt.
  - AI Answers in search.
  - AI Chat (core client routes `/ai`, `/ai/chat/:chatId`, an aside chat panel, a home prompt; core migration `ai_chats`/`ai_chat_messages`).
  - MCP server.
- **Providers**: `AI_DRIVER` = openai, openai-compatible, gemini, ollama. Requires pgvector. Embedding dimensions are limited to 768/1024/1536/2000/3072.
- **Permissions claim (docs)**: "AI Answers only searches content you have permission to access." "Results are scoped to the spaces and pages visible to your account."
- **Gating in core**: workspace settings `settings.ai.{search,generative,chat,mcp}` plus license features `AI`, `AI_CONTROLS`.
- **Correction to spec 13.1/13.3**: Enterprise has an in-product **AI Chat**. "No in-product agent" needs to be rephrased as "no documented agent with confirmed write actions" after hands-on testing.

## 7. Proposed integration points

**Server: `apps/server/src/integrations/ai-bridge/`** (module, controller, service, queue processor), registered in `app.module.ts`.

| Responsibility | How |
|---|---|
| Auth handoff | Client calls `/api/ai/*` with the normal cookie. ai-bridge checks the session, computes readable space ids (`getUserSpaceIds`) and signs a short-lived JWT for ai-service. Use a separate secret `AI_BRIDGE_SECRET`, not `APP_SECRET`. Claims: sub, workspaceId, spaceIds, exp ≤ 60 s, aud `ai-service`. |
| Permission filter before generation | Internal endpoint `POST /api/ai-bridge/internal/filter-pages`, authenticated by service token plus user context. Calls `filterAccessiblePageIds` per space. ai-service calls it on retrieved candidates *before* building the prompt. Final re-check of citations with `validateCanView`. |
| Content for indexing | Internal endpoint returning markdown and metadata per page id (`jsonToMarkdown`), plus attachment streams via the storage driver. Service token only, workspace-scoped. |
| Incremental indexing | **Reuse `{ai-queue}`**: an ai-bridge `@Processor(QueueName.AI_QUEUE)` forwards page jobs to ai-service. This catches collab edits without touching the collaboration code. Valid because the server ee submodule is absent. If ee were ever present, two consumers would compete; documented as a constraint. |
| Agent tools | ai-service calls back to ai-bridge with the user context. ai-bridge loads the user and goes through the existing services (`PageService`, `PageAccessService`) so the user's own permissions apply, never admin rights. Writes create draft proposals and need explicit confirmation from the UI. |
| Workspace AI settings and budgets | Stored in ai-service (its own schema). Admin role checked via the workspace CASL ability in ai-bridge. |

**Client: `apps/client/src/features/ai-assistant/`** (pattern from `features/label/`):

| UI | Hook point |
|---|---|
| "Ask" side panel | New aside tab `"ask"` in `components/layouts/global/aside.tsx` (switch at :41-60), `hooks/use-toggle-aside.tsx`, aria label in `global-app-shell.tsx:150-169` |
| Page action "Ask about this page" | `features/page/components/header/page-header-menu.tsx` via `useAsideTriggerProps("ask")` |
| "Extract" on a PDF | Action group in `features/editor/components/attachment/attachment-view.tsx:69-85` and `pdf/pdf-view.tsx:153-177` |
| Global ask page | Route `/ask` in `App.tsx` (`/ai` is taken by ee) |
| Admin "AI usage" and settings | Route under `/settings/ai-assistant`, entry in `components/settings/settings-sidebar.tsx` (`role: "admin"`) |
| Slash command (optional) | `features/editor/components/slash-menu/menu-items.ts` |
| i18n | `apps/client/public/locales/{en-US,de-DE}/translation.json` (key = English string) |

The feature uses its own flag, not `settings.ai.*` or `useHasFeature`. That avoids any dependency on `@/ee` hooks and on the ee AI UI, which reads the same flags.

## 8. Risks and open questions

1. **Leak path in spec 7.1 (high).** Restricted pages inside readable spaces. Mitigation: pre-generation filter through `filterAccessiblePageIds` (section 7). Seed data should include at least one restricted page inside an open space (needs ee UI to create, so seed it directly into `page_access`/`page_permissions`; the schema is core). The leak test suite should cover it.
2. **Stale context in the signed JWT.** Space ids are a snapshot. Keep the TTL short and rely on the pre-generation filter as the authoritative check.
3. **`{ai-queue}` uses `attempts: 1`** and remove-on-fail. A failed forward is lost. Our processor should hand off to ai-service's own durable queue quickly, and a periodic reconcile job (compare `updated_at`) should catch gaps.
4. **The `PAGE_UPDATED` listener runs before commit** and lacks `workspaceId`. Do not use it; rely on the `{ai-queue}` jobs and re-read the page.
5. **Shipping ee client code.** A public build of the fork bundles `apps/client/src/ee` (as upstream's own images do). Spec rule 4 (AGPL, public) and the ee license need a short legal check before hosting the demo. Option: build with ee client code stubbed out. Not assessed in detail because the ee license was not read.
6. **Core search uses the `english` tsvector config.** Irrelevant for vector RAG, but hybrid retrieval over German seed data should use its own German FTS in ai-service.
7. **Upstream drift.** Core already reserves AI routes and flags. We pin v0.96.0 (rule 1) and keep wiring to a handful of files listed in section 7.
8. **Open**:
   - Does `getUserSpaceIds` exclude soft-deleted spaces? To be checked in Phase 1 with a test.
   - Hands-on tests of enterprise AI and the restyler fork are still pending (see `competitive-analysis.md`).

## 9. Existing AI plumbing outside ee: reuse decision

| Item | Location | Reuse? |
|---|---|---|
| `AI_DRIVER`, `AI_*_MODEL`, `OPENAI_*`, `GEMINI_API_KEY`, `OLLAMA_API_URL`, `AI_VECTOR_DRIVER`, Turbopuffer getters | `integrations/environment/environment.service.ts:288-360` | **No.** Inference config lives in ai-service (4 modes, per-workspace switch without restart). Setting `AI_DRIVER` would also flip ee-oriented behaviour. |
| `PageEmbeddings` type | `database/types/embeddings.types.ts` | **No.** No core migration creates `page_embeddings`, and the shape is tied to the ee vector implementation. Our vectors live in ai-service's own schema, one table per embedding model (spec 6). |
| `{ai-queue}` + page lifecycle jobs | `integrations/queue/*`, `page.listener.ts`, `persistence.extension.ts:211` | **Yes**, as the indexing trigger (section 7). |
| `settings.ai.*` flags and `updateAiSettings` | `core/workspace/*` | **No.** They drive the ee UI; we use our own settings. |
| `ai_chats` / `ai_chat_messages` tables | migration `20260409T132415-ai-chat.ts` | **No** for v1. Conversation history lives in ai-service. |
| `filterAccessiblePageIds`, `PageAccessService`, `getUserSpaceIds`, `jsonToMarkdown`, storage driver | core | **Yes**, all central to ai-bridge. |

## 10. Competitive check

See `docs/competitive-analysis.md`. Desk research has been verified. Hands-on runs of the restyler fork and enterprise AI are pending three decisions (seed data first, an API key or local Ollama, and requesting a trial license from Docmost sales).

## Decisions after review

- **2026-10-23: The demo LLM is the Anthropic API**, using the owner's regular Anthropic API key (about $100 of API credit that comes with the Max plan).
  - **Prices** (Anthropic list, cached 2026-10-06; re-check at build time):

    | Model | Input $/MTok | Output $/MTok | Cache read $/MTok |
    |---|---|---|---|
    | Claude Haiku 5.5 (`claude-haiku-5-5`), prompts ≤100K | 0.10 | 0.50 | |
    | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | 2 | 10 | 0.20 |
    | Claude Opus 5.5 (`claude-opus-5-5`) | 4 | 20 | 0.20 |

  - **Task routing (spec 7.4)**:
    - Haiku 5.5: extraction and classification.
    - Sonnet 5.5: RAG answers.
    - Opus 5.5: agent tasks only if evals show they need it.
  - **Embeddings**: Anthropic has no embeddings API. ai-service embeds locally with an open multilingual model (German seed data). This needs no extra key and also serves local mode.
  - **Key handling**: the key lives server-side in ai-service only and never reaches the client. A hard spend limit is set in the Anthropic Console in addition to the app's own budget.
  - **Outside this credit**: Bedrock and the own-GPU mode need AWS spend. That is not covered by the $100.
- **2026-10-23: No Ollama on the demo server.**
  - Embeddings run in-process in ai-service, with an open multilingual model on CPU.
  - "Local inference" stays a mode for development and offline use on a dev machine.
  - Hands-on competitive tests need another embedding provider. Still open.
