# Hard gates

Head 29fffd0e, base m8-agent (ba18304e).

| Gate | Result | Time | Detail |
|------|--------|------|--------|
| typecheck | pass | 14s | typecheck in .: clean;typecheck in ai-service: clean;typecheck in apps/client: clean; |
| lint | pass | 14s | lint in ai-service: clean;lint in apps/client: 94 errors outside the changed files (baseline 95);lint in apps/server: 5 errors outside the changed files (baseline 5); |
| build | pass | 1s | check: 'build' is not configured in ai-service/.claude/kit.conf.;check: 'build' is not configured in apps/client/.claude/kit.conf.;check: 'build' is not configured in apps/server/.claude/kit.conf.; |
| test | pass | 48s | tests in ai-service: 983 run, 0 failing (0 legacy, not blocking), 0 flaky, 0 removed by the diff;tests in apps/client: 704 run, 0 failing (0 legacy, not blocking), 0 flaky, 0 removed by the diff;tests in apps/server: 1598 run, 14 failing (14 legacy, not blocking), 0 flaky, 0 removed by the diff; |
| coverage | pass | 111s | coverage in ai-service: n/a: coverage needs pytest-cov, which is not an approved dependency;coverage in apps/client: no changed source files, nothing to check.;coverage in apps/client: 18.38% overall (baseline 10.69%, tolerance 0.5 points); |
| duplicates | pass | 3s | check: 'duplicates' is n/a: jscpd config covers TypeScript only (ai-service/.claude/kit.conf).; |
| structure | pass | 0s | structure: 7 new source files, all in their homes. |
| focus | pass | 0s | no .only, .skip or skip markers added |
| dependencies | pass | 0s | no new dependency outside the plan's approved list (none) |
| protected | pass | 0s | no protected path changed (apps/server/src/ee apps/client/src/ee packages/ee) |
| secrets | pass | 0s | gitleaks: no leaks in the diff |
| size | fail | 0s | 3202 changed lines, more than twice the limit of 400; split the change |
