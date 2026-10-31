# Contract extraction

ID prefix: EXTRACT

## Goal
An employee who may edit a page turns a contract PDF attached to it into a reviewed table of the contract's key data in that page. Every value the assistant fills in shows the sentence and PDF page it comes from (in the review at desktop width, and in the inserted table); a value whose sentence is not found in the PDF's text is marked as not found and left for the employee to fill in, never filled.

## User flow
Mockup: `docs/design/ai-assistant.html`, section "M7 Vertragsdaten extrahieren", states E1 to E4. The texts below are the German UI texts (UI language `de-DE`).

A PDF here is an attachment whose stored content type is `application/pdf`, the rule the bridge uses for PDF attachments.

1. A logged-in user opens a page with a PDF attachment, in an editor that lets them edit the page. When the user hovers over or selects the attachment, its toolbar shows an icon button "Daten extrahieren" next to "Als PDF einbetten" and the download button (state E1). An embedded PDF shows the same button in the menu that opens when it is selected. The button is shown only while the editor lets the user edit the page and the assistant status (BRIDGE user flow step 4) is `available`.
2. Clicking it opens the dialog "Daten extrahieren: <file name>". While the AI service works, the dialog shows "Lese <file name> …" and a button "Abbrechen", which closes the dialog and inserts nothing.
3. Behind the scenes the wiki checks that the user may edit the page and that the PDF is attached to it. The AI service fetches the PDF through the bridge, reads its text page by page and has the model fill the contract schema: for each field a short value and one sentence quoted from the PDF that states it. The AI service then looks for each quote in the PDF's text. A field whose quote is found keeps its value, the quote and the number of the first PDF page holding it; every other field is marked as not found and loses any value the model gave.
4. The dialog shows the review (state E2): the line "Schema: Vertrag" with "Fertig in <n> s" (n: the seconds from the click to the review, rounded up), then a table with the columns "Feld", "Wert" and "Quelle" and one row per field, in this order: "Vertragsparteien", "Laufzeit", "Kündigungsfrist", "Vertragswert", "Verlängerung".
   - A found field shows its value in a text input and, under "Quelle", the quote in „ “ and "Seite <n>".
   - A field not found shows an empty text input with the placeholder "Wert manuell eintragen", the badge "Nicht gefunden" and, under "Quelle", "Keine Fundstelle im Dokument."
   - Below the table: "1 Feld ohne Quelle" or "<k> Felder ohne Quelle" when k fields were not found, and the buttons "Abbrechen" and "Als Tabelle einfügen".
5. The user corrects or fills in values and clicks "Als Tabelle einfügen". The dialog closes and the page gets, directly below the attachment or embedded PDF the extraction started from, a heading "Vertragsdaten", the line "Aus <file name>, geprüft von <user's name> am <DD.MM.YYYY>." and a table with the header row "Feld", "Wert", "Quelle" and one row per field in the order of step 4: the field name, the value and the source (state E4). The date is today's date in the user's browser.
   - A value the user typed or changed is followed by " (manuell)".
   - A field whose input is empty reads "Nicht gefunden".
   - The source of a found field reads „<quote>“, Seite <n>, also when the user changed its value; the source of a field not found reads "Keine Fundstelle im Dokument."
   - The insertion is a normal edit of the page: everyone who has the page open sees it as they see any other edit, and it can be edited and undone like one.
6. Refusals and failures show their text in the dialog with a button "Schließen" and insert nothing (state E3):
   - PDF without text on any page: "Diese PDF enthält keinen Text (vermutlich eingescannt). Texterkennung ist in dieser Version nicht enthalten."
   - PDF with more than 10 pages: "Die Datei hat <n> Seiten. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text."
   - PDF larger than 10 MB: "Die Datei ist <x> MB groß. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text.", with x in MB of 1,048,576 bytes, rounded up to one decimal place, with a decimal comma.
   - PDF with more than 30,000 characters of text: "Die Datei enthält <c> Zeichen Text. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text.", with c written with a dot as thousands separator.
   - PDF that cannot be read: "Diese PDF kann nicht gelesen werden."
   - Model not answering, or not answering with the schema: "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal."
   - AI service unreachable: "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter."
   - The user may no longer edit the page, or the page or the PDF is gone: "Der Anhang ist nicht mehr verfügbar oder du darfst die Seite nicht bearbeiten."

### Schema "Vertrag"
| Field | Label | Holds |
|---|---|---|
| `parties` | Vertragsparteien | the contracting parties |
| `term` | Laufzeit | start, end or duration of the contract |
| `noticePeriod` | Kündigungsfrist | the notice period for termination |
| `value` | Vertragswert | the contract's total, yearly or unit price |
| `renewal` | Verlängerung | whether and how the contract is renewed |

### Sources
- A quote counts as found when, after Unicode NFC normalisation, removal of soft hyphens, replacement of every run of whitespace by one space and removal of leading and trailing whitespace, it has at least 15 characters and occurs in the text of one PDF page treated the same way.
- A quote that differs from the PDF's text in anything else, such as a word hyphenated at a line end, other quotation marks or text running across two PDF pages, is not found.
- A field counts as found only when its value and its quote are both non-empty and the quote is found. The PDF page number is the first page whose text holds the quote, counted from 1; a page number given by the model is not used.

### Limits
- A PDF is extracted only up to 10 pages, 10 MB (10,485,760 bytes) and 30,000 characters of text, counted after whitespace normalisation as in "Sources". The wiki passes the PDF's stored size to the AI service, which refuses a PDF larger than 10 MB before it requests the file from the bridge.
- The model must return its complete answer within 180 s, or the extraction fails as a model failure. The wiki waits up to 200 s for the AI service; when it gives up, the dialog shows the model failure text.
- The model needs a context of at least 16,384 tokens. When the model reports fewer prompt tokens than a quarter of the characters it was sent, its input was cut off: the extraction fails as a model failure with the outcome `context_too_small`.

### Model answer
- The model's answer matches the schema when it is a JSON object in which each of the five fields that is present is an object whose `value` and `quote` are each a string or null. Other keys are ignored; a field that is absent counts as not found. Any other answer is a model failure.

### Data
- The AI service keeps nothing of an extraction: no PDF text, value or quote outlives the request, in its database, its Redis, its files or its logs. The only copy of the result is the table in the page, which carries the page's permissions.

### Logging
Each extraction logs one line in the AI service with the attachment id, the inference mode, the model, the PDF's page count where it was read, the duration, the number of found fields and the outcome: `extracted`, `no_text_layer`, `too_many_pages`, `too_large`, `too_much_text`, `unreadable`, `model_failed` or `context_too_small`. Log lines never hold PDF text, values, quotes or tokens.

## Acceptance criteria

### Entry point
- **EXTRACT-AC1**: Given the status is `available` and a user who may edit the page with the editor in edit mode, when the user hovers over a PDF attachment, then its toolbar shows a button with the accessible name "Daten extrahieren".
- **EXTRACT-AC2**: Given the status is `available` and a user who may edit the page with the editor in edit mode, when the user selects an embedded PDF, then its menu shows a button with the accessible name "Daten extrahieren".
- **EXTRACT-AC3**: Given a user who may view but not edit the page, when the user hovers over a PDF attachment, then its toolbar shows no button "Daten extrahieren".
- **EXTRACT-AC4**: Given a user who may edit the page with the editor in read mode, when the user hovers over a PDF attachment, then its toolbar shows no button "Daten extrahieren".
- **EXTRACT-AC5**: Given the status is `unavailable` or `disabled`, when a user who may edit the page hovers over a PDF attachment, then its toolbar shows no button "Daten extrahieren".
- **EXTRACT-AC6**: Given an attachment whose content type is not `application/pdf`, also one whose file name ends in `.pdf`, when a user who may edit the page hovers over it, then its toolbar shows no button "Daten extrahieren".

### Extraction and review
- **EXTRACT-AC7**: Given an extraction has started and the AI service has not answered, when the dialog is shown, then it shows "Lese <file name> …" and a button "Abbrechen".
- **EXTRACT-AC8**: Given an extraction has started and the AI service has not answered, when the user clicks "Abbrechen", then the dialog closes and, after the AI service answers, the page content is unchanged.
- **EXTRACT-AC9**: Given the model returns all five fields with quotes that occur on the PDF's pages, when the review is shown, then it shows "Schema: Vertrag", the five rows "Vertragsparteien", "Laufzeit", "Kündigungsfrist", "Vertragswert", "Verlängerung" in this order, each with its value in a text input, its quote in „ “ and "Seite <n>", and no line "… ohne Quelle".
- **EXTRACT-AC10**: Given an extraction that took 17.2 s, when the review is shown, then it shows "Fertig in 18 s".
- **EXTRACT-AC11**: Given the model returns a quote that occurs only on PDF page 2 and names page 1, when the field is shown, then it shows "Seite 2".
- **EXTRACT-AC12**: Given a quote that occurs on PDF pages 1 and 2, when the field is shown, then it shows "Seite 1".
- **EXTRACT-AC13**: Given a quote that occurs on a PDF page only with a line break where the quote has a space, when the field is shown, then it is found and shows the quote.
- **EXTRACT-AC14**: Given the model returns a value for "Verlängerung" with a quote that occurs on no PDF page, when the review is shown, then "Verlängerung" has an empty input with the placeholder "Wert manuell eintragen", the badge "Nicht gefunden", "Keine Fundstelle im Dokument." and none of the model's value.
- **EXTRACT-AC15**: Given the model returns a value for a field and no quote or an empty quote, when the review is shown, then that field is shown as not found as in EXTRACT-AC14.
- **EXTRACT-AC16**: Given the model returns a quote for a field and no value or an empty value, when the review is shown, then that field is shown as not found as in EXTRACT-AC14.
- **EXTRACT-AC17**: Given the model returns for a field a quote of 14 characters after whitespace normalisation that occurs on a PDF page, when the review is shown, then that field is shown as not found.
- **EXTRACT-AC18**: Given one field is not found, when the review is shown, then it shows "1 Feld ohne Quelle".
- **EXTRACT-AC19**: Given three fields are not found, when the review is shown, then it shows "3 Felder ohne Quelle".
- **EXTRACT-AC20**: Given the review is shown, when the user clicks "Abbrechen", then the dialog closes and the page content is unchanged.
- **EXTRACT-AC69**: Given a viewport 412 px wide and a review in which "Vertragsparteien" is found with a quote of more than 100 characters and "Verlängerung" is not found, when the review is shown, then the input under "Wert" in each of the five rows is at least 140 px wide and ends inside the dialog's right edge.

### Insertion
- **EXTRACT-AC21**: Given the review of "Liefervertrag.pdf" by the user "Anna Weber" on 27.10.2026 with all values unchanged, when the user clicks "Als Tabelle einfügen", then the node directly after the attachment is a heading "Vertragsdaten", followed by a paragraph "Aus Liefervertrag.pdf, geprüft von Anna Weber am 27.10.2026." and a table with the header row "Feld", "Wert", "Quelle" and 5 rows that read the field names in the order of user flow step 4, their values and their sources.
- **EXTRACT-AC22**: Given an extraction started from an embedded PDF, when the user clicks "Als Tabelle einfügen", then the heading "Vertragsdaten" is the node directly after that embedded PDF.
- **EXTRACT-AC23**: Given "Vertragswert" was not found and the user typed "48.000 EUR", when the user clicks "Als Tabelle einfügen", then its row reads "Vertragswert" and "48.000 EUR (manuell)".
- **EXTRACT-AC24**: Given a found "Laufzeit" whose value the user changed, when the user clicks "Als Tabelle einfügen", then its value cell ends with " (manuell)".
- **EXTRACT-AC25**: Given a field whose input is empty or only whitespace, when the user clicks "Als Tabelle einfügen", then its value cell reads "Nicht gefunden".
- **EXTRACT-AC26**: Given a found field whose value the user did not change, when the user clicks "Als Tabelle einfügen", then its value cell holds the value without " (manuell)".
- **EXTRACT-AC27**: Given a second user has the same page open in another browser, when the first user clicks "Als Tabelle einfügen", then the second user's editor shows the heading "Vertragsdaten" and the table without reloading.
- **EXTRACT-AC28**: Given the review is shown, when the user clicks "Als Tabelle einfügen" twice in a row, then the page holds exactly one heading "Vertragsdaten" more than before.
- **EXTRACT-AC29**: Given the attachment the extraction started from was removed from the page while the review was shown, when the user clicks "Als Tabelle einfügen", then the heading "Vertragsdaten", the line and the table are the last nodes of the page.
- **EXTRACT-AC30**: Given the review is shown and the editor stops letting the user edit the page, when the user looks at the review, then "Als Tabelle einfügen" is disabled.
- **EXTRACT-AC31**: Given a table was inserted, when the user undoes the last edit, then the heading "Vertragsdaten", the line and the table are gone.

### Refusals and failures
- **EXTRACT-AC32**: Given the seed PDF without a text layer, when the user extracts it, then the dialog shows "Diese PDF enthält keinen Text (vermutlich eingescannt). Texterkennung ist in dieser Version nicht enthalten." and a button "Schließen", and the model is not called.
- **EXTRACT-AC33**: Given a PDF with 11 pages of text, when the user extracts it, then the dialog shows "Die Datei hat 11 Seiten. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text." and the model is not called.
- **EXTRACT-AC34**: Given a PDF with 10 pages of text, when the user extracts it, then the dialog shows the review.
- **EXTRACT-AC35**: Given a PDF of 12,163,481 bytes, when the user extracts it, then the dialog shows "Die Datei ist 11,6 MB groß. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text." and the AI service has not requested the file from the bridge.
- **EXTRACT-AC36**: Given a PDF of exactly 10,485,760 bytes with text, when the user extracts it, then the dialog does not show the size refusal of EXTRACT-AC35.
- **EXTRACT-AC37**: Given an attachment of type `application/pdf` whose file is not a valid PDF, when the user extracts it, then the dialog shows "Diese PDF kann nicht gelesen werden." and the model is not called.
- **EXTRACT-AC38**: Given the model's address refuses connections, when the user extracts a PDF, then the dialog shows "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal."
- **EXTRACT-AC39**: Given the model returns no complete answer within 180 s, when the user extracts a PDF, then the dialog shows the text of EXTRACT-AC38.
- **EXTRACT-AC40**: Given the model returns text that is not a JSON object, or a field whose `value` is a number, when the user extracts a PDF, then the dialog shows the text of EXTRACT-AC38.
- **EXTRACT-AC41**: Given the AI service refuses connections, when the user extracts a PDF, then the dialog shows "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter."
- **EXTRACT-AC42**: Given the user lost the right to edit the page after the button was shown, when the user clicks "Daten extrahieren", then the dialog shows "Der Anhang ist nicht mehr verfügbar oder du darfst die Seite nicht bearbeiten."
- **EXTRACT-AC43**: Given any refusal or failure of EXTRACT-AC32 to EXTRACT-AC42, when the user clicks "Schließen", then the dialog closes and the page content is unchanged.

### Permissions and requests
- **EXTRACT-AC44**: Given an extraction request for a page the user may view but not edit, when it reaches the wiki, then the wiki answers with status 403 and error code `page_not_editable` and the AI service is not called.
- **EXTRACT-AC45**: Given an extraction request for a page the user may not view, a page in the trash or a page id that does not exist, when it reaches the wiki, then the wiki answers with status 404 and error code `page_not_found` for each.
- **EXTRACT-AC46**: Given an extraction request for an attachment that does not exist, is attached to another page or has a content type other than `application/pdf`, when it reaches the wiki, then the wiki answers with status 404 and error code `attachment_not_found` for each and the AI service is not called.
- **EXTRACT-AC47**: Given an extraction request with a missing or malformed page id or attachment id, when it reaches the wiki, then the wiki answers with status 400 and error code `invalid_request`.
- **EXTRACT-AC48**: Given no login session, when an extraction request reaches the wiki, then the wiki answers with status 401.
- **EXTRACT-AC49**: Given the assistant is switched off, when an extraction request reaches the wiki, then the wiki answers with status 503 and error code `assistant_disabled`.
- **EXTRACT-AC50**: Given a request to the AI service's extraction endpoint without a service token, with a wrong one, without a user token or with an expired one, when it reaches the AI service, then it answers with status 401 and the error code `service_token_missing`, `service_token_invalid`, `user_token_missing` or `user_token_expired` respectively.
- **EXTRACT-AC61**: Given a request to the AI service's extraction endpoint with a user token that is malformed, has an audience other than `ai-service`, uses the algorithm `none` or is signed with another secret, when it reaches the AI service, then it answers with status 401 and error code `user_token_invalid` for each.
- **EXTRACT-AC51**: Given a request to the AI service's extraction endpoint with a field the contract does not list, such as a user id, when it reaches the AI service, then it answers with status 400 and error code `invalid_request`.

### Data and logging
- **EXTRACT-AC52**: Given an extraction that ended with `extracted`, when the AI service's database, its Redis and its log lines are searched for the values and quotes of the result, then none of them is found.
- **EXTRACT-AC53**: Given an extraction for each outcome `extracted`, `no_text_layer`, `too_many_pages`, `too_large`, `too_much_text`, `unreadable`, `model_failed` and `context_too_small`, when the AI service's log line for it is read, then it holds the attachment id, the mode, the model, the duration, the number of found fields, that outcome and, where the PDF was read, its page count.
- **EXTRACT-AC54**: Given any extraction, when the AI service's log lines for it are read, then they hold no PDF text, value, quote or token.

### Local model and seed contracts
- **EXTRACT-AC55**: Given the local model and the seed contract "Kundenvertrag Stadtwerke Beispielstadt", when it is extracted, then "Vertragswert" is found and its value contains "1.200.000,00".
- **EXTRACT-AC56**: Given the local model and the seed contract "Subunternehmervertrag Tiefbau", when it is extracted, then "Verlängerung" is not found.
- **EXTRACT-AC57**: Given the full stack runs locally on the M3 Pro with the local model already loaded, when each of the 6 seed contracts with a text layer is extracted, then the dialog shows the review at most 40 s after the click for each.

## Edge cases
- **EXTRACT-AC58**: Given a PDF with text on page 1 and no text on page 2, when the user extracts it, then the dialog shows the review and no field shows "Seite 2".
- **EXTRACT-AC59**: Given the model returns a field the schema does not list in addition to the five, when the review is shown, then it shows only the five rows of the schema.
- **EXTRACT-AC62**: Given the model returns four fields without "Verlängerung", when the review is shown, then "Verlängerung" is shown as not found.
- **EXTRACT-AC63**: Given a quote in NFD form whose text occurs on a PDF page in NFC form, when the review is shown, then the field is found.
- **EXTRACT-AC64**: Given a PDF of 10 pages with 30,001 characters of text, when the user extracts it, then the dialog shows "Die Datei enthält 30.001 Zeichen Text. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text." and the model is not called.
- **EXTRACT-AC65**: Given a PDF of 10,485,761 bytes, when the user extracts it, then the dialog shows "Die Datei ist 10,1 MB groß. Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text."
- **EXTRACT-AC66**: Given the model reports 2,050 prompt tokens for a prompt of 14,654 characters, when the extraction ends, then the dialog shows the text of EXTRACT-AC38 and the log line holds the outcome `context_too_small`.
- **EXTRACT-AC67**: Given the AI service answers after more than 200 s, when the user has started an extraction, then the dialog shows the text of EXTRACT-AC38.
- **EXTRACT-AC68**: Given the local model with a context of 16,384 tokens and a PDF of 10 pages made of 5 seed contracts with "Kundenvertrag Stadtwerke Beispielstadt" first, when it is extracted, then the review shows "Vertragsparteien" found with a value naming "Stadtwerke Beispielstadt" within 180 s.
- **EXTRACT-AC60**: Given the review shows a value that contains `<b>fett</b>`, `**fett**` and `[x](javascript:alert(1))`, when the user clicks "Als Tabelle einfügen", then the value cell holds that text literally, with no bold text and no link.

## Out of scope
- Schemas other than "Vertrag", such as meeting minutes (Should), and choosing a schema in the dialog.
- OCR, and attachments other than PDF.
- Storing extracted data in the AI service, lists or searches over extracted data, and agent tools that read it (Should scenario "Which contracts end in the next 90 days?").
- Updating a table inserted earlier; a second extraction inserts a second table.
- The request log with tokens and cost (M9); M7 logs one line per extraction in the AI service.
- Field-level accuracy over all seed contracts against the ground truth (M10 extraction suite).
- Progress per PDF page while the AI service works.
- Extraction from the assistant panel.
- A review dialog laid out for phone widths beyond EXTRACT-AC69: at a viewport 412 px wide the column "Quelle" runs past the dialog's right edge and cannot be read.
- An inserted table laid out for phone widths: at a viewport 412 px wide the column "Quelle" is visible only after scrolling the table sideways.

## Open questions

## Decisions
- 29.10.2026: the limits are 10 pages, 10 MB and 30,000 characters of text, replacing the mockup's placeholders of 30 pages and 10 MB, because a seed contract of 2 pages (about 3,000 characters) took 16 to 20 s on the M3 Pro with `qwen3:8b`, and 10 pages of 5 seed contracts (14,654 characters, 4,814 prompt tokens) took 33 s with a 16,384-token context. 30,000 characters are about 10,000 tokens at the measured 3 characters per token and leave room for the instructions and the answer in that context. 10 MB is far above any text PDF of 10 pages. The seed PDFs have at most 2 pages and 1 MB.
- 29.10.2026: with Ollama's default context of 4,096 tokens the same 10-page prompt was cut to 2,050 prompt tokens without an error, and the model extracted the wrong contract. The OpenAI-compatible endpoint ignores a per-request context size, so the context is set on the model runtime (a human step in the runbook), and the AI service turns a cut-off input into a model failure (`context_too_small`) instead of a wrong result: fewer prompt tokens than a quarter of the characters sent cannot be the whole input at the measured 3 characters per token.
- 29.10.2026: the ceiling for an extraction (EXTRACT-AC57) is 40 s with the model already loaded, from a first measurement on the M3 Pro: 7 runs over the 6 two-page seed contracts with a text layer with `qwen3:8b`, structured output and temperature 0 took 16.0 to 19.8 s each. The request log entry for the duration comes with M9.
- 29.10.2026: the AI service finds each quote in the PDF's text itself and takes the page number from where it is found, because the model cannot be trusted to quote verbatim or count pages, and spec section 9 requires that a field without a source is flagged, never filled. In the first measurement every quote of the 6 text contracts was found verbatim after whitespace normalisation.
- 29.10.2026: a quote needs at least 15 characters to count, because a fragment like "GmbH" occurs in every contract and proves nothing.
- 29.10.2026: the model is told to leave a field empty when the contract states no explicit rule for it. Without that instruction, the first measurement filled "Verlängerung" of the contract without a renewal clause with "nicht vorgesehen" and a real sentence about termination as its quote; with it, the field came back empty. Whether a found value matches its quote is checked by the user in the review and measured by the M10 extraction suite, not by the AI service.
- 29.10.2026: the AI service keeps no extracted data, because the reviewed table in the page is the result, it carries the page's permissions (spec section 7 item 5) and goes when the page goes (item 7); storing extractions is only needed for lists and agent tools over them, which are Should items.
- 29.10.2026: the table is inserted by the user's own editor as a normal collaborative edit, directly below the attachment, because that is Docmost's normal update path for a page being edited: other editors see it like any other edit, undo works, and the collaboration server checks the user's edit right. The wiki's server-side content update can only append, prepend or replace a whole page, not insert below a given attachment, so the child-page fallback of spec section 9 is not needed.
- 29.10.2026: a value the user typed or changed is marked " (manuell)" as text in the cell, because a Docmost table cell holds text, not the mockup's badge; an empty field reads "Nicht gefunden" so the table shows that it was checked. Values are inserted as plain text, never parsed as Markdown or HTML, because a PDF can steer the model's output (spec section 12).
- 29.10.2026: Unicode normalisation and soft hyphens are handled when quotes are looked up, because the model and the PDF's text layer may encode umlauts differently; hyphenation at line ends and quotes across pages are not, because rejoining words could match text the PDF does not hold, and a missed quote only flags the field for the user.
- 29.10.2026: the wiki answers 403 `page_not_editable` for a page the user may view but not edit, and 404 for a page the user may not view, because a viewer already knows the page exists, while a 403 for a hidden page would reveal it. Missing pages and missing PDFs share one dialog text so the dialog never says which of them applied.
- 29.10.2026: the button is shown only when the status is `available`, because a button that can only fail is noise; the dialog still shows the unavailable text when the AI service goes down after the button was shown.
- 29.10.2026: the dialog shows "Lese <file name> …" instead of the mockup's "Lese Seite 3 von 6 …" and the fixed line "Schema: Vertrag" instead of a schema selector, because the AI service answers in one response, per-page progress would need a stream for a wait of about 20 s, and there is only one schema.
- 29.10.2026: "Abbrechen" while the AI service works only closes the dialog and discards the result; the AI service finishes or times out on its own, because nothing is stored or written and an extraction ends within 180 s.
- 29.10.2026: EXTRACT-AC55 to EXTRACT-AC57 and EXTRACT-AC68 run locally only with the local model, because CI has none (spec section 10); the other criteria run in CI with a stub model. Every quote of the seed ground truth is on PDF page 1, so EXTRACT-AC11, EXTRACT-AC12, EXTRACT-AC58 and the limit cases use PDFs generated by their tests.
- 29.10.2026: the inserted table keeps each field's source as a third column, unlike the mockup's E4, because the table is the only copy of the result and spec section 9 requires a source quote and page number per field; without it nobody can check a value after the dialog is closed.
- 29.10.2026: extractions are not limited per user, because the local model runtime queues requests and per-user limits belong to the rate limits deferred to the hosted demo (spec section 12); EXTRACT-AC57 is measured with one extraction at a time.
- 29.10.2026: the mockup changes in the same PR (spec section 13): E2 shows "Lese <file name> …", the fixed "Schema: Vertrag" and "Keine Fundstelle im Dokument."; E3 shows the new limits and the text refusal; E4 gets the header row and the column "Quelle" and "(manuell)" as text; the open question on the limits in `docs/design/README.md` is closed.
- 29.10.2026: the review criteria (EXTRACT-AC9 to EXTRACT-AC20) are checked at desktop width; EXTRACT-AC69 covers a viewport 412 px wide. At a viewport 412 px wide the review dialog shows "Feld", "Wert", the badge "Nicht gefunden" and the buttons, but the column "Quelle" runs past its right edge and cannot be read. v1 accepts this, because the review is a desktop task and the inserted table keeps every source; the user decided it after verify round 2.
- 29.10.2026: verify round 3 showed the input under "Wert" shrunk to about one character next to a long quote at a viewport 412 px wide. The input keeps a minimum width (EXTRACT-AC69), so a value fits beside the field name; only the column "Quelle" runs past the dialog's right edge, as decided after verify round 2. The user decided it after verify round 3.
- 29.10.2026: the inserted table is Docmost's own table, which is wider than a viewport 412 px wide and scrolls sideways, so at that width the column "Quelle" is visible only after the reader scrolls the table. M7 keeps that unchanged upstream behaviour, because the table must stay a normal Docmost table that every editor can change; every source stays readable there, which the verify round 2 decision relies on. The user decided it after verify round 3.
