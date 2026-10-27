---
name: onboard
description: Turn an existing repository into a kit repository in one session - scan it, record a baseline of its checks so legacy failures never block a PR, propose kit.conf, project facts, rules and protected paths, and apply them only after approval. Never changes application code.
argument-hint: [--refresh]
disable-model-invocation: true
---

# Onboard an existing repository

Arguments: $ARGUMENTS

You work in four passes. Each pass ends with a file the user approves before the next one starts. Everything you write goes to `.work/onboard/`; only `.claude/bin/onboard-apply`, which the user runs or approves, writes into the project.

## Rules

- **Never change application code.** The only files that may change are `.claude/`, `<package>/.claude/kit.conf`, `CLAUDE.md`, `specs/README.md`, `.claude/baseline.tsv`, and the CI workflow. Write the CI workflow only after asking.
- **Never run a command that writes application files.** `KIT_FORMAT` and `--fix` linters rewrite code: prove the formatter with its check mode (`biome format <file>` without `--write`, `prettier --check`, `ruff format --check`) and stage the writing form. Seed, migration and build commands that change tracked files are not run during onboarding; leave them for the user.
- **Never guess a command.** Every command in a staged `kit.conf` must have run once successfully during this session, or (for a check that fails on legacy code) must have run and produced the failures you recorded. A command you could not run stays empty, and the summary says "not configured". A check the project cannot have gets `n/a: <reason>`.
- **Stage, don't write.** Write staged files under `.work/onboard/files/`, laid out as they will land in the project. Name every `.claude` folder there `dot-claude` (`.work/onboard/files/dot-claude/kit.conf`, `.work/onboard/files/ai-service/dot-claude/kit.conf`). Claude Code protects `.claude/` from file-tool writes, and that protection is intended: it is also what keeps the baseline from getting looser behind the user's back.
- **Existing guides stay the source.** An existing `CLAUDE.md` keeps its content, and the kit's sections are added. An existing `AGENTS.md` is not copied: the staged `CLAUDE.md` gets the line `@AGENTS.md`, which Claude Code imports. Never edit `AGENTS.md`.
- **Protected paths are never read.** The guard only knows them after apply, so this is on you until then. Find candidates by folder name and licence files only (`LICENSE`, `README` at the folder's top); never open source files in a folder that looks licence-restricted, and keep it out of greps (`rg --glob '!<path>'`). Once the user names a path, do not open, grep or `git show` it, and exclude it from every git command (`-- . ':(exclude)<path>'`).

## 0. Before you start

- `.claude/bin/check`, `.claude/bin/baseline` and `.claude/bin/onboard-apply` must exist. If they do not, stop and tell the user to install the kit's project files first: `./install.sh <repo>` from the kit (add `--plugin` if the skills come from the plugin). The installer keeps every existing file.
- Run `git status`. Onboarding starts from a clean tree on the default branch's head, so the baseline describes the default branch.
- With `--refresh`: skip to pass 2, using the current `.claude/kit.conf` files and `.claude/rules/structure.md` as the staged files (copy them to `.work/onboard/files/…/dot-claude/`), add any key the kit's adapter has and they lack (such as `KIT_DUPLICATES`), and remember that `onboard-apply` will refuse a looser baseline.

## 1. Scan (read-only)

Detect, and write to `.work/onboard/scan.md` with the file each finding comes from:

- languages, package managers and lockfiles, workspace layout (pnpm workspaces, turbo, nx, a `pyproject.toml` per folder);
- scripts in `package.json` and `Makefile`; test frameworks and their configs; linters and formatters and their configs;
- where each kind of code lives now (entry points, feature logic, data access, shared UI, shared helpers, config, unit and e2e tests, scripts), with two example files each, and every kind that has more than one home;
- CI workflows; existing `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `CONTRIBUTING.md`;
- docker compose files, seed scripts, e2e setups (Playwright, Cypress), migration folders;
- candidate protected paths: licence-restricted code (for example `ee/` folders with a separate licence), vendored code, generated code. List them; the user decides.

For a large repository, explore with parallel `Explore` subagents and keep their conclusions, not file dumps.

Then decide the packages. A folder with its own toolchain (its own `pyproject.toml`, or a different language) gets its own `<package>/.claude/kit.conf`; everything else stays under the root's `.claude/kit.conf`. Start each config from the kit's matching adapter (`adapters/typescript/.claude/kit.conf`, `adapters/python/.claude/kit.conf`). They live in the kit's clone, not in the project, so ask the user for its path once. Keep the adapter's keys and conditionals, and change only what the repository does differently. Stage the adapter's other `.claude/` files too: its `bin/` helpers (the coverage readers) go to the root's `dot-claude/bin/`, and its stack rule and structure map go to `dot-claude/rules/`. The duplicates checks need jscpd 5 (a devDependency, or the binary on PATH); ask before adding it, and if the user declines, set `KIT_DUPLICATES="n/a: <reason>"`. Run each command once, from its package folder, and fix it until it works or fails only on legacy code. Stage the configs.

Show the user the scan, the packages, the commands and the protected path candidates, and ask which paths to protect. Wait.

## 2. Baseline

Run, from the project root:

```sh
KIT_CONF_ROOT=.work/onboard/files KIT_CONF_DIR=dot-claude .claude/bin/baseline record --out .work/onboard/baseline.tsv
```

It runs every configured test, lint, typecheck and coverage command in every package. For tests it records each test ID with its result (from the JUnit report in `KIT_TEST_REPORT`), for lint and typecheck the errors per file, and the overall coverage. Report its summary lines as they are: tests run and failing per package, errors per check, coverage, and every warning (a check whose output could not be read is recorded as clean, which means every error will block; say so).

Show the legacy failures. These will be reported as "legacy, not blocking" on every PR until someone fixes them. Wait.

## 3. Proposal

Write `.work/onboard/proposal.md` and stage the files it describes:

1. **`kit.conf` per package**: final commands, `KIT_SOURCE_PATTERNS`, `KIT_TEST_PATTERNS`, `KIT_DANGEROUS_PATTERNS` (migration resets, destructive seed commands the repository has), and in the root config `KIT_PROTECTED_PATHS`.
2. **Project facts** for `CLAUDE.md` (product, stack, install and dev commands, what CI runs, human-only steps), merged into the staged `CLAUDE.md` as described in the rules.
3. **Structure map**: stage `dot-claude/rules/structure.md`, starting from the adapter's (or the installed one), with its Map rewritten from the scan. Copy the repository's layout: each row gets the home the code already uses, written as a path pattern, and cites one or two files. Where a kind has several homes, the user picks the one new code goes to; the others go under `## Legacy`. Where a kind has none, keep the kit's default row.
4. **Rules** derived from the repository's own conventions: naming, error handling, import style. Each rule cites the two or three files it was derived from. Stage them as `dot-claude/rules/project.md` (or one file per area). Do not restate what the kit's rules already say.
5. **Protected paths** in the staged `dot-claude/settings.json`, merged with the kit's settings:
   - `sandbox.enabled: true` and `sandbox.filesystem.denyRead` with each path (`./apps/server/src/ee`). The sandbox is what enforces it, for every process a command starts.
   - `"gh *"` in `sandbox.excludedCommands`. On macOS, `gh` cannot verify GitHub's TLS certificate inside the sandbox (`x509: OSStatus -26276`), so `gh pr create` fails. `gh pr create` and `gh pr merge` still ask in `permissions.ask`.
   - If code outside a protected path imports from it, the typecheck and the build must read it. Then add `.claude/bin/check`, `.claude/bin/check *`, `.claude/bin/baseline` and `.claude/bin/baseline *` to `sandbox.excludedCommands`, and say in the proposal that a compiler error inside the path prints its code.
   - `Read(./<path>/**)` and `Edit(./<path>/**)` in `permissions.deny`. The sandbox merges Read denies, and Claude Code applies them to Read, Grep and Glob as well.
   - `KIT_PROTECTED_PATHS` in the root config, which the guard uses for commands that name the path and for git commands that would print it.
   Say plainly in the proposal that without the sandbox these layers are best effort.
6. **`specs/README.md`** if the repository has none.
7. **CI**: whether the existing workflow should call `.claude/bin/check --against-baseline <test|lint|typecheck|coverage>`, or the adapter's `quality-gates.yml` should be added. Do not stage CI files unless the user agreed.

Show the proposal with the diff of every staged file against its current version. Wait for approval.

## 4. Apply

After approval, ask the user to run (or approve running) `.claude/bin/onboard-apply`. Show its output. If it refuses because the new baseline is looser than the current one, show the list and stop: only the user can pass `--accept-looser`.

Then prove the configuration:

- For each package, `.claude/bin/check test-related <one source file>` and `.claude/bin/check format <one source file>` (these take files), then `.claude/bin/check typecheck` and `.claude/bin/check build` (these take none).
- The full gates: `.claude/bin/check --against-baseline test`, `lint`, `typecheck` and `coverage`, plus `.claude/bin/check duplicates` and `.claude/bin/structure`. On the unchanged default branch every one must pass; a failure here means the baseline, a command or the Map is wrong. Then run `.claude/bin/structure` with one made-up file name per home of the Map; each must pass.
- If the repository has PR history on GitHub, run `.claude/bin/leadtime --baseline` to freeze the "before" numbers (the 90 days before today) in `reports/`. With fewer than ten merged PRs it says so; a fresh fork has none, and then the comparison has to come from `--split-by kit` later.

Finish with a summary: packages and their checks (configured, `n/a`, not configured), legacy failures, protected paths and which layers protect them, the files written, and what the user still has to do (commit the files, accept the trust prompt, make CI a required check). Keep it short (`.claude/rules/output.md`). Do not commit.
