# Git

- Never commit to `main` or `master` directly. Branch as `<issue>-<slug>` (for example `42-invite-users`), or `<slug>` when there is no issue.
- Before starting, check `git status`. If the tree has changes that are not part of the task, ask. Never pull, rebase or switch branches over uncommitted work.
- One logical change per commit. Subject in the imperative, at most 72 characters; the body explains why.
- Never commit `.env` files, secrets, `.work/`, build output or coverage reports.
- Pushing and opening a PR (gate push), commits (gate commit), new dependencies and lockfiles (gate deps), CI config (`.github/`), database migrations, Dockerfiles and infrastructure files (gate config): run `.claude/bin/gate <name>`. `ask` means ask first; `auto` means go ahead and log it under Decisions to review in `.work/<branch>.md`. The guard applies the same gates to the commands.
- Run `git add`, `git commit` and `git push` as separate commands. The guard only lets a single command through without a prompt.
- Never: force push, `git reset --hard`, `git clean -f`, rebase or amend commits that are already pushed, or delete branches.
- Subagents do not commit, push or switch branches. The main session owns git.
