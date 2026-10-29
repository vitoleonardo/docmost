# Testing

- New behaviour needs tests in the same change. A bug fix needs a regression test that reproduces the bug.
- Red before green: run each new test before the code that makes it pass, and see it fail for the expected reason. Record the failing and the passing run in `.work/<branch>.md`. A test that never failed proves nothing.
- Test names start with the acceptance criterion they prove, for example `INVITE-AC3: rejects a duplicate email`. Every criterion in the spec has at least one test, or the plan says why it is checked another way.
- Cover more than the happy path. For each criterion, test the cases the plan lists: invalid input, empty data, duplicates, missing permission, and the error path of every external call.
- Never delete, skip, focus (`.skip`, `.only`, `@pytest.mark.skip`, `@Disabled`, ...) or weaken a test to make a run pass. If a test looks wrong, say so and ask.
- Mock at the boundaries (network, clock, randomness, file system), not the module under test or its internal helpers.
- Do not use a snapshot as the only assertion for logic.
- "Tests pass" means the runner executed more than zero tests and all of them passed. Report the count. A run that collected no tests is a failure.
- While working, run `.claude/bin/check test-related <files>`. Run `.claude/bin/check --against-baseline test` before opening a PR; with a `.claude/baseline.tsv` it reports known legacy failures without blocking on them, and blocks on every new one.
- Follow the project's existing test location and naming.
