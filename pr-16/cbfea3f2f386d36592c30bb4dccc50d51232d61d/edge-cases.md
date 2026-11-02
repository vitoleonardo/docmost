# Edge cases: 403 for forbidden pages and spaces

Server e2e rows (n/a) run in the data step against the seeded database; browser states are in apps/client/e2e/*.screenshots.ts, run in the screenshot step.

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| BRIDGE-AC79 | not found | trashed, deleted-space, other-workspace or unknown page | 404 page_not_found | BRIDGE-AC79: a page in a deleted space, in the trash, of another workspace or unknown throws 404 page_not_found | |
| BRIDGE-AC79 | not found wins | restricted page in a deleted space of a non-member | 404, not 403 | BRIDGE-AC79: not found wins over forbidden for a restricted page in a deleted space of a non-member | |
| BRIDGE-AC79 | service maps code | page lookup throws not found | page_not_found | BRIDGE-AC79: a page that is not found answers page_not_found | |
| BRIDGE-AC79 | real route | read-page on a seeded stack | same 404 for all three | n/a: server e2e, "BRIDGE-AC79: read-page answers a trashed, deleted-space or unknown page with the same 404 page_not_found" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| BRIDGE-AC80 | missing permission | restricted page, page of a non-member space | 403 page_forbidden | BRIDGE-AC80: a restricted page and a page of a space the user is not a member of throw 403 page_forbidden | |
| BRIDGE-AC80 | removed member | user removed from the space | 403 page_forbidden | BRIDGE-AC80: a page of a space the user was removed from throws 403 page_forbidden | |
| BRIDGE-AC80 | allowed | viewable page | page with content | BRIDGE-AC80: returns the page with its content when the user may view it | |
| BRIDGE-AC80 | real route | read-page on a seeded stack | same 403 for both | n/a: server e2e, "BRIDGE-AC80: read-page answers a restricted page and a page of a foreign space with the same 403 page_forbidden" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| BRIDGE-AC81 | not found | deleted, other-workspace or unknown space | 404 space_not_found | BRIDGE-AC81: a space marked as deleted, of another workspace or unknown throws 404 space_not_found | |
| BRIDGE-AC81 | not found wins | deleted space of a non-member | 404, not 403 | BRIDGE-AC81: not found wins for a deleted space the user is not a member of | |
| BRIDGE-AC81 | no search run | space not found | no search call | BRIDGE-AC81: a space that is not found answers space_not_found without searching | |
| BRIDGE-AC81 | real route | search on a seeded stack | same 404 | n/a: server e2e, "BRIDGE-AC81: search answers a deleted or unknown space with the same 404 space_not_found" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| BRIDGE-AC82 | missing permission | space of which the user is not a member | 403 space_forbidden | BRIDGE-AC82: a space the user is not a member of throws 403 space_forbidden | |
| BRIDGE-AC82 | allowed | member space | passes | BRIDGE-AC82: a space the user is a member of passes | |
| BRIDGE-AC82 | no search run | forbidden space | no search call | BRIDGE-AC82: a space the user is not a member of answers space_forbidden without searching | |
| BRIDGE-AC82 | real route | search on a seeded stack | 403 | n/a: server e2e, "BRIDGE-AC82: search answers a space the user is not a member of with 403 space_forbidden" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| BRIDGE-AC82 | contract | both codes in the contract | 403, listed by user-token endpoints | answers 403 and is listed by exactly the endpoints called with a user | |
| ASK-AC78 | not found, no AI call | deleted or unknown space scope | 404 space_not_found, nothing called | answers 404 space_not_found and calls nothing | |
| ASK-AC78 | real route | deleted or unknown space | 404 | n/a: server e2e, "ASK-AC78: a deleted or unknown space answers 404 space_not_found" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| ASK-AC79 | missing permission | non-member space | 403 space_forbidden, nothing called | ASK-AC79: a space the user is not a member of answers 403 space_forbidden and calls nothing | |
| ASK-AC79 | removed member | space the user left | 403 space_forbidden | ASK-AC79: a space the user left answers 403 space_forbidden and calls nothing | |
| ASK-AC79 | real route | non-member space | 403 | n/a: server e2e, "ASK-AC79: a space the user is not a member of answers 403 space_forbidden" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| ASK-AC80 | not found, no AI call | trashed or unknown page scope | 404 page_not_found | answers 404 page_not_found and calls nothing | |
| ASK-AC80 | not found wins | restricted page in a deleted space | 404 | ASK-AC80: a restricted page in a space marked as deleted answers 404 page_not_found, not found wins | |
| ASK-AC80 | real route | trashed or unknown page | 404 | n/a: server e2e, "ASK-AC80: a trashed or unknown page answers 404 page_not_found" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| ASK-AC81 | missing permission | restricted page scope | 403 page_forbidden, nothing called | ASK-AC81: a page the user may not view answers 403 page_forbidden and calls nothing | |
| ASK-AC81 | foreign space | page of a non-member space | 403 page_forbidden | ASK-AC81: a page of a space the user is not a member of answers 403 page_forbidden and calls nothing | |
| ASK-AC81 | real route | restricted and foreign-space page | 403 | n/a: server e2e, "ASK-AC81: a restricted page and a page of a foreign space answer 403 page_forbidden" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| ASK-AC82 | panel text | page_forbidden turn | "Du hast keinen Zugriff auf diese Seite.", no sources | ASK-AC82: a page_forbidden turn shows the access text and no sources | |
| ASK-AC82 | service mapping | HTTP 403 page_forbidden | typed error | ASK-AC82, ASK-AC83: maps HTTP 403 with code page_forbidden to a typed error | |
| ASK-AC82 | conversation state | page_forbidden | turn marked, no sources | ASK-AC82, ASK-AC83: page_forbidden marks the turn with that refusal and no sources | |
| ASK-AC83 | panel text | space_forbidden turn | "Du hast keinen Zugriff auf diesen Bereich.", no sources | ASK-AC83: a space_forbidden turn shows the access text and no sources | |
| ASK-AC83 | service mapping | HTTP 403 space_forbidden | typed error | maps HTTP 403 with code space_forbidden to a typed error | |
| ASK-AC83 | conversation state | space_forbidden | turn marked, no sources | ASK-AC82, ASK-AC83: space_forbidden marks the turn with that refusal and no sources | |
| ASK-AC84 | trashed page | 404 page_not_found | no-source text, nothing revealed | ASK-AC84: | |
| EXTRACT-AC70 | not found, no AI call | trashed or unknown page | 404 page_not_found | EXTRACT-AC70: trashed and unknown pages throw 404 page_not_found without an edit check | |
| EXTRACT-AC70 | real route | trashed or unknown page | 404, nothing called | n/a: server e2e, "EXTRACT-AC70: a trashed or unknown page answers 404 page_not_found and calls nothing" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| EXTRACT-AC71 | missing permission | restricted and other-space page | 403 page_forbidden, no edit check | EXTRACT-AC71: restricted and other-space pages throw 403 page_forbidden without an edit check | |
| EXTRACT-AC71 | real route | page of a non-member space | 403, nothing called | n/a: server e2e, "EXTRACT-AC71: a page of a space the user is not a member of answers 403 page_forbidden and calls nothing" in apps/server/test/ai-bridge.e2e-spec.ts, run in verify step 3 | |
| EXTRACT-AC72 | dialog text | page_forbidden | "Du hast keinen Zugriff auf diese Seite." | EXTRACT-AC72, EXTRACT-AC43: shows the text and only Schließen | |
| EXTRACT-AC72 | service mapping | HTTP 403 page_forbidden | page_forbidden | EXTRACT-AC72: maps HTTP 403 page_forbidden to page_forbidden | |
| EXTRACT-AC73 | lost edit right | 403 page_not_editable | not-editable text | EXTRACT-AC73: a user who lost the edit right after the button was shown gets 403 page_not_editable | |
| EXTRACT-AC73 | dialog text | not_available | "Der Anhang ist nicht mehr verfügbar oder du darfst die Seite nicht bearbeiten." | EXTRACT-AC73, EXTRACT-AC43: shows the text and only Schließen | |
| EXTRACT-AC73 | unknown 403/404 | no code | not_available | EXTRACT-AC73: maps HTTP | |
| EXTRACT-AC74 | close | Schließen after the access text | dialog closes, nothing inserted | EXTRACT-AC74: Schließen after the access text closes the dialog and inserts nothing | |
| AGENT-AC118 | tool refusal | restricted page read | "Kein Zugriff auf diese Seite.", no page text | test_agent_ac118_a_restricted_page_is_refused_as_not_accessible_with_no_page_text | |
| AGENT-AC118 | client error | 403 page_forbidden | PageForbidden | test_agent_ac118_a_page_the_user_may_not_view_is_forbidden | |
| AGENT-AC118 | not not-found | both forbidden variants | Forbidden, not NotFound | test_agent_ac118_forbidden_variants_share_one_handling_and_are_not_not_found | |
| AGENT-AC118 | server | restricted page of the run space | forbidden, no text | AGENT-AC118: a restricted page of the run space is refused as forbidden without its text | |
| AGENT-AC119 | removed mid-run | search after removal | "Kein Zugriff auf diesen Bereich." | test_agent_ac119_a_search_after_the_user_left_the_space_is_refused_as_not_accessible | |
| AGENT-AC119 | client error | 403 space_forbidden | SpaceForbidden | test_agent_ac119_ac120_a_space_the_user_left_is_forbidden_for_search_and_read | |
| AGENT-AC120 | removed mid-run | read after removal | "Kein Zugriff auf diese Seite." | test_agent_ac120_a_read_after_the_user_left_the_space_is_refused_as_not_accessible | |
| AGENT-AC120 | server | read after removal | forbidden | AGENT-AC120: after the user is removed from the run space the next read is refused as forbidden | |
| AGENT-AC120 | real route, valid token | removed member, read-blocks | 403 page_forbidden | n/a: server e2e, "AGENT-AC120: a member removed from the run space gets 403 page_forbidden on read-blocks with a still valid token" in apps/server/test/ai-agent.e2e-spec.ts, run in verify step 3 | |
| AGENT-AC121 | page gone on view | 404 page_not_found | gone text, Schließen, no proposal text | AGENT-AC121: a gone page shows the text, Schließen and no proposal text | |
| AGENT-AC121 | page gone on apply | 404 on apply | same text | AGENT-AC121: a page that vanishes on apply shows the same text | |
| AGENT-AC121 | service mapping | 404 page_not_found | page_gone | AGENT-AC121: viewing with 404 page_not_found maps to page_gone | |
| AGENT-AC122 | missing permission | 403 on view | access text, Schließen, no reason or texts | AGENT-AC122: a page the user may no longer view shows the access text, Schließen and no proposal text | |
| AGENT-AC122 | service mapping | 403 page_forbidden | page_forbidden | AGENT-AC122: viewing with 403 page_forbidden maps to page_forbidden | |
| AGENT-AC123 | not found on view | trashed or deleted page | 404, no proposal text | answers 404 page_not_found with no text of the proposal | |
| AGENT-AC124 | missing permission on view | restricted or non-member page | 403, no proposal text | answers 403 page_forbidden with no text of the proposal | |
| AGENT-AC125 | not found on apply | trashed or deleted page | 404, no claim, no write | answers 404 page_not_found, no claim and no write | |
| AGENT-AC126 | missing permission on apply | restricted or non-member page | 403, no claim, no write | answers 403 page_forbidden, no claim and no write | |
| AGENT-AC126 | other user's proposal | proposal of another user on a hidden page | 404 proposal_not_found, before any page check | a proposal of another user on a page the requester may not view answers 404 proposal_not_found | |
| AGENT-AC127 | not found, no AI call | deleted or unknown space | 404 space_not_found | answers 404 space_not_found and the AI service is not called | |
| AGENT-AC128 | missing permission | non-member space | 403, AI service not called | AGENT-AC128: a space the user is not a member of answers 403 space_forbidden and the AI service is not called | |
| AGENT-AC128 | removed member | space the user was removed from | 403 | AGENT-AC128: a space the user was removed from answers 403 space_forbidden | |
| AGENT-AC129 | panel state | space_forbidden on start | G1, task kept, access text | AGENT-AC129: space_forbidden keeps state G1 with the task and shows the space text | |
| AGENT-AC129 | hook state | space_forbidden | task and space kept | AGENT-AC129: space_forbidden sets spaceForbidden and keeps the task and space | |
| AGENT-AC129 | service mapping | 403 space_forbidden | space_forbidden | AGENT-AC129: 403 space_forbidden maps to space_forbidden | |
| AGENT-AC130 | log outcome | page_forbidden apply or discard | log line with run id, proposal id, outcome | the outcome page_forbidden of a | |
| AGENT-AC130 | no run id | proposal not found | no outcome line | AGENT-AC130: a request for a proposal that is not found logs no outcome line, as it has no run id | |
| AGENT-AC131 | lost view before apply | 403 on Übernehmen | access text, no diff, page unchanged | AGENT-AC131: losing view access before Übernehmen shows the access text and no diff | |
| AGENT-AC131 | service mapping | 403 on apply | page_forbidden | AGENT-AC131: applying with 403 page_forbidden maps to page_forbidden | |
| AGENT-AC132 | non-member space read | page of Geschäftsführung | "Seite nicht gefunden.", no text | AGENT-AC132: a page of a space the user is not a member of is refused as not found | |
| AGENT-AC133 | in the named space | viewable vs restricted | page vs 403 page_forbidden | AGENT-AC133: in the named space, a viewable page is returned and a restricted page throws 403 page_forbidden | |
| AGENT-AC133 | outside the named space | viewable or hidden page | 404 page_not_found | AGENT-AC133: a page outside the named space throws 404 page_not_found, viewable or hidden | |
| AGENT-AC133 | double submit | n/a | n/a | n/a: read-only block reads; a repeated read gives the same answer and changes nothing | |
