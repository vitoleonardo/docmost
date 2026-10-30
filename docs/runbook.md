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
- Database tests: `pnpm --filter ./apps/server run build`, then `pnpm --filter ./apps/server run test:e2e -- seed-data`. They create and drop `docmost_seed_test` on the dev Postgres and never touch `docmost`. CI does not run them; it runs only the leak check.

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
- CI runs the leak check (step "Leak check") but not the other e2e and integration suites.

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

## Ask

The panel answers questions from the pages the user may view (spec `specs/ask.md`). The wiki checks the scope and the cited pages; ai-service searches, filters through the bridge and calls the model.

### Variables

ai-service API process, in addition to the variables above:
- `AI_WIKI_URL`: required now by the API process too (it was only the worker's). Without it the API exits with `AI_WIKI_URL is not set`.
- `AI_EMBEDDING_MODEL`: default `jinaai/jina-embeddings-v2-base-de`. The API process loads it at start and exits 1 naming the model when it cannot. The first start downloads 0.64 GB (needs network); the cache is shared with the worker.
- `AI_LLM_BASE_URL`: default `http://127.0.0.1:11434/v1` (Ollama, OpenAI-compatible).
- `AI_LLM_MODEL`: default `qwen3:8b`.
- `AI_INFERENCE_MODE`: default `local`; it only goes into the log line.
- `AI_RELEVANCE_THRESHOLD`: default `0.45`. Sections that score lower never reach the model.

The wiki server needs no new variable.

### Model

Install Ollama, run `ollama pull qwen3:8b` once and keep `ollama serve` running. The first question after a model load takes about 13 s longer. The model must answer within 60 s, otherwise the answer shows "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal."

### Check it works

1. Start Postgres, Redis, the wiki, the worker (index complete: `Reconcile finished`) and ai-service; sign in.
2. Open a page and click the sparkles icon. A1 shows "Frag das Wiki", the scope selector, two example questions and the input.
3. Click "Wann ist die Kernarbeitszeit?". The answer streams in German with numbers like `[1]`; when it ends, "Quellen" lists "Bürozeiten und Erreichbarkeit" with "Allgemein › Kernarbeitszeit". Click the entry: the page opens at that heading.
4. Ask a question during generation and click "Stoppen": the text stays, followed by "Abgebrochen", no "Quellen".
5. Ask "Wie pflege ich eine Orchidee?": A3, "Dazu habe ich in den Seiten, auf die du Zugriff hast, keine passende Quelle gefunden. …".
6. Stop ai-service and ask again: A4, input disabled. Stop Ollama only: the answer shows the model message, the panel stays usable.
7. "Neue Unterhaltung" or a reload ends the conversation.

### Conversations and log

- The conversation lives in Redis: key `ai-service:conversation:<user id>:<conversation id>`, the last 5 turns, dropped 24 h after the last question. It is keyed by user, so another user's conversation id finds nothing.
- ai-service logs one line per question: `ask conversation=<id> mode=<mode> model=<model> candidates=<n> passing=<m> first_text_ms=<ms|none> outcome=<answered|no_source|stopped|model_failed|filter_failed>`. It never holds the question, the answer, page text or tokens.

### Ask tests

- Fast, CI: `uv run pytest -m "not integration"` (includes the seed-matrix prompt check with a fake bridge).
- Stack, local: `uv run pytest -m stack tests/test_stack_ask.py` from `ai-service/`, on the stack of "Index tests" with ai-service running (and the wiki's `AI_SERVICE_URL` pointing at it) and Ollama serving `qwen3:8b`. It fails (does not skip) when a variable is missing. Variables of the index stack tests plus:
  - `STACK_BRIDGE_SECRET`: the stack's `AI_BRIDGE_SECRET`; signs the user tokens for the in-process checks.

  Covers ASK-AC32 to ASK-AC35 (prompt content with the real bridge, index and embedder and a recording model), ASK-AC39 to ASK-AC41 and ASK-AC57 (through `POST /api/ai/ask` of the wiki, real model). It logs in as the four seed users once (the login throttle may add 61 s), creates two throwaway pages in "Allgemein" (one moved to "Geschäftsführung", one trashed, both put back into the index as stale entries) and removes them again. It prints `ASK-AC57 first text: <seconds> s` (limit 10 s). Run it on a freshly seeded stack: Ollama caches prompts, so a repeated run measures less than a first run.
- Screenshots of A1 to A4 and the source click: `apps/client/e2e/ask.screenshots.ts`, run as in "Verify data runs and screenshots". It mocks `POST /api/ai/ask` and `POST /api/ai/status` (answers must be the same on every run), switches the seed user WS to German for each test and back afterwards. The source click uses the real heading id of "Bürozeiten und Erreichbarkeit". ai-service must run so the real status is `available` (A4 mocks the status); the model need not run.

## Extraction

Spec `specs/extraction.md`. The button "Daten extrahieren" on a PDF attachment sends the file to ai-service through the wiki (`POST /api/ai/extract`); the model fills the schema "Vertrag" and the dialog shows each value with its quote and page. Nothing is stored in ai-service.

### Ollama context (human step)

Set `OLLAMA_CONTEXT_LENGTH=16384` for Ollama and restart it. Ollama's default context is 4,096 tokens and cuts a long prompt without an error: the model then answers from the first pages only. ai-service detects this (fewer prompt tokens than a quarter of the characters sent), shows "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal." and logs `outcome=context_too_small`. On macOS with the app: `launchctl setenv OLLAMA_CONTEXT_LENGTH 16384`, then quit and reopen Ollama. Seed contracts of 2 pages work at 4,096; a PDF of 10 pages needs 16,384.

### Extraction tests

- Fast, CI: `uv run pytest -m "not integration"` from `ai-service/` (stub model, `tests/test_extraction.py`, `tests/test_app_extract.py`).
- Local model: `scripts/run-extraction-check.sh [pytest args]` from the repo root. It runs `ai-service/tests/test_stack_extract.py` (EXTRACT-AC52, AC55, AC56, AC57, AC68) against a throwaway stack: database `docmost_extract_check` and role `docmost_ai_extract` (recreated, dropped on exit), Redis db 11 (flushed at start and end), wiki on port 3101, ai-service on port 8102, seed storage in a temporary folder. Secrets are generated per run. The dev database `docmost` and the dev services stay untouched. Needs `psql` on PATH, `uv sync` in `ai-service/`, a built `apps/server/dist` and Ollama with the model.
- The script drops and recreates any database named `docmost_extract…` that it is given, so never point `EXTRACT_DATABASE` at data you want to keep.
- Two runs at once must use different `EXTRACT_DATABASE` and `EXTRACT_REDIS_URL` values (and ports), or they wipe each other.
- Variables: `EXTRACT_LLM_BASE_URL` (default `http://127.0.0.1:11434/v1`), `EXTRACT_LLM_MODEL` (default `qwen3:8b`), `EXTRACT_DATABASE` (must start with `docmost_extract`), `EXTRACT_PG_ADMIN_URL`, `EXTRACT_REDIS_URL` (a database number from 1 to 15), `EXTRACT_WIKI_PORT`, `EXTRACT_AI_PORT`, `EXTRACT_HEALTH_TIMEOUT`.
- Against the stack, a test reads `STACK_WIKI_URL`, `STACK_AI_DATABASE_URL`, `STACK_SERVICE_TOKEN`, `STACK_REDIS_URL` and, for the model, `STACK_LLM_BASE_URL` and `STACK_LLM_MODEL` (the script sets them). The tests extract all 6 seed contracts through `POST /api/ai/extract` as the seed owner after one warm-up call and print `EXTRACT-AC57 <file>: <seconds> s` (limit 40 s). EXTRACT-AC68 (10 pages of 5 seed contracts, limit 180 s) calls the pipeline directly and needs a context of 16,384 tokens: at 4,096 it fails with `outcome=context_too_small`.
- Second Ollama for a run without changing the app's setting: `OLLAMA_HOST=127.0.0.1:11435 OLLAMA_CONTEXT_LENGTH=16384 ollama serve`, then `EXTRACT_LLM_BASE_URL=http://127.0.0.1:11435/v1 scripts/run-extraction-check.sh`; stop it afterwards.

Measured on the M3 Pro with `qwen3:8b`, context 16,384, model loaded, 29.10.2026 (wall clock per request through the wiki):

| Contract | Seconds |
|---|---|
| beratervertrag-unternehmensentwicklung | 18.0 |
| kundenvertrag-stadtwerke-beispielstadt | 20.0 |
| liefervertrag-pumpen-fiktivwerk | 27.7 |
| rahmenvertrag-wasserverband-muster | 22.5 |
| softwarelizenzvertrag-planungssoftware | 20.7 |
| subunternehmervertrag-tiefbau | 22.8 |

10 pages of 5 contracts: 19.4 s with the model loaded (47.0 s on the first call after Ollama started). With the default 4,096 context the same PDF fails after 23.4 s with `context_too_small`.

## Agent (M8)

Spec `specs/agent.md`. The tab "Aufgabe" in the assistant panel lets the model search and read pages of one space and propose changes; a change is written only when the user clicks "Übernehmen" (`POST /api/ai/agent/proposal/apply`, with the user's session). ai-service has no endpoint that changes a page.

### Limits

- 20 tool calls per run, 10 minutes per run, 200,000 tokens per run (prompt and completion summed).
- 120 s per model call, then the run ends with "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal."
- 6,000 characters of block text per page read; later blocks are left out and the model is told.
- One running run per user. A second start shows "Es läuft bereits eine Aufgabe. Warte, bis sie fertig ist, oder brich sie ab."
- Runs and proposals are deleted 30 days after the run started, by the retention of the worker (`ai-service/src/ai_service/worker.py`). Start the worker as for indexing.
- A run ends when its stream ends: "Abbrechen" and a reload stop it, closing the panel does not.

### Collaboration Redis

Reading a page for the agent and applying a proposal go through the collaboration server, so they see edits that are not saved yet. `COLLAB_DISABLE_REDIS` must not be `true`. With it set, reads come from the database without unsaved edits and every apply fails with `write_failed` ("Die Änderung konnte nicht übernommen werden. Versuche es noch einmal."). `docker-compose.dev.yml` runs Redis on port 6380.

### Agent tests

- Server e2e, local only: `pnpm --filter ./apps/server run test:e2e -- ai-agent` (`apps/server/test/ai-agent.e2e-spec.ts`, own database `docmost_ai_agent_test`, Redis db 12, an in-process stub for ai-service). Stop `pnpm dev` first, as for the other e2e suites.
- ai-service, CI: `cd ai-service && uv run pytest -m "not integration"` (`tests/test_agent.py`, `test_agent_store.py`, `test_app_agent.py`, `test_proposals.py`; scripted model).
- Client: `pnpm --filter ./apps/client exec vitest run src/features/ai-assistant`.
- Screenshots of the tabs and G1 to G6: `apps/client/e2e/agent.screenshots.ts`, run as in "Verify data runs and screenshots". It mocks `POST /api/ai/status`, `POST /api/ai/agent/run` (a stream of events) and the proposal routes, and switches the seed users GF and WS to German for each test and back afterwards. The G2 test keeps the stream open. ai-service need not run.

## Leak tests

Spec `specs/leak-tests.md`. The prompt-content check proves that the prompt sent to the model never holds a section the asking user may not view: every seed user, every leak question, every scope, with the real wiki filter, a recording model and an index built from the seed. It also covers revoked membership, a stale index entry and a restored page.

### Leak check

- Run from the repo root: `scripts/run-leak-check.sh [pytest args]`, for example `scripts/run-leak-check.sh -q`.
- Needs the dev Postgres and Redis of `docker-compose.dev.yml` (ports 5433 and 6380), `psql` on PATH, `uv sync` done in `ai-service/`. It builds the server when `apps/server/dist/main.js` is missing; run `pnpm --filter ./apps/server run build` after server changes.
- It uses its own database `docmost_leak` and the role `docmost_ai_leak`, recreated on every run. It never touches the dev database `docmost`. It seeds the database, starts the wiki on port 3100, runs `uv run pytest -m leak` and stops the wiki on exit. A run that collects no tests fails.
- `LEAK_EMBEDDING_MODEL=jinaai/jina-embeddings-v2-base-de`: index with the real model instead of the hashing embedder (LEAK-AC10).
- `LEAK_WORKER_RUNNING=1`: set it when a worker indexes the same database, so the tests wait for the worker's update.
- Secrets (app secret, service token, bridge secret, AI role password) are generated per run with `openssl rand -hex 32`; set `LEAK_APP_SECRET`, `LEAK_SERVICE_TOKEN`, `LEAK_BRIDGE_SECRET` or `LEAK_AI_PASSWORD` to pin them. `LEAK_SEED_PASSWORD` is passed on only when set; otherwise the tests use the seed's demo password.
- Other variables: `LEAK_DATABASE` (must start with `docmost_leak`), `LEAK_PG_ADMIN_URL`, `LEAK_REDIS_URL`, `LEAK_WIKI_PORT`, `LEAK_HEALTH_TIMEOUT`.
- CI runs it in the job "Quality gates" on every pull request, on its own Postgres and Redis services. Any failure blocks the merge.

### Canary suite

Local, not in CI. Run it before every merge to `main` that touches retrieval, prompts or the AI bridge (manual rule). It asks the real model through `POST /api/ai/ask` and needs the full local stack of "Ask tests" (wiki, ai-service, Ollama).

- Command, from the repo root: `cd ai-service && uv run python -m ai_service.leak_suite`
- Prerequisites: the local stack of "Ask tests" runs with the active mode: wiki, ai-service, worker and the model (Ollama), and the seed data is indexed (every seed page has index entries; check with a control question in the wiki). The suite logs in as the four seed users (the login throttle may add 61 s), creates two pages "Leak-Test Injektion ..." in Allgemein and removes them again, also after a failure or Ctrl+C. It removes leftovers of an interrupted run at the start.
- Variables:
  - `LEAK_WIKI_URL` (required): address of the wiki, for example `http://localhost:3000`.
  - `LEAK_SEED_PASSWORD`: the seed users' demo password (default `seed-demo-password`).
  - `LEAK_INFERENCE_MODE`, `LEAK_MODEL`, `LEAK_EMBEDDING_MODEL`: only printed in the report; default to the AI service's defaults (`local`, `qwen3:8b`, `jinaai/jina-embeddings-v2-base-de`). Set them when the stack runs with other values.
  - `LEAK_REPORT_PATH` (default `reports/leak-tests.md`), `LEAK_CONTENT_DIR` (default the seed content folder), `LEAK_INJECTION_TIMEOUT_SECONDS` (180) and `LEAK_POLL_SECONDS` (5): how long the suite waits for the worker to index the injection pages.
- Exit codes: 0 clean; 1 a leak, a `failed` answer or a failed control question; 2 start-up problem (list problem, wiki not reachable, login failed), the report is left as it was.
- Output: the report `reports/leak-tests.md` and a last line `Leak suite: <n> questions, <k> leaks`. Exit 0 only with 0 leaks.

## Verify data runs and screenshots

`/verify-feature` runs these through `.claude/bin/evidence data` and `.claude/bin/evidence screenshots` (commands in `.claude/kit.conf`).

- Data runs: build `packages/*`, `pnpm seed` (prints `seed: <tree hash of the seed folder>`), then the server e2e suite.
- Screenshots: `pnpm build`, `pnpm seed`, then Playwright starts `pnpm start` on `KIT_APP_URL` and runs `apps/client/e2e/*.screenshots.ts` on desktop and mobile. Images are named `<criterion>-<step>-<desktop|mobile>.png`.
- Stop `pnpm dev` and `pnpm start` first: Playwright needs the port free and the seed needs the app stopped.
- Without the evidence pack: `pnpm exec playwright test`; the images land in `test-results/`.
- The base-branch run uses a fresh worktree without `.env`, so the app does not start there and base images are missing; the evidence pack records that as a warning.
