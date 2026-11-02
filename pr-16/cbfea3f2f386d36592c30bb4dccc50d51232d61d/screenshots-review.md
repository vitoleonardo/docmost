# Screenshot review

Reviewer (opus), 02.11.2026, head cbfea3f2.

**Ready: yes.** All 12 images of the new criteria match their criterion text. None of the findings is high or medium.

## Images

| File | Criterion | Verdict | What I see |
|---|---|---|---|
| ASK-AC82-page-forbidden-desktop.png | ASK-AC82 | matches | Scope "Diese Seite", question "Wann ist die Kernarbeitszeit?", then "Du hast keinen Zugriff auf diese Seite.". No "Quellen", no no-source text of A3. |
| ASK-AC82-page-forbidden-mobile.png | ASK-AC82 | matches | Same content, nothing cut off. The panel covers the page; the page text is clipped at the left edge. |
| ASK-AC83-space-forbidden-desktop.png | ASK-AC83 | matches | Scope "IT", question, then "Du hast keinen Zugriff auf diesen Bereich.". No "Quellen". |
| ASK-AC83-space-forbidden-mobile.png | ASK-AC83 | matches | Same content, readable. |
| EXTRACT-AC72-e3-page-forbidden-desktop.png | EXTRACT-AC72 | matches | Dialog "Daten extrahieren: liefervertrag-pumpen-fiktivwerk.pdf" with "Du hast keinen Zugriff auf diese Seite." and only "Schließen". No "Abbrechen" or "Als Tabelle einfügen". |
| EXTRACT-AC72-e3-page-forbidden-mobile.png | EXTRACT-AC72 | matches | Same dialog. The title wraps cleanly. The tooltip "Daten extrahieren" is still visible behind the overlay. |
| AGENT-AC122-page-forbidden-desktop.png | AGENT-AC122 | matches | The image is cropped to the dialog, but the whole dialog is there, not a blank area: title "Vorschlag: Reisekosten Richtlinie 2022", close X, "Du hast keinen Zugriff auf diese Seite.", "Schließen". No "Begründung:", no diff, no "Verwerfen" or "Übernehmen". |
| AGENT-AC122-page-forbidden-mobile.png | AGENT-AC122 | matches | Same, the title wraps to two lines, nothing cut. |
| AGENT-AC129-g1-space-forbidden-desktop.png | AGENT-AC129 | matches | G1 with "Bereich" set to "Allgemein", the hint, "Du hast keinen Zugriff auf diesen Bereich.", "Beispiele" with both example tasks, the input still holding "Finde veraltete Seiten zu Reisekosten", and "Starten". No step line. |
| AGENT-AC129-g1-space-forbidden-mobile.png | AGENT-AC129 | matches | Same content, readable. |
| AGENT-AC131-page-forbidden-desktop.png | AGENT-AC131 | matches for the dialog text | The whole dialog, looking exactly like AGENT-AC122. The image cannot show that "Übernehmen" was clicked, or that the page content is unchanged. |
| AGENT-AC131-page-forbidden-mobile.png | AGENT-AC131 | matches for the dialog text | Same as above. |

## Verdict per criterion

- **ASK-AC82:** match
- **ASK-AC83:** match
- **EXTRACT-AC72:** match
- **AGENT-AC122:** match
- **AGENT-AC129:** match
- **AGENT-AC131:** match for the dialog. "The page content is unchanged" cannot be judged from an image. The Playwright test checks only the dialog and stubs the apply route, so nothing is written either way. The unchanged page rests on the server test for AGENT-AC126.

## Findings

1. [low] The AGENT-AC131 images look exactly like the AGENT-AC122 images. Nothing in them shows the dialog was reached through "Übernehmen". Suggestion: also save the step before the click (open dialog with the diff and "Übernehmen") as `AGENT-AC131-open-<width>.png`.
2. [low] In EXTRACT-AC72 mobile, the hover tooltip "Daten extrahieren" stays visible under the overlay, next to the attachment. It is cosmetic and hides nothing in the dialog.
3. [low] The desktop and mobile full-page images have an empty white band below the app (ASK at about y 720 to 937, AGENT-AC129 below 1100). The older images ASK-AC36-a3-desktop.png and AGENT-AC89-card-desktop.png show the same band, so this change did not cause it.
4. [low] In the AGENT-AC122 desktop crop, faint slivers of the page behind the dialog show along the bottom edge. Cosmetic only.

The dialog title still names the page ("Vorschlag: Reisekosten Richtlinie 2022"). That is not a mismatch: the criterion rules out only the reason, old text and new text, and the title was already on the card.

## Not checked

The reviewer guard blocks listing the screenshot folder, so I could not open every one of the other 56 images. I opened only the two whose names I could get from the test file (ASK-AC36-a3-desktop.png, AGENT-AC89-card-desktop.png). Neither looks broken; the other 54 I have not seen.

The images are in /Users/vito/Documents/GitHub/docmost/.work/forbidden-403-server/evidence/screenshots/.
