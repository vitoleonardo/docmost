# Screenshot review, verify round 4 (head 29d7c27a)

Verdict: Ready. 0 high, 1 medium, 6 low. 16 EXTRACT images reviewed (AC1, AC2, AC9, AC14, AC21, AC27, AC32, AC69; desktop and mobile). No base images: the base run failed on env validation and the extraction UI does not exist on m6-leak-tests.

| Image | Verdict |
|---|---|
| AC1 e1 desktop, mobile | matches |
| AC2 e1-embedded desktop, mobile | matches (embedded frame is blank in headless Chromium) |
| AC9 e2 desktop | matches |
| AC9 e2 mobile | matches with accepted exception (Quelle past the edge) |
| AC14 e2-not-found desktop | matches |
| AC14 e2-not-found mobile | matches with accepted exception |
| AC69 e2-values desktop | matches |
| AC69 e2-values mobile | matches, at the limit (inputs about 140 px, 2–3 px inside the edge) |
| AC21 e4 desktop | matches |
| AC21 e4 mobile | matches with accepted exception; medium 1 |
| AC27 e4-second desktop | matches |
| AC27 e4-second mobile | matches with accepted exception; medium 1 |
| AC32 e3 desktop, mobile | matches |

Medium 1: at 412 px the inserted table also cuts part of "Wert" (sideways scroll of Docmost's table); the Decision and Out of scope line name only "Quelle". Accepted at the auto gate, see Decisions to review.

Low: 1 AC69 width has no slack (the test decides); 2 blank embedded PDF frame; 3 AC21/AC27 use fixture names, not AC21's example values (tests check literals); 4 tall mobile rows from the hidden Quelle text; 5 AC27 image cannot show the second user; 6 desktop full-page captures show white below the sidebar.
