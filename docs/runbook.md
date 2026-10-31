# Runbook

Local operation of the fork. Commands run from the repository root.

## Start the stack

1. `docker compose -f docker-compose.dev.yml up -d` starts Postgres (`127.0.0.1:5433`) and Redis (`127.0.0.1:6380`).
2. `pnpm install --frozen-lockfile`, then `pnpm build` (the workspace packages must be built).
3. `pnpm --filter ./apps/server run migration:latest`.
4. `pnpm dev` or `pnpm start`.

## Reset seed data

`pnpm seed` deletes all wiki data and rebuilds the fictional company Ostmooimooi Anlagenbau GmbH from `apps/server/src/integrations/seed/`.

Before running it:
- Stop the app server and the collaboration server (`pnpm dev` / `pnpm start`). The rebuild does not guard against a running server; an open editor could write old content back.
- Apply the migrations (step 3 above). The rebuild refuses otherwise.

What it does:
- Removes every row in the schemas `public` and `ai` except the migration records (`kysely_migration`, `kysely_migration_lock`, `alembic_version`), and the stored files of the existing workspace.
- Seeds 1 workspace, 4 users, 2 groups, 6 spaces, 30 pages and 9 PDF attachments.
- Ends with `Seeded: 1 workspace, 4 users, 2 groups, 6 spaces, 30 pages, 9 attachments`.

It refuses, without changing anything, when:
- the database host is not `localhost`, `127.0.0.1` or `::1`: `Refusing to reset non-local database <host>`;
- `STORAGE_DRIVER` is not `local`: `Refusing to reset non-local storage`;
- migrations are pending: `Apply the migrations first`;
- another rebuild holds the lock: `Another rebuild is running`.

`pnpm seed --confirm-non-local` overrides the database check only; non-local storage is always refused, because the S3 and Azure drivers cannot delete a folder. Never use it against a database that holds real data.

### Seed logins

All users share the demo password `seed-demo-password`. It is fake on purpose; the data is fictional and runs locally only.

| User | Role | Email |
|---|---|---|
| Jörg Ostmoor | Geschäftsführer, workspace owner | `joerg.ostmoor@ostmooimooi.example.com` |
| Sabine Kettler | Projektleiterin | `sabine.kettler@ostmooimooi.example.com` |
| Tobias Renner | Vertriebler | `tobias.renner@ostmooimooi.example.com` |
| Lukas Brehm | Werkstudent | `lukas.brehm@ostmooimooi.example.com` |

Who sees what: the space and page matrices in `specs/seed-data.md`.

### Change the seed content

- Pages: `apps/server/src/integrations/seed/content/pages/` and the manifest `seed-pages.ts`.
- Contracts and minutes: `content/contracts.ts`. After a change, run `pnpm --filter ./apps/server run seed:generate` and commit `content/generated/`. A unit test fails when the committed PDFs, ground truth or canary list differ from a fresh generation.

### Tests

- Data, PDF and preflight tests: `.claude/bin/check test-related apps/server/src/integrations/seed/<file>`.
- Database tests: `pnpm --filter ./apps/server run build`, then `pnpm --filter ./apps/server run test:e2e -- seed-data`. They create and drop `docmost_seed_test` on the dev Postgres and never touch `docmost`. CI does not run them yet.

## AI bridge and ai-service

The assistant has two parts: the wiki server and `ai-service/` (Python, `127.0.0.1:8100`). The wiki works without ai-service.

### Wiki server variables

Set in the server's environment or `.env`:
- `AI_BRIDGE_SECRET`: at least 32 characters, same value as ai-service.
- `AI_SERVICE_TOKEN`: at least 32 characters, same value as ai-service.
- `AI_SERVICE_URL`: `http://127.0.0.1:8100`.

All three set: the assistant is on. Any missing: it is off.

### ai-service variables

Read from `ai-service/.env` or the environment.
- `AI_BRIDGE_SECRET`, `AI_SERVICE_TOKEN`: same values as the wiki server.
- `REDIS_URL`: `redis://127.0.0.1:6380` (dev Redis).
- `AI_DATABASE_URL`: `postgresql://docmost_ai:<password>@127.0.0.1:5433/docmost`. The role is `docmost_ai`, never the wiki's role.
- `AI_SERVICE_HOST`: default `127.0.0.1`. `AI_SERVICE_PORT`: default `8100`.

### Database role, once

Run from `ai-service/`. Replace the placeholders with the dev database's admin password and the `docmost_ai` password:

```
AI_DB_ADMIN_URL=postgresql://docmost:<admin-password>@127.0.0.1:5433/docmost AI_DATABASE_URL=postgresql://docmost_ai:<password>@127.0.0.1:5433/docmost uv run python -m ai_service.db_setup
```

- Creates or updates the role `docmost_ai` and the schema `ai` it owns.
- Prints `Role docmost_ai ready in database docmost: owns schema ai, no access to tables in schema public`.
- Safe to rerun.
- Exits 1 when the role can read wiki tables or create outside `ai`. A role with extra attributes such as SUPERUSER also fails here.
- The passwords end up in the shell history.

ai-service checks the role at every start. Run it with a role that can read wiki tables and it refuses to start with `Database role must not read wiki tables`.

### Start ai-service

```
cd ai-service && uv sync && uv run python -m ai_service
```

Restart the wiki server after changing its variables.

### Check it works

1. Start the wiki (`pnpm dev`) and sign in.
2. Open a page. The sparkles icon in the page header appears only when the assistant is on.
3. Click it. With ai-service running, the panel shows "Frag das Wiki" (status `available`).
4. Stop ai-service. Reopen the panel: it shows "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter." and the button "Erneut versuchen" (status `unavailable`).
5. With ai-service still stopped, edit and save a page. The wiki works normally.
6. Start ai-service, click "Erneut versuchen". The panel shows "Frag das Wiki" again.

To switch the assistant off, unset `AI_BRIDGE_SECRET` and restart the wiki server. No icon shows.

### Tests

- Server unit, CI: `cd apps/server && node_modules/.bin/jest src/integrations/ai-bridge`
- Server e2e, local only: `pnpm --filter ./apps/server run test:e2e -- ai-bridge`. It needs the dev Postgres and Redis. Do not run a dev server on the same Redis at the same time: it takes `{ai-queue}` jobs.
- ai-service fast tests, CI: `cd ai-service && uv run pytest -m "not integration"`
- ai-service integration, local only: `cd ai-service && uv run pytest -m integration`. It uses Redis db 15 and creates and drops the database `docmost_ai_role_test` and the role `docmost_ai_test`.
- Contract: `docs/contracts/ai-bridge.json`. Both sides test against it: `apps/server/src/integrations/ai-bridge/ai-bridge.contract.spec.ts` and `ai-service/tests/test_contract.py`.
- CI does not run the e2e and integration suites.

## Verify data runs and screenshots

`/verify-feature` runs these through `.claude/bin/evidence data` and `.claude/bin/evidence screenshots` (commands in `.claude/kit.conf`).

- Data runs: build `packages/*`, `pnpm seed` (prints `seed: <tree hash of the seed folder>`), then the server e2e suite.
- Screenshots: `pnpm build`, `pnpm seed`, then Playwright starts `pnpm start` on `KIT_APP_URL` and runs `apps/client/e2e/*.screenshots.ts` on desktop and mobile. Images are named `<criterion>-<step>-<desktop|mobile>.png`.
- Stop `pnpm dev` and `pnpm start` first: Playwright needs the port free and the seed needs the app stopped.
- Without the evidence pack: `pnpm exec playwright test`; the images land in `test-results/`.
- The base-branch run uses a fresh worktree without `.env`, so the app does not start there and base images are missing; the evidence pack records that as a warning.
