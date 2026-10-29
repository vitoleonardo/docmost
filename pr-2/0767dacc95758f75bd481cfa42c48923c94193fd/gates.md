# Hard gates

Head 0767dacc, base ai-v1 (48065c4f).

| Gate | Result | Time | Detail |
|------|--------|------|--------|
| typecheck | pass | 16s | typecheck in .: clean;typecheck in apps/client: clean;typecheck in apps/server: 1 errors outside the changed files (baseline 1); |
| lint | pass | 18s | lint in apps/client: 95 errors outside the changed files (baseline 95);lint in apps/server: 5 errors outside the changed files (baseline 5); |
| build | pass | 1s | check: 'build' is not configured in apps/client/.claude/kit.conf.;check: 'build' is not configured in apps/server/.claude/kit.conf.; |
| test | pass | 31s | tests in apps/client: 432 run, 0 failing (0 legacy, not blocking), 0 flaky, 0 removed by the diff;tests in apps/server: 992 run, 15 failing (15 legacy, not blocking), 0 flaky, 0 removed by the diff;  legacy, not blocking: AuthController should be defined::AuthController should be defined; |
| coverage | pass | 85s | coverage in apps/client: 0% of the lines in the changed files are covered; at least 70% is required.;coverage in apps/client: 10.69% overall (baseline 10.69%, tolerance 0.5 points);coverage in apps/server: 28.32% overall (baseline 25.27%, tolerance 1 points); |
| duplicates | pass | 2s |  |
| structure | pass | 1s | structure: 21 new source files, all in their homes. |
| focus | pass | 0s | no .only, .skip or skip markers added |
| dependencies | pass | 0s | no new dependency outside the plan's approved list (pdf-lib  pdf-parse  @playwright/test) |
| protected | pass | 0s | no protected path changed (apps/server/src/ee apps/client/src/ee packages/ee) |
| secrets | pass | 0s | pattern scan, gitleaks not installed: nothing found (fake values assigned in test files or listed in .claude/secrets-allow.tsv are not flagged; key formats are) |
| size | fail | 0s | 5871 changed lines, more than twice the limit of 400; split the change |
