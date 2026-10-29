# Review (m5-ask, base m4-indexing)

Reviewer: independent `reviewer` agent (opus). Four rounds.

- Round 1 (head 32e12e9b): 2 high, 3 medium, 7 low. Not ready.
  - High: ASK-AC30 stale index space under a space scope; ASK-AC56 turn stored before the wiki's final verdict.
  - Fixed in db54b23a and 007cf367.
- Round 2 (head 007cf367): 0 high, 1 medium, 4 low. Ready for verify.
  - Medium: first-text deadline checked only per line.
  - Fixed in a64be696.
- Round 3 (a64be696 only): 0 high, 2 medium, 6 low. Ready for verify.
  - Mediums: list-item headings got no anchor; the anchor test mirrored sections.py.
  - Fixed in ad742674 with two lows. Three lows accepted (see Decisions to review).
  - ad742674 was not reviewed again.

- Round 4 (6378407f, 304c9023 only): 0 high, 0 medium, 4 low. Ready for PR.
  - Spec amendment: ASK-AC10 removed, ASK-AC77 (stop button named "Stoppen") passes; ASK-AC15 screenshot cites two sources.
  - Lows accepted: AC77 image timing (checked: the images show the partial answer and the stop icon); mock answer order vs the example question; AC77 unit test also covers stop; fetch stub ignores abort.

Criteria verdicts (round 2, confirmed in round 3): all ASK-AC1 to ASK-AC76 pass in tests, except:
- ASK-AC21: e2e scroll proof to be shown by the screenshot run.
- ASK-AC32 to AC35, AC39 to AC41, AC57: local stack only, re-run in verify.
