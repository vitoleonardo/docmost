# Docmost conventions

Derived from the existing code. The kit's rules still apply; these say how they look here.

## Where AI work goes

- Server code for the assistant lives in one NestJS module, `apps/server/src/integrations/ai-bridge`. Client code lives in `apps/client/src/features/ai-assistant`. Other Docmost files change only for the wiring listed in `docs/phase0-report.md` section 7. All model and retrieval logic belongs in `ai-service/`. (`docs/spec.md` section 3)
- Never read, import or reimplement anything from `apps/server/src/ee`, `apps/client/src/ee` or `packages/ee`. Imports of `@docmost/ee/*` are not allowed in new code.

## Server (`apps/server/src`)

- A domain is a folder with `<domain>.module.ts`, `<domain>.controller.ts`, `services/`, `dto/`. Files are kebab-case with a role suffix: `.controller.ts`, `.service.ts`, `.dto.ts`, `.repo.ts`, `.module.ts`. (`core/page/`, `core/space/`, `core/comment/`)
- Endpoints are `@Post` with `@HttpCode(HttpStatus.OK)` and a DTO body, behind `@UseGuards(JwtAuthGuard)`; the user comes from `@AuthUser()`. 126 of 135 routes follow this. (`core/page/page.controller.ts`, `core/space/space.controller.ts`)
- Request bodies are validated by class-validator DTOs, not Zod. This replaces the schema line in `typescript.md` for the server. (`core/page/dto/create-page.dto.ts`)
- Authorization: page access through `PageAccessService` (`validateCanView`, `validateCanViewWithPermissions`), space access through `SpaceAbilityFactory` (CASL). Check both before returning or changing page data. (`core/page/page.controller.ts`, `core/page/page-access/`)
- Database access only through repos in `database/repos/<domain>/<name>.repo.ts`, using Kysely via `@InjectKysely()`. Import them as `@docmost/db/...`. (`database/repos/page/page.repo.ts`)
- Configuration is read through `EnvironmentService` and validated in `environment.validation.ts`, never from `process.env`. (`integrations/environment/`)
- Migrations: create them with `pnpm --filter ./apps/server run migration:create <name>`; files are `database/migrations/<timestamp>-<name>.ts`. Never edit a migration that is on `main`.
- Missing records throw `NotFoundException`, denied access throws `ForbiddenException`. (`core/page/page.controller.ts`)
- Tests are `<file>.spec.ts` next to the source, Jest with `@nestjs/testing`. (`core/page/services/page.service.spec.ts`)

## Client (`apps/client/src`)

- A feature is a folder in `features/<feature>/` with `components/`, `hooks/`, `queries/`, `services/`, `types/`. (`features/page/`, `features/comment/`)
- `services/<name>-service.ts` holds plain async functions that call the API through `@/lib/api-client`. `queries/<name>-query.ts` wraps them in TanStack Query hooks. Components use the hooks, never `api` directly. (`features/page/services/page-service.ts`, `features/page/queries/page-query.ts`)
- Types live in `types/<name>.types.ts`; interfaces carry an `I` prefix (`IPage`). Import with the `@/` alias.
- UI is Mantine. User-facing text goes through `useTranslation()` from react-i18next; feedback uses `notifications.show` from `@mantine/notifications`. Shared client state uses Jotai atoms. (`features/page/components/`, `lib/jotai-helper.ts`)
- Tests are `<file>.test.ts(x)` next to the source, Vitest with jsdom. (`features/page/tree/hooks/drop-op-to-move-payload.test.ts`)
