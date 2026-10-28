# Structure

Every kind of code has one home. The Map below says where; `.claude/bin/structure` enforces it for new source files (the guard blocks a misplaced write, `/verify-feature` and CI fail on one). `/onboard` wrote the Map from docmost's own layout.

- New code goes to its kind's home. Do not add a new top-level folder or a second home for a kind without asking: the plan names it under Decisions, and the same change adds it to the Map.
- Before writing a function, component, hook, type or schema, search its home and the names it would have (`rg`). Extend what exists instead of writing a second one.
- Code moves to a shared home when a second feature needs it, not before. Move it; never copy it.
- No grab-bag files or folders (`utils`, `helpers`, `common`, `misc`). Name them after what they hold. A file the Map lists by its full path is allowed.
- `## Legacy` lists old homes. Their code stays until a task moves it; they take no new files.
- `.claude/bin/check duplicates` fails on code the branch copies, also with renamed variables. Reuse the original instead.
- Paths are relative to the root, or to a package with its own `.claude/kit.conf`. `<name>` stands for any name; a path ending in `/` covers everything below it; a pattern without `/` matches the file name anywhere. Presets add their framework's homes in their own `## Map`.
- The assistant's code goes to `apps/server/src/integrations/ai-bridge/`, `apps/client/src/features/ai-assistant/` and `ai-service/` (`project.md`).

## Map

| Kind | Home | Naming |
|------|------|--------|
| Server bootstrap | `apps/server/src/main.ts`, `apps/server/src/app.module.ts` | – |
| Server domain modules (controllers, services, DTOs) | `apps/server/src/core/<domain>/` | `<domain>.module.ts`, `.controller.ts`, `services/`, `dto/` (`core/page/`, `core/space/`) |
| Server integrations and infrastructure, including the AI bridge | `apps/server/src/integrations/<name>/` | `<name>.module.ts`, `<name>.service.ts` (`integrations/environment/`, `integrations/mail/`) |
| Server config and environment | `apps/server/src/integrations/environment/` | `environment.service.ts`, `environment.validation.ts` |
| Server data access | `apps/server/src/database/repos/<domain>/<name>.repo.ts` | the entity (`repos/page/page.repo.ts`) |
| Database migrations | `apps/server/src/database/migrations/<timestamp>-<name>.ts` | created with `migration:create` (`20260905T126412-integrations.ts`) |
| Database types | `apps/server/src/database/types/` | `<topic>.types.ts` (`entity.types.ts`) |
| Realtime collaboration (Hocuspocus, websockets) | `apps/server/src/collaboration/`, `apps/server/src/ws/` | role suffix (`collaboration.gateway.ts`) |
| Client entry points and routes | `apps/client/src/main.tsx`, `apps/client/src/App.tsx`, `apps/client/src/pages/` | page component per route (`pages/page/`, `pages/auth/`) |
| Client feature logic | `apps/client/src/features/<feature>/` | `components/`, `hooks/`, `queries/`, `services/`, `types/` (`features/page/`, `features/comment/`) |
| Shared UI components | `apps/client/src/components/` | the component (`components/ui/auto-tooltip-text.tsx`); one feature's component stays in that feature |
| Shared client hooks | `apps/client/src/hooks/` | `use-<topic>.ts` (`use-clipboard.ts`) |
| Shared client helpers | `apps/client/src/lib/<topic>.ts` | the topic (`lib/api-client.ts`, `lib/jotai-helper.ts`) |
| Client config and environment | `apps/client/src/lib/config.ts` | the one module that reads the environment |
| Client app setup | `apps/client/src/i18n.ts`, `apps/client/src/theme.ts` | – |
| Editor extensions (shared by client and server) | `packages/editor-ext/src/` | one extension per folder (`lib/attachment/`) |
| Formula engine | `packages/base-formula/src/` | one concept per file (`parser.ts`, `eval.ts`) |
| AI service (Python, planned) | `ai-service/` | not checked until it has a toolchain |
| Unit tests | `*.test.*`, `*.spec.*` | next to the source; the test name starts with the criterion ID |
| Server e2e tests | `apps/server/test/` | `<feature>.e2e-spec.ts` (`app.e2e-spec.ts`) |
| Browser flows and verify screenshots (Playwright) | `apps/client/e2e/` | `<feature>.screenshots.ts`; criterion ID first in the test name and the image (`seed-data.screenshots.ts`) |
| Scripts | `scripts/` | verb and noun (`seed-db.ts`) |
| Tool config | `*.config.*` | the tool's name (`vite.config.ts`, `eslint.config.mjs`) |

## Legacy

- `apps/server/src/common/`: grab-bag of decorators, guards, interceptors and helpers. New server code goes to the domain or integration that owns it.
- `apps/server/src/database/helpers/`, `apps/server/src/database/utils.ts`: new data helpers go next to the repo that uses them.
- `apps/client/src/components/common/`: new shared components go to their own file in the components home.
- `apps/client/src/lib/utils.tsx`: new helpers go to a topic file in the lib home.
