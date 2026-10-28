# Review (m3-ai-bridge, base m2-seed-data)

Reviewer: `reviewer` agent on opus, 2 rounds. No high findings in either round.

## Round 1
- 0 high, 5 medium, 6 low. Permission path judged sound (trash, deleted spaces, group membership, inherited restrictions, disabled users, identical 404 bodies, token audience/algorithm/type, separate bridge secret).
- Medium, fixed: search limit applied before restriction filtering could hide a viewable hit (AC26); AC25 space check could not fail; AC14/AC16 not proven through a token; client test mocked the feature service and did not check the aside title or trigger placement.
- Medium, kept and logged: `KIT_IMPROVE="1"` (commit from the milestone orchestrator, matches ai-v1).
- Low, fixed: ai-service parsed the body before the service-token check; missing stored file answered 500; AC31 had no red run.
- Low, logged: userId checked only in the body; one space lookup per readable space; test-stub.ts in src.

## Round 2 (on the fix commit)
- 0 high, 3 medium, 4 low.
- Fixed: forged-spaceIds test used a restricted page (now an unrestricted Geschäftsführung page, red under mutation); offset windows could repeat tied rows (now deduplicated); exists() failure lost the first cause; two misnamed tests.
- Logged: search tool scans at most 500 ranked rows (5 × 100).
- Checks run by the reviewer: typecheck, lint, tests against the baseline (1681 run, 14 legacy failures), duplicates, structure: pass. The local-only e2e and Python integration suites were not run by the reviewer.
