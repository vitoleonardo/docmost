# Ask

ID prefix: ASK

## Goal
Employees ask the wiki a question in German in the assistant panel and get a streamed German answer whose statements name their source page and section, built only from pages they may view now. When no page they may view answers the question, they get the same refusal whether the content is missing or restricted.

## User flow
Mockup: `docs/design/ai-assistant.html`, sections "Überblick" and "M5 Fragen", states A1 to A4.

1. A logged-in user opens a page and opens the panel "Assistent" with the assistant icon in the page's action row (BRIDGE user flow step 3), or with the page menu item "Zu dieser Seite fragen", which opens the panel with the scope "Diese Seite" and keeps the current conversation. The menu item is shown whenever the assistant icon is shown.
2. The panel checks the assistant status as in BRIDGE user flow step 4. Unavailable: state A4 with the input disabled. Available: state A1, with the heading "Frag das Wiki", the hint "Antworten stützen sich nur auf Seiten, die du sehen darfst, und nennen ihre Quellen.", a scope selector, two example questions and the input "Frage stellen …" with a send button.
3. The scope selector offers "Alle Bereiche" (the default), "Diese Seite" (the page open when the question is sent) and every space the user is a member of, sorted alphabetically by name. The chosen scope stays until the user changes it or the conversation ends. The example questions are fixed texts about seed pages every seed user can read; clicking one sends it as a question.
4. The user types a question and sends it with the send button or Enter. The question appears in the conversation, and the answer appears below it in parts while it is generated (state A2). From sending until the answer ends, the send button is an icon button with the accessible name "Stoppen" and nothing else is sent; clicking "Stoppen" ends the answer and its generation.
5. Behind the scenes the AI service searches the index within the scope with the question and the conversation's previous question. It has the bridge filter every candidate page for this user with the wiki's current data, keeps the sections of the pages that pass and score at least the relevance threshold, and sends the best of them to the model, numbered as sources, with the earlier turns of the conversation. The model writes the answer in German and marks each statement with the number of its source, like `[1]`.
6. When the answer is complete, the wiki checks every cited page again for this user. If all pass, the panel shows the list "Quellen": one entry per cited source, numbered from 1 in the order of first citation, with the page title and, below it, the space name followed by the section's heading path, joined with " › ". A PDF source shows the space name, the file name and "Seite <n>". Clicking an entry or a citation number opens the page at the cited heading; a PDF source or a section without a heading opens the page at its top. If a cited page fails the check, the whole answer is replaced by the no-source text of step 7.
7. When no section passes the filter and the threshold, the panel shows "Dazu habe ich in den Seiten, auf die du Zugriff hast, keine passende Quelle gefunden. Formuliere die Frage anders oder wende dich an die zuständige Abteilung." (state A3), without sources and without calling the model.
8. The user asks follow-up questions in the same conversation. The icon button "Neue Unterhaltung" in the panel's title row ends the conversation (stopping an answer that is being generated) and shows state A1 again. Reloading the app also ends the conversation. Closing and reopening the panel, or moving to another page, keeps it.
9. If the model does not answer or the bridge's filter fails, the answer shows "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal." If the AI service cannot be reached, the panel shows state A4.

### Answers
- The answer is Markdown. The panel renders it without raw HTML and without loading remote images (spec section 7 item 8). Only links to `http` or `https` addresses are clickable; any other link is shown as its text.
- The citation numbers in the text are the display numbers of "Quellen", not the model's: the model's first cited source becomes 1, the next new one 2, and so on. A citation number that names no source given to the model is removed from the text. Both happen while the text streams, so the text never shows a model number.
- A complete answer that cites no source is replaced by the no-source text of state A3. Until the answer is complete, its text is shown as it streams.
- A stopped answer keeps the text shown so far, followed by "Abgebrochen", and shows no list "Quellen".
- Stopped answers, failed answers and answers replaced by the no-source text are not part of the conversation's history.

### Conversations
- A conversation belongs to one user. The AI service keeps its completed questions and answers, with the pages whose sections were in each answer's prompt, and drops them 24 h after the last question. A conversation that has ended is not reachable any more and is dropped by the same rule.
- With each question the model sees at most the last 5 turns of the conversation, without any answer whose prompt held a section of a page the user may no longer view. The user's own earlier questions stay.
- A conversation whose history was dropped while the panel stayed open keeps showing its turns in the panel; the next question is answered without them.

### Limits
- A question has 1 to 2,000 characters after removing leading and trailing whitespace.
- The search returns at most 20 candidate sections; at most 8 of the passing sections with the best scores go to the model.
- The relevance threshold is a similarity score of 0.45 (score range of the index search, -1 to 1).
- The model must start answering within 60 s, or the answer fails as in step 9.

### Logging
Each question logs one line in the AI service with the conversation id, the inference mode, the model, the number of candidate sections, the number that passed the filter and the threshold, the time to the first answer text and the outcome: `answered`, `no_source`, `stopped`, `model_failed` or `filter_failed`. Log lines never hold the question, the answer, page text or tokens.

## Acceptance criteria

### Panel
- **ASK-AC1**: Given the status is `available`, when the user opens the panel, then it shows "Frag das Wiki", the hint text of user flow step 2 and an input with the placeholder "Frage stellen …".
- **ASK-AC2**: Given the status is `available`, when the user opens the panel, then it shows the example questions "Wer beantwortet Rückfragen zur Reisekostenabrechnung?" and "Wann ist die Kernarbeitszeit?".
- **ASK-AC3**: Given the seed user WS, when WS opens the scope selector, then its options are "Alle Bereiche", "Diese Seite", "Allgemein", "IT" and "Projekte", in this order, and "Alle Bereiche" is selected.
- **ASK-AC4**: Given the status is `available`, when the user clicks an example question, then that question appears in the conversation and the panel shows the first part of its answer or the no-source text of state A3.
- **ASK-AC5**: Given the status is `available` and a conversation with an answered question, when the user picks "Zu dieser Seite fragen" in the page menu, then the panel opens with the scope "Diese Seite" and shows the earlier question and answer.
- **ASK-AC6**: Given the status is `disabled`, when the user opens the page menu, then it has no item "Zu dieser Seite fragen".
- **ASK-AC7**: Given the status is `unavailable`, when the user opens the panel, then the question input and the send button are disabled.
- **ASK-AC8**: Given the user picked the space "IT" as scope, when the user moves to another page and opens the panel again, then the scope selector shows "IT".

### Streaming answer
- **ASK-AC9**: Given a question with sections that pass the filter and the threshold, when the user sends it, then the panel shows the first part of the answer before the AI service has sent the last part.
- **ASK-AC10** (removed 29.10.2026: replaced by ASK-AC77, the button is an icon without visible text)
- **ASK-AC77**: Given a question was sent and its answer has not ended, when the send button is read by its accessible name, then the name is "Stoppen".
- **ASK-AC11**: Given a question was sent and its answer has not ended, when the user presses Enter in the input, then no second question is sent.
- **ASK-AC12**: Given an answer is being generated, when the user clicks "Stoppen", then no further text is added, the text shown so far stays, followed by "Abgebrochen", and no list "Quellen" appears.
- **ASK-AC13**: Given an answer is being generated, when the user clicks "Stoppen", then the AI service stops requesting text from the model and logs the outcome `stopped`.
- **ASK-AC14**: Given an answer is being generated, when the panel shows its text, then no list "Quellen" is shown.

### Citations and sources
- **ASK-AC15**: Given a complete answer that cites two sources whose pages pass the final check, when the list "Quellen" appears, then it holds exactly one entry per cited source, numbered 1 and 2 in the order of their first citation in the text, and every number in the text has an entry.
- **ASK-AC16**: Given a model answer that cites its source 3 first and its source 1 second, when the answer is shown, then the text shows them as 1 and 2, and entry 1 of "Quellen" is the model's source 3.
- **ASK-AC17**: Given a cited section of a page with the heading path ["Bänder"] in the space Geschäftsführung, when its entry in "Quellen" is shown, then it reads the page title and "Geschäftsführung › Bänder".
- **ASK-AC18**: Given a cited section with the heading path ["A", "B"] in the space Allgemein, when its entry in "Quellen" is shown, then it reads the page title and "Allgemein › A › B".
- **ASK-AC19**: Given a cited section with an empty heading path, when its entry in "Quellen" is shown, then it reads the page title and the space name only.
- **ASK-AC20**: Given a cited section of a PDF, when its entry in "Quellen" is shown, then it reads the page title and the space name, the file name and "Seite <n>" with the section's PDF page number.
- **ASK-AC21**: Given a source entry of a section with a heading path, when the user clicks it, then the page opens with the first heading whose heading path equals the section's in view.
- **ASK-AC22**: Given a source entry of a PDF section or of a section with an empty heading path, when the user clicks it, then the page opens at its top.
- **ASK-AC23**: Given a citation number in the answer text, when the user clicks it, then the same page opens as for its entry in "Quellen".
- **ASK-AC24**: Given the model's answer holds a citation number that names no source it was given, when the answer is shown, then that number is not in the text and has no entry in "Quellen".
- **ASK-AC25**: Given the model's complete answer cites no source it was given, when the answer ends, then the panel shows the no-source text of state A3 instead of it.
- **ASK-AC26**: Given a cited page moved to the trash after the prompt was assembled and before the answer is complete, when the answer ends, then the panel shows the no-source text of state A3 instead of the answer.
- **ASK-AC27**: Given a cited page whose space the user was removed from after the prompt was assembled and before the answer is complete, when the answer ends, then the panel shows the no-source text of state A3 instead of the answer.
- **ASK-AC28**: Given a cited page that got a restriction excluding the user after the prompt was assembled and before the answer is complete, when the answer ends, then the panel shows the no-source text of state A3 instead of the answer.

### Permission filter before generation
- **ASK-AC29**: Given the scope "Alle Bereiche", when the prompt for the model is assembled, then every section in it belongs to a page in a space the user is a member of now.
- **ASK-AC30**: Given a space as scope, when the prompt for the model is assembled, then every section in it belongs to a page of that space.
- **ASK-AC31**: Given the scope "Diese Seite", when the prompt for the model is assembled, then every section in it belongs to that page or a PDF attached to it.
- **ASK-AC32**: Given the restricted page "Umstrukturierung 2027" in the open space Allgemein, when WS asks a question that holds a sentence of that page verbatim, then no section of that page is in the prompt.
- **ASK-AC33**: Given an indexed page that has been moved to a space the user is not a member of and whose index entry still holds the old space, when the user asks a question that holds a sentence of that page verbatim, then no section of that page is in the prompt.
- **ASK-AC34**: Given an indexed page that is in the trash and still in the index, when the user asks a question that holds a sentence of that page verbatim, then no section of that page is in the prompt.
- **ASK-AC35**: Given the 4 seed users and the questions of ASK-AC2, ASK-AC32, ASK-AC33, ASK-AC34, ASK-AC39 and ASK-AC40, when each user asks each question, then the prompt holds no section of a page that user may not view.

### No source
- **ASK-AC36**: Given every candidate section that passes the filter scores below the relevance threshold, when the user sends a question, then the panel shows the no-source text of state A3, no list "Quellen", and the model is not called.
- **ASK-AC37**: Given candidate sections that all fail the filter, when the user sends a question, then the panel shows the no-source text of state A3 and the model is not called.
- **ASK-AC38**: Given a question request for a user who is a member of no space, when it is answered, then the answer is the no-source text of state A3 and the model is not called.
- **ASK-AC39**: Given the indexed seed data and the real embedding model, when WS asks "Welche Gehaltsbänder gelten für die Abteilungsleitung?" with the scope "Alle Bereiche", then the panel shows the no-source text of state A3.
- **ASK-AC40**: Given the indexed seed data and the real embedding model, when a seed user asks "Wie pflege ich eine Orchidee?", then the panel shows the same text as in ASK-AC39.
- **ASK-AC41**: Given the local model and GF with the scope "Alle Bereiche", when GF asks "Welche Gehaltsbänder gelten für die Abteilungsleitung?", then the answer contains "75.000" and "Quellen" has an entry for the page "Gehaltsbänder".

### Rendering
- **ASK-AC42**: Given an answer that contains `<b>fett</b>` and `<script>`, when it is shown, then both appear as literal text and no element is created from them.
- **ASK-AC43**: Given an answer that contains a Markdown image with a remote address, when it is shown, then the browser sends no request to that address.
- **ASK-AC44**: Given an answer with a Markdown link whose address starts with `javascript:` or `data:`, when it is shown, then its text is shown and it is not a link.
- **ASK-AC45**: Given an answer with a Markdown link to an `https` address, when it is shown, then it is a link to that address.

### Conversations
- **ASK-AC46**: Given a conversation with one answered question, when the user sends a second question, then the prompt holds the first question and its answer.
- **ASK-AC47**: Given a conversation with 6 answered questions, when the user sends a seventh, then the prompt holds the last 5 questions and answers and not the first.
- **ASK-AC48**: Given a conversation whose first question was answered from a section of a page P, when the user sends a follow-up question that names none of P's words, then the search for candidates uses the first question too and a section of P is in the prompt.
- **ASK-AC49**: Given a conversation with an answered question, when the user clicks "Neue Unterhaltung", then the panel shows state A1 and the prompt of the next question holds no earlier turn.
- **ASK-AC50**: Given an answer is being generated, when the user clicks "Neue Unterhaltung", then the answer stops and the panel shows state A1.
- **ASK-AC51**: Given a conversation with an answered question, when the user reloads the app and asks a question, then the panel shows only the new question and its prompt holds no earlier turn.
- **ASK-AC52**: Given a conversation with an answered question, when the user closes the panel, moves to another page and opens the panel again, then the panel shows the earlier question and answer.
- **ASK-AC53**: Given a conversation whose last question was 24 h ago and the panel still open, when the user sends a question, then its prompt holds no earlier turn and the panel still shows the earlier turns.
- **ASK-AC54**: Given a conversation of user A, when user B sends a question with the same conversation id, then B's prompt holds no turn of A's conversation and A's next prompt holds no turn of B.
- **ASK-AC55**: Given a conversation with an answer whose prompt held a section of a page the user may no longer view, when the user sends the next question, then the prompt does not hold that answer and holds its question.
- **ASK-AC56**: Given a conversation whose last answer was stopped, failed or replaced by the no-source text, when the user sends the next question, then the prompt does not hold that answer.

### Time to first answer text
- **ASK-AC57**: Given the full stack runs locally on the M3 Pro with the local model already loaded, when a seed user sends a question not asked before, then the first part of the answer appears in the panel at most 10 s after sending.

## Edge cases
- **ASK-AC58**: Given an empty or whitespace-only input, when the user looks at the send button, then it is disabled.
- **ASK-AC59**: Given an input of 2,001 characters without leading or trailing whitespace, when the user looks at the panel, then the send button is disabled and the panel shows "Höchstens 2.000 Zeichen".
- **ASK-AC60**: Given an input of exactly 2,000 characters, when the user sends it, then the panel shows the first part of an answer or the no-source text of state A3.
- **ASK-AC61**: Given a question request with an empty question, a question of 2,001 characters, a missing or malformed conversation id, a malformed space or page id, or both a space and a page, when it reaches the wiki, then the wiki answers with status 400 and error code `invalid_request` for each.
- **ASK-AC62**: Given a question request with a space scope the user is not a member of, a space marked as deleted or a space id that does not exist, when it reaches the wiki, then the wiki answers with status 404 and error code `space_not_found` for each.
- **ASK-AC63**: Given a question request with a page scope the user may not view, a page in the trash or a page id that does not exist, when it reaches the wiki, then the wiki answers with status 404 and error code `page_not_found` for each.
- **ASK-AC64**: Given no login session, when a question request reaches the wiki, then the wiki answers with status 401.
- **ASK-AC65**: Given the assistant is switched off, when a question request reaches the wiki, then the wiki answers with status 503 and error code `assistant_disabled`.
- **ASK-AC66**: Given the AI service refuses connections, when the user sends a question, then the panel shows state A4.
- **ASK-AC67**: Given the model's address refuses connections, when the user sends a question, then the answer shows "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal."
- **ASK-AC68**: Given the model sends no answer text within 60 s, when the user has sent a question, then the answer shows the text of ASK-AC67.
- **ASK-AC69**: Given the model fails after part of the answer was shown, when the answer ends, then the text shown so far is followed by the text of ASK-AC67 and no list "Quellen" appears.
- **ASK-AC70**: Given the bridge's filter fails for a question, when the answer ends, then the answer shows the text of ASK-AC67 and the model was not called.
- **ASK-AC71**: Given a request to the AI service's question endpoint without a service token, with a wrong one, without a user token or with an expired one, when it reaches the AI service, then it answers with status 401 and the error code `service_token_missing`, `service_token_invalid`, `user_token_missing` or `user_token_expired` respectively.
- **ASK-AC72**: Given a request to the AI service's question endpoint with a user token that is malformed, has an audience other than `ai-service`, uses the algorithm `none` or is signed with another secret, when it reaches the AI service, then it answers with status 401 and error code `user_token_invalid` for each.
- **ASK-AC73**: Given a request to the AI service's question endpoint with a field the contract does not list, such as a user id, when it reaches the AI service, then it answers with status 400 and error code `invalid_request`.
- **ASK-AC74**: Given a question for each outcome `answered`, `no_source`, `stopped`, `model_failed` and `filter_failed`, when the AI service's log line for it is read, then it holds the conversation id, the mode, the model, the number of candidate sections, the number of passing sections, the time to the first answer text where there was one, and that outcome.
- **ASK-AC75**: Given any question, when the AI service's log lines for it are read, then they hold no question text, answer text, page text or token.
- **ASK-AC76**: Given a page with indexed sections under several headings, when the user asks with the scope "Diese Seite" a question that one of its sections answers verbatim, then a section of that page is in the prompt.

## Out of scope
- The "Aufgabe" tab and the agent (M8); M5 shows the panel without tabs.
- The full prompt-content leak matrix, the canary suite and the stale-index matrix (M6); ASK-AC32 to ASK-AC35 cover this feature's own questions.
- Golden set, eval scores and re-setting the relevance threshold from them (M10).
- The request log with tokens and cost (M9); M5 logs one line per question in the AI service.
- API mode, budgets, admin pages, thumbs up/down feedback and a global `/ask` page (Should).
- Answers that quote comments, page history or attachments other than PDF.
- Keeping conversations across reloads or devices, and listing past conversations.
- Rate limits per user (spec section 12, hosted demo).

## Open questions

## Decisions
- 28.10.2026: the relevance threshold is 0.45, from a first measurement with the embedding model `jinaai/jina-embeddings-v2-base-de` on the seed pages: the best section scored 0.586 to 0.771 for 8 questions the seed pages answer and 0.110 to 0.292 for 8 unrelated questions. For ASK-AC39, the best section WS may view scored 0.222. Spec section 9 sets the threshold from the eval baseline; that baseline comes with M10, which may change the value, so the build needs a measured number now. The threshold is a setting with this default.
- 28.10.2026: the ceiling for the time to the first answer text (ASK-AC57) is 10 s with the model already loaded: a first measurement on the M3 Pro with `qwen3:8b` gave 5.7 s for a prompt of about 6,000 characters of seed text that the model had not seen before. Loading the model the first time took about 13 s and is not counted.
- 28.10.2026: ASK-AC39 to ASK-AC41 and ASK-AC57 run locally only, with the real embedding model and, for ASK-AC41 and ASK-AC57, the local model, because CI has neither (spec section 10). ASK-AC36 and ASK-AC37 prove the same rules in CI with a test embedder.
- 28.10.2026: ASK-AC35 runs without a model in CI on every PR against the seed permission matrix, and locally against the real bridge with the seed data, because spec sections 9 and 10 put the prompt-content check in CI and CI has no database or wiki server yet. The CI services of spec section 10 come with M6's leak tests.
- 28.10.2026: the wiki, not the AI service, runs the final check of the cited pages and builds the entries of "Quellen" (title, space name, link) from its current data, because the AI service's index can be stale and the wiki owns the permission decision (spec section 7 item 4).
- 28.10.2026: the answer text streams before the final check, and if any cited page fails it, the whole answer is withdrawn and replaced by the no-source text, so no answer that fails the check is returned (spec section 7 item 4). Streaming is required by spec section 9; every section in the prompt passed the filter with the wiki's current data moments before (spec section 7 item 3), so the text shown during the stream comes only from pages the user could view when the question was sent. Sources appear only after the check, as the mockup's decision for A2 says.
- 28.10.2026: an answer without any valid citation is replaced by the no-source text, because spec section 9 requires a citation for each claim and the model cannot be trusted to refuse in the exact wording of A3. Whether every claim is grounded in its cited source is measured by the M10 evals (groundedness, citation accuracy), not by a criterion here.
- 28.10.2026: the no-source answer skips the model, because a question without a passing section has nothing to ground an answer on, and skipping the model makes the refusal identical for missing and restricted content.
- 28.10.2026: earlier answers whose prompt held a section of a page the user may no longer view are left out of the next prompt, because otherwise a revoked user would get content from it through the history (M6 revocation case), also when the answer did not cite that page. The user's own earlier questions stay.
- 28.10.2026: the search for a follow-up question uses the previous question too, because a follow-up like "Und für Hotelübernachtungen?" finds nothing on its own; the model sees the last 5 turns, because more turns crowd the sources out of a local model's context.
- 28.10.2026: at most 20 candidate sections are filtered and at most 8 passing sections reach the model, because 8 sections of up to 1,500 characters fit a local model's context with the history, and 20 candidates leave room for sections that fail the filter.
- 28.10.2026: a conversation is keyed by the user and a conversation id, so another user's id finds nothing instead of an error, because a different answer would reveal that the conversation exists.
- 28.10.2026: a conversation ends with "Neue Unterhaltung" or a reload, as spec section 9 says; closing the panel or moving to another page keeps it, which the mockup's note "Verlauf bleibt erhalten, solange das Panel offen ist" did not settle. An ended conversation is unreachable (the panel forgets its id) and the AI service drops it 24 h after its last question, the one deletion rule of spec section 9; deleting on "Neue Unterhaltung" would need a second endpoint and still miss reloads. This is how spec section 11's "until the panel session ends" is met.
- 28.10.2026: the AI service does not lock a conversation against two questions at once, because a conversation id lives only in one browser tab's memory and the panel sends one question at a time; a second concurrent request can come only from the same user and only interleaves that user's own history.
- 28.10.2026: a model failure and a filter failure show an inline message in the answer, not state A4, because the AI service is reachable and the conversation stays usable; A4 stays for an unreachable AI service. The mockup's A4 caption ("ai-service oder das Modell antwortet nicht") is corrected in the same PR (spec section 13).
- 28.10.2026: the button "Neue Unterhaltung" is not in the mockup, and the example questions differ from its placeholders; the mockup gets both in the same PR (spec section 13).
- 28.10.2026: the example questions are about the seed pages "Reisekosten Richtlinie 2026" and "Bürozeiten und Erreichbarkeit" in the open space Allgemein, replacing the mockup's placeholders, because the mockup says they come from the seed data, "Wie viele Urlaubstage habe ich?" has no seed page, an example must have a source for every seed user, and the kilometre rate is a deliberate contradiction between the 2022 and 2026 pages that a demo example should not hit.
- 28.10.2026: only `http` and `https` links in an answer are clickable, because a page or PDF can steer the model's output (spec section 12, indirect prompt injection) and a `javascript:` or `data:` link would run in the wiki's origin.
- 28.10.2026: the AI service answers `invalid_request` for any field the contract does not list, a user id included, because its request model rejects unknown fields; the bridge's own `user_id_not_allowed` stays for the bridge's endpoints.
- 28.10.2026: questions are limited to 2,000 characters, because a question longer than that is more likely pasted content than a question and would crowd the sources out of a local model's context.
- 28.10.2026: a model that sends no answer text within 60 s fails the answer, because a user waiting longer in a side panel has given up, and a cold model load on the M3 Pro takes about 13 s.
- 28.10.2026: the "Aufgabe" tab is not shown in M5, as in M3, because an input without the agent behind it would mislead.
- 28.10.2026: German answers come from the model's instructions; their language and correctness are measured by the M10 evals, not by a criterion here, because only the local model can produce them and a language check on its output would be a weak test.
- 29.10.2026: the stop button is an icon button with the accessible name "Stoppen", not a button with the visible word, because the send button next to the input is an icon button too and the user chose to keep the built icon after verify round 3; ASK-AC77 replaces ASK-AC10.
