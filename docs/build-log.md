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
