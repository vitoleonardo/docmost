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
- ai-service integration, local only: `cd ai-service && uv run pytest -m "integration and not stack"`. It uses Redis db 15 and creates and drops the database `docmost_ai_role_test` and the role `docmost_ai_test`.
- Contract: `docs/contracts/ai-bridge.json`. Both sides test against it: `apps/server/src/integrations/ai-bridge/ai-bridge.contract.spec.ts` and `ai-service/tests/test_contract.py`.
- CI does not run the e2e and integration suites.

## Indexing

The worker keeps a searchable copy of all pages and PDF attachments in the schema `ai` (spec `specs/indexing.md`). Commands run from `ai-service/`.

### Variables

In addition to the ai-service variables above:
- `AI_WIKI_URL`: address of the wiki, for example `http://127.0.0.1:3000`. Required by the worker and the reconcile command; without it they exit with `AI_WIKI_URL is not set`.
- `AI_EMBEDDING_MODEL`: default `jinaai/jina-embeddings-v2-base-de`. A new model is a configuration change followed by the reconcile.

### Set up, once

1. Re-run `python -m ai_service.db_setup` (section "Database role, once") on every existing database. It now also installs pgvector in schema `ai` and sets the role's search path.
2. `uv run alembic upgrade head` creates the index tables. Safe to rerun. The worker exits with this command in its message when the tables are missing.
3. `uv run python -m ai_service.worker` starts the worker. The first start downloads the embedding model (0.64 GB, needs network) to `ai-service/.cache/fastembed`. After that it works offline.

The worker reconciles at start, logs `Reconcile finished: <n> indexed, <m> removed, <k> rescoped`, then processes the jobs the wiki forwards and reconciles again every 10 minutes. Its log holds ids and reasons, never titles, page text or tokens.

### Reconcile by hand

`uv run python -m ai_service.reconcile_command` fixes every difference between wiki and index and exits 0. It waits while the worker is reconciling. Exit 1 with `Wiki bridge unreachable at <AI_WIKI_URL>` when the wiki does not answer.

After a seed rebuild (`pnpm seed` empties schema `ai` and gives the pages new ids): run `uv run alembic upgrade head`, then the reconcile command (or restart the worker).

### Index tests

- Fast, CI: `uv run pytest -m "not integration"`.
- Integration, local: `uv run pytest -m "integration and not stack"`. Needs the dev Postgres and Redis. The tests with the real model (`-m model`) download it on first use.
- Stack, local: `uv run pytest -m stack tests/test_stack.py`. Runs against a running seeded wiki, worker and the real model; fails (does not skip) when the variables are missing:
  - `STACK_WIKI_URL`: for example `http://127.0.0.1:3100`
  - `STACK_AI_DATABASE_URL`: the AI role's URL of the database the worker indexes
  - `STACK_SERVICE_TOKEN`: the wiki's `AI_SERVICE_TOKEN`
  - `STACK_EMBEDDING_MODEL`: optional, default as the worker
  - `STACK_SEED_PASSWORD`: optional, default `seed-demo-password` (the seed's demo password)

  INDEX-AC23 creates a throwaway page as the seed owner in the space of "Bürozeiten und Erreichbarkeit", changes it through `POST /api/pages/update`, prints `INDEX-AC23 freshness: <seconds> s` (limit 60 s) and moves the page to the trash.

Stack on a separate database, so `docmost` stays untouched (fake values; ports 3100 and 8101 instead of 3000 and 8100; Redis db 5):
1. Create the database `docmost_index_stack` on the dev Postgres. Run `DATABASE_URL=<its URL> pnpm --filter ./apps/server run migration:latest`.
2. `db_setup` with `AI_DB_ADMIN_URL` and `AI_DATABASE_URL` for that database, then `uv run alembic upgrade head`.
3. Build the server (`pnpm --filter ./apps/server run build`). From a scratch directory shaped `<dir>/apps/server` (the local storage is then `<dir>/data/storage` and no environment file is read) run `node <repo>/apps/server/dist/integrations/seed/seed-main.js` with `DATABASE_URL`, `STORAGE_DRIVER=local`, `APP_SECRET`, `REDIS_URL=redis://127.0.0.1:6380/5`.
4. Start the wiki from the same directory with `node <repo>/apps/server/dist/main` and `PORT=3100`, `APP_URL`, `AI_BRIDGE_SECRET`, `AI_SERVICE_TOKEN`, `AI_SERVICE_URL=http://127.0.0.1:8101` plus the variables of step 3. Start `python -m ai_service` (`AI_SERVICE_PORT=8101`) and `python -m ai_service.worker` (`AI_WIKI_URL=http://127.0.0.1:3100`) with the same secrets, `REDIS_URL` and the AI role's `AI_DATABASE_URL`. Wait for `Reconcile finished`, then run the stack tests.
5. Stop the three processes, drop the database and the AI role, flush Redis db 5. Do not run another wiki server on the same Redis: it takes the `{ai-queue}` jobs.

## Verify data runs and screenshots

`/verify-feature` runs these through `.claude/bin/evidence data` and `.claude/bin/evidence screenshots` (commands in `.claude/kit.conf`).

- Data runs: build `packages/*`, `pnpm seed` (prints `seed: <tree hash of the seed folder>`), then the server e2e suite.
- Screenshots: `pnpm build`, `pnpm seed`, then Playwright starts `pnpm start` on `KIT_APP_URL` and runs `apps/client/e2e/*.screenshots.ts` on desktop and mobile. Images are named `<criterion>-<step>-<desktop|mobile>.png`.
- Stop `pnpm dev` and `pnpm start` first: Playwright needs the port free and the seed needs the app stopped.
- Without the evidence pack: `pnpm exec playwright test`; the images land in `test-results/`.
- The base-branch run uses a fresh worktree without `.env`, so the app does not start there and base images are missing; the evidence pack records that as a warning.
