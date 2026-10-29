# Review round 7 (targeted: 659ca785, 2b1916df; rounds 1–6 covered the rest of the branch against m6-leak-tests)

Verdict: Ready. 0 high, 0 medium, 4 low.

| Criterion | Verdict | Evidence |
|---|---|---|
| EXTRACT-AC69 | pass | Playwright `EXTRACT-AC69: every Wert input stays readable beside long quotes` (mobile = Pixel 7, 412 px): all five inputs ≥ 140 px and inside the dialog; unit `EXTRACT-AC69: every Wert input keeps a minimum width of 140 px` |
| EXTRACT-AC9 to EXTRACT-AC20 (desktop) | pass | Wert column is 45 % of an 80 % modal (~440 px at 1280 px); `miw={140}` does not change desktop; AC9/AC14 assertions untouched |

Findings:
1. low, fixed in fc7fc544: the unit test name claimed long quotes it does not have.
2. low, accepted: the jsdom test reads Mantine's rem output (assumes scale 1); the Playwright test is the real proof.
3. low, accepted: screenshot.ts grows the viewport to scrollHeight + 200; a dialog taller than about 1,800 px would still be clipped (current dialogs about 1,400 px).
4. low, accepted: `phoneDialog` keys on the project name "mobile" from playwright.config.ts.

Checks: typecheck and lint pass against the baseline (no findings in changed files); test-related 122 passed; spec-lint and structure pass. The reviewer could not run Playwright; the main session ran it (14 passed at 2b1916df after pnpm seed).
