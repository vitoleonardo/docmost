# Code style

- The formatter and linter decide formatting. Do not change their config or add inline suppressions to silence a finding unless a comment explains why.
- Follow the naming and file conventions already in the codebase. Do not introduce a second convention.
- No new dependency without asking first. Say what it is for, why the language, the framework or an existing dependency cannot do it, and what it adds in size and maintenance. Never hand-edit a lockfile.
- Never swallow errors (an empty catch, or catch-and-print). Handle them, or rethrow with context.
- Prefer early returns over nested conditions. Keep functions small enough to read without scrolling.
- No dead code, commented-out code or unused exports. Delete them; git remembers.
- Comments explain why, not what. Do not add comments that repeat the code.
- Do not reformat or rename code outside the task. It hides the real change in the diff.
