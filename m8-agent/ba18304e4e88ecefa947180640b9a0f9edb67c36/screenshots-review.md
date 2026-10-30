# Screenshot review, verify round 2 (reviewer, opus), 30.10.2026

Verdict: all 20 AGENT images match their criteria; no high or medium findings. Round 1 points AGENT-AC16, AC24, AC48, AC89 now pass. No `.main.png` base images: the base run failed on environment validation; the agent tab does not exist on the base.

| Criterion | Images | Verdict |
|---|---|---|
| AGENT-AC1 | tabs desktop/mobile | match: Fragen selected, Aufgabe tab |
| AGENT-AC2 | g1 desktop/mobile | match: Bereich Allgemein, hint, Beispiele, Starten disabled |
| AGENT-AC16 | g2 desktop/mobile | match: task · space, no step lines, Schritt 0 von höchstens 20, Abbrechen |
| AGENT-AC24 | g2-two-steps desktop/mobile | match: search line above read line, Schritt 2 von höchstens 20 |
| AGENT-AC48 | g3 desktop/mobile | match: 5 distinct reads, 2 Vorschläge · 5 Seiten gelesen, cards in creation order, final message, Neue Aufgabe |
| AGENT-AC59 | limit-hint desktop/mobile | match: orange hint, card, Neue Aufgabe, no final message |
| AGENT-AC71 | g4 desktop/mobile | match: title, reason, heading, word diff, save note, Verwerfen/Übernehmen |
| AGENT-AC89 | card, g5 desktop/mobile | match: Veraltet badge on first card; G5 stale text, Schließen, Neuen Vorschlag erstellen |
| AGENT-AC97 | g6 desktop/mobile | match: read-only text, Übernehmen disabled, no save note |

## Findings (all low)
1. AC59, AC89-g5: orange alerts use dark text and no icon (mockup: #a63508 and icon); spec only asks for an orange hint.
2. AC97: no lock icon on the read-only hint (mockup G6 has one).
3. AC48, AC89-card: "+1 −1" not coloured green/red as in the mockup.
4. AC48: fixture final message says two pages checked next to "5 Seiten gelesen" (model text, not a criterion mismatch).
5. AC71, AC89-g5, AC97: dialog content comes from a mocked proposal endpoint; images prove the UI only (server diff and stale detection are proven by unit and e2e tests).
6. Dialog crops include a few pixels of the panel below.
7. Mobile panel leaves a ~100 px strip of page text (pre-existing Ask panel behaviour).
8. Task title wraps after "·" on narrow widths.
