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
- Removes every row in schema `public` except the migration record, every row in schema `ai`, and the stored files of the existing workspace.
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
