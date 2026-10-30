# Design

Mockups for the Must features with UI: `ai-assistant.html` (open it in a browser; self-contained). Each feature spec links its section in its User flow, and its acceptance criteria refer to the state IDs (A1, E2, G4, ...).

The mockups copy Docmost v0.96's look: Mantine with the theme in `apps/client/src/theme.ts`, Tabler icons, header 45 px, sidebar 300 px, aside panel 350 px. Greys, tab style and the page action row were checked against the running app; `reference/docmost-v0.96-page-with-comments.png` is the screenshot they were compared with. The assistant panel follows the Comments aside: grey background, title with close button, underlined tabs, input below a divider. The new UI uses existing Mantine components only (Tabs, Modal, Table, Alert, Badge, Button); no new design system.

## States

| ID | Feature | State |
|---|---|---|
| Overview | M5, M8 | Entry points: icon in the page action row and page menu item; panel in the aside |
| A1 | M5 Ask | Empty, scope selector, example questions |
| A2 | M5 Ask | Streaming answer with citations and sources |
| A3 | M5 Ask | No source (same text for missing and restricted content) |
| A4 | M3/M5 | Assistant unavailable |
| E1 | M7 Extraction | "Extract data" action on the attachment and embedded PDF |
| E2 | M7 Extraction | Review dialog: values, source quote and page per field, missing field flagged |
| E3 | M7 Extraction | Refused: scanned PDF, too many pages, too much text |
| E4 | M7 Extraction | Inserted table with source column, manual values marked as text |
| G1 | M8 Agent | Start: free-text task, space scope, examples |
| G2 | M8 Agent | Running: one line per ended step, step count and time, cancel |
| G3 | M8 Agent | Results: proposal cards with status; limit reached |
| G4 | M8 Agent | Diff dialog, apply or discard |
| G5 | M8 Agent | Stale proposal: apply blocked |
| G6 | M8 Agent | Read-only user: apply blocked with reason |

## Decisions

- **One panel, two modes.** "Fragen" (Ask) and "Aufgabe" (agent) share one aside tab, because both are "talk to the assistant" and Docmost's aside shows one tab at a time.
- **The agent takes a free-text task**, like Ask, scoped to one readable space. Its tools (search, read page, propose update) set what it can do, not the input. The MacBook is a test machine; the UI does not shrink to fit an 8B model. The evals use scripted prompts, so tests still have fixed inputs. A task outside the tools gets an answer saying what the agent can do instead (decided 27.10.2026).
- **Diffs open in a modal.** 350 px is too narrow for a readable diff.
- **No-source answers never reveal restricted content exists** (A3): the text is identical for missing and restricted content.
- **Sources appear after the citation check**, not while streaming (A2), so a citation that fails the permission check is never shown.
- **Extraction is offered only to users who can edit the page**, because the result is written into it.
- **UI language in the demo is German.** Code uses English i18n keys with `de-DE` and `en-US` translations, as Docmost does.

## Open questions

- Company name: `‹Seed-Firma›` is a placeholder until M2 picks the name.
- Dark mode: Docmost supports it; the new UI uses Mantine color variables only, so it follows automatically. Not mocked separately.
