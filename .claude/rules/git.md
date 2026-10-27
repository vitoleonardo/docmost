# Git

- Never commit to `main` or `master` directly. Branch as `<issue>-<slug>` (for example `42-invite-users`), or `<slug>` when there is no issue.
- Before starting, check `git status`. If the tree has changes that are not part of the task, ask. Never pull, rebase or switch branches over uncommitted work.
- One logical change per commit. Subject in the imperative, at most 72 characters; the body explains why.
- Never commit `.env` files, secrets, `.work/`, build output or coverage reports.
- Ask before: `git push`, opening a PR, changing lockfiles, CI config (`.github/`), database migrations, Dockerfiles or infrastructure files.
- Never: force push, `git reset --hard`, `git clean -f`, rebase or amend commits that are already pushed, or delete branches.
- Subagents do not commit, push or switch branches. The main session owns git.
