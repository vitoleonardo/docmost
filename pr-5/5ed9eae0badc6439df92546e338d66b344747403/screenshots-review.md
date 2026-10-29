# Screenshot review (m5-ask, verify round 4, head 5ed9eae0)

Reviewer: independent `reviewer` agent (opus). 20 images, no .main images (base run failed: its worktree has no environment file; the Ask panel does not exist on m4-indexing).

Verdict: no high or medium findings.

| Image | Criterion | Verdict |
|---|---|---|
| ASK-AC1-a1 (desktop, mobile) | ASK-AC1 | matches |
| ASK-AC77-a2-streaming (desktop, mobile) | ASK-AC77 | cannot judge from pixels (accessible name); shows partial answer, icon-only stop button, no "Quellen"; the test asserts the name |
| ASK-AC15-a2-sources (desktop, mobile) | ASK-AC15 | matches: [1] then [2], two entries numbered 1 and 2 |
| ASK-AC36-a3 (desktop, mobile) | ASK-AC36 | matches |
| ASK-AC7-a4 (desktop, mobile) | ASK-AC7 | matches |
| ASK-AC21-heading-in-view (desktop, mobile) | ASK-AC21 | matches |
| SEED-AC3-* (8 images) | SEED-AC3 | no regression |

Low findings (accepted):
1. ASK-AC21: full-page capture stitches the inner scroll container around the fixed header.
2. ASK images: white band below the app in the full-page capture.
3. Mobile: the panel overlays the page, leaving a clipped strip.
4. ASK-AC15: citation numbers use the browser link colour; entry 2 underlined.
