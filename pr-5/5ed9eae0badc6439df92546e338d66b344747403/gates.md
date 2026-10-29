# Hard gates

Head 5ed9eae0, base m4-indexing (b88b8dd4).

| Gate | Result | Time | Detail |
|------|--------|------|--------|
| typecheck | pass | 13s | typecheck in .: clean;typecheck in ai-service: clean;typecheck in apps/client: clean; |
| lint | pass | 13s | lint in ai-service: clean;lint in apps/client: 94 errors outside the changed files (baseline 94);lint in apps/server: 5 errors outside the changed files (baseline 5); |
| build | pass | 1s | check: 'build' is not configured in ai-service/.claude/kit.conf.;check: 'build' is not configured in apps/client/.claude/kit.conf.;check: 'build' is not configured in apps/server/.claude/kit.conf.; |
| test | pass | 29s | tests in ai-service: 365 run, 0 failing (0 legacy, not blocking), 0 flaky, 0 removed by the diff;tests in apps/client: 531 run, 0 failing (0 legacy, not blocking), 0 flaky, 0 removed by the diff;tests in apps/server: 1293 run, 14 failing (14 legacy, not blocking), 0 flaky, 0 removed by the diff; |
| coverage | pass | 87s | coverage in ai-service: n/a: coverage needs pytest-cov, which is not an approved dependency;coverage in apps/client: 43.8% of the lines in the changed files are covered; at least 70% is required.;coverage in apps/client: 15.16% overall (baseline 10.69%, tolerance 0.5 points); |
| duplicates | pass | 2s | check: 'duplicates' is n/a: jscpd config covers TypeScript only (ai-service/.claude/kit.conf).; |
| structure | pass | 0s | structure: 29 new source files, all in their homes. |
| focus | pass | 0s | no .only, .skip or skip markers added |
| dependencies | pass | 0s | no new dependency outside the plan's approved list (marked) |
| protected | pass | 0s | no protected path changed (apps/server/src/ee apps/client/src/ee packages/ee) |
| secrets | pass | 0s | pattern scan, gitleaks not installed: nothing found |
| size | fail | 0s | 9870 changed lines, more than twice the limit of 400; split the change |
