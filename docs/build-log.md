# Build log

Notable moments where the workflow caught or prevented problems.

## 2026-10-23: ee lock is weaker than it looks
- **The rule**: `Read`/`Edit` deny rules for the three ee paths are in `.claude/settings.json`.
- **Test**: the Read tool was denied as expected. `head packages/ee/LICENSE` through Bash went through.
- **Likely cause**: the RTK hook rewrites shell commands, so Claude Code no longer recognizes the file argument. Per Claude Code docs, deny rules also do not cover `grep -r` from a parent directory or scripts.
- **Mitigation in practice**:
  - `apps/server/src/ee` is a git submodule and is not checked out.
  - All agent prompts and searches use `--exclude-dir=ee`.
  - An OS-level sandbox (`sandbox.filesystem.denyRead`) or a sparse checkout would make the lock hard.

## 2026-10-23: Phase 0 found a leak path in the spec
- **The gap**: spec 7.1 filters by space ids and re-checks only *cited* pages. Core has page-level restrictions inside spaces, so restricted chunks could reach the LLM before the re-check.
- **Fix in design**: filter retrieved candidates through `filterAccessiblePageIds` before generation.

## 2026-10-27: Pre-kit spec review found a second leak path
- **The gap**: spec 7.3 sent candidates through `filterAccessiblePageIds`. It checks page restrictions only and returns every id unchanged for a space without restrictions, so the space check came from the token and the index. A lost `PAGE_MOVED_TO_SPACE` job (`attempts: 1`) would leave a page under its old open space and pass it into the prompt. The final check had a similar hole: `validateCanView` does not check `deleted_at`.
- **Fix in design (spec v1.2)**: ai-bridge's filter decides from Docmost's current data only (current space, `deleted_at`, membership, restrictions); stale-index leak cases added to M3 and M6.
- **Why the kit would not have caught it**: spec-lint checks how criteria are written, not whether the assumptions about the codebase are true. Reading the code did.

## 2026-10-27: M1 setup on the MacBook
- **Fork runs locally**: dev compose (Postgres 5433, Redis 6380), `.env` from `.env.example`, install, build, migrations, `pnpm start`; `/api/health` returns 200. `.env.example` still has upstream's ports and credentials, so `DATABASE_URL` and `REDIS_URL` must be changed by hand.
- **pnpm**: a standalone pnpm in `~/Library/pnpm` sits before corepack's shim and fails to switch to the pinned 11.25.0 (`ENOENT` under `.tools`). `corepack pnpm …` works.
- **Ollama**: native app updated from 0.12.6 to 0.40.11 via the `ollama-app` cask. Docker Desktop's VM has 4 GB, leaving about 14 GB for the model and macOS.
- **Kit install**: `install.sh` without an adapter copied 40 files and kept the fork's deny-only `.claude/settings.json`; `/onboard` merges it with the kit's settings and the sandbox.

## 28.10.2026: Kit update to 795eb90 and `/onboard --refresh`
- **Stale stage**: `.work/onboard/files/` still held the first onboard's `CLAUDE.md`, `settings.json` and `quality-gates.yml`. `onboard-apply` copies everything staged, so it would have reverted the kit update. Moved aside before restaging.
- **Sandbox reset**: the kit update replaced `settings.json` with the kit's default, `sandbox.enabled: false`. Kept off by decision (spec v1.3).
- **Default Map**: the kit's structure Map (`src/features/`, `src/data/`) matched none of docmost's homes, so `.claude/bin/structure` would have blocked new files in `integrations/ai-bridge`. Rewritten from the layout; `common/`, `helpers/` and `utils` are legacy.
- **Duplicates gate**: needs jscpd 5, added as a root devDependency. 521 existing clones count as legacy.
- **Gates on the unchanged branch**: typecheck, lint (client 95, server 5 legacy errors), tests (client 432/0, server 905/15 legacy), coverage, duplicates and structure all pass.
- **ee lock without the sandbox**: the guard blocks `head -c 0 packages/ee/LICENSE` and the Read tool is denied, but `f=packages/ee; head -c 0 $f/LICENSE` passed the guard (only `head` rejected the byte count). The lock is best effort; the CI import check (spec 13, item 4) is still missing.
