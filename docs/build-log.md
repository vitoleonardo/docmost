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
