# Edge cases

Local-only rows (n/a) ran with qwen3:8b on this Mac through scripts/run-extraction-check.sh (5 passed, task 8b); browser rows ran in apps/client/e2e/extraction.screenshots.ts (14 passed at 2b1916df (after pnpm seed)).

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| EXTRACT-AC1 | happy path | available, editable, application/pdf | button Daten extrahieren | EXTRACT-AC1: hovering a PDF attachment shows the button in its toolbar | |
| EXTRACT-AC1 | status and editable | available + editable | button shown | EXTRACT-AC1: shows the button when the assistant is available and the editor is editable | |
| EXTRACT-AC1 | click | click the button | dialog titled with file name | EXTRACT-AC1: a click opens the dialog titled with the file name | |
| EXTRACT-AC1 | browser | seed contract page as GF | button visible on hover | n/a: Playwright, apps/client/e2e/extraction.screenshots.ts `EXTRACT-AC1: E1 offers Daten extrahieren on the PDF attachment`, 14 passed at 2b1916df (after pnpm seed), screenshots in the pack | |
| EXTRACT-AC2 | selected embedded PDF | pdf node | button in its menu | EXTRACT-AC2: a selected embedded PDF shows the button in its menu next to its other actions | |
| EXTRACT-AC2 | status unavailable | pdf node, unavailable | no button | EXTRACT-AC2: the embedded PDF shows no button while the assistant is unavailable | |
| EXTRACT-AC2 | keyboard selection | selected by keyboard, no hover | menu opacity 1 | n/a: Playwright `EXTRACT-AC2: the selected embedded PDF shows Daten extrahieren without hover`, 14 passed at 2b1916df (after pnpm seed) | |
| EXTRACT-AC3 | missing permission | viewer, editor not editable | no button | EXTRACT-AC3: shows no button for a viewer whose editor is not editable | |
| EXTRACT-AC4 | read mode | setEditable(false) at runtime | button disappears | EXTRACT-AC4: the button disappears when the page switches to read mode | |
| EXTRACT-AC5 | unavailable / disabled | status unavailable or disabled | no button | EXTRACT-AC5: shows no button while the assistant is un | |
| EXTRACT-AC5 | disabled | status disabled | no button | EXTRACT-AC5: shows no button while the assistant is di | |
| EXTRACT-AC5 | loading | status pending | no button | EXTRACT-AC5: shows no button while the status is still loading | |
| EXTRACT-AC6 | wrong type | text/plain named x.pdf | no button | EXTRACT-AC6: a text/plain attachment named x.pdf offers no button | |
| EXTRACT-AC7 | loading | request pending | Lese <file> … and Abbrechen | EXTRACT-AC7: shows the title, the reading text and Abbrechen while the service works | |
| EXTRACT-AC7 | replaced request | second file while open | new file's extraction | EXTRACT-AC7: replacing the request while the review is open shows the new file's extraction | |
| EXTRACT-AC8 | cancel | Abbrechen while loading | closed, late answer ignored | EXTRACT-AC8: Abbrechen aborts the request, closes and ignores a late answer | |
| EXTRACT-AC8 | abort rejection | aborted fetch rejects | no error shown | EXTRACT-AC8: an aborted request that rejects shows no error | |
| EXTRACT-AC8 | service abort | signal aborted | abort rethrown | EXTRACT-AC8: rethrows the abort instead of mapping it | |
| EXTRACT-AC9 | happy path | 5 found fields | rows in order, quotes, Seite n | EXTRACT-AC9: lists the five fields in order with value, quote and page, and no missing-source line | |
| EXTRACT-AC9 | service | extracted body | parsed result | EXTRACT-AC9: posts page and attachment id with the signal and parses an extracted result | |
| EXTRACT-AC10 | rounding | 17.2 s | Fertig in 18 s | EXTRACT-AC10: rounds the seconds from the start to the answer up (17.2 s gives 18) | |
| EXTRACT-AC11 | page from text | quote only on page 2, model says 1 | Seite 2 | test_extract_ac11_page_number_comes_from_where_the_quote_is_found | |
| EXTRACT-AC12 | duplicate quote | quote on pages 1 and 2 | Seite 1 | test_extract_ac12_quote_on_two_pages_gets_the_first_page | |
| EXTRACT-AC13 | line break | PDF line break vs space | found | test_extract_ac13_line_break_in_the_pdf_matches_a_space_in_the_quote | |
| EXTRACT-AC14 | quote nowhere | value + unknown quote | not found, value dropped | test_extract_ac14_quote_found_nowhere_drops_the_value | |
| EXTRACT-AC14 | dialog | not-found field | placeholder, badge, no-source text | EXTRACT-AC14: a field not found shows an empty input with placeholder, badge and no-source text | |
| EXTRACT-AC15 | empty data | empty/whitespace/null quote | not found | test_extract_ac15_empty_or_missing_quote_is_not_found | |
| EXTRACT-AC15 | absent key | no quote key | not found | test_extract_ac15_absent_quote_key_is_not_found | |
| EXTRACT-AC16 | empty data | empty/null value | not found | test_extract_ac16_empty_or_missing_value_is_not_found | |
| EXTRACT-AC17 | limit | 14 vs 15 characters | not found / found | test_extract_ac17_quote_of_14_characters_is_not_found_and_15_is_found | |
| EXTRACT-AC17 | normalisation | length after whitespace collapse | counted normalised | test_extract_ac17_length_counts_after_whitespace_normalisation | |
| EXTRACT-AC18 | one missing | 1 field | 1 Feld ohne Quelle | EXTRACT-AC18: one field without source reads '1 Feld ohne Quelle' | |
| EXTRACT-AC19 | three missing | 3 fields | 3 Felder ohne Quelle | EXTRACT-AC19: three fields without source read '3 Felder ohne Quelle' | |
| EXTRACT-AC20 | cancel review | Abbrechen in review | closed, nothing inserted | EXTRACT-AC20: Abbrechen in the review closes and does not insert | |
| EXTRACT-AC69 | limits: minimum width | review with five Wert inputs | each input has a min-width of at least 140 px | EXTRACT-AC69: every Wert input keeps a minimum width of 140 px | |
| EXTRACT-AC69 | limits: phone width | 412 px viewport (Pixel 7), "Vertragsparteien" quote of 138 characters, "Verlängerung" not found | each of the five inputs ≥ 140 px wide and ends inside the dialog | n/a: Playwright `EXTRACT-AC69: every Wert input stays readable beside long quotes` (project mobile), 14 passed at 2b1916df (after pnpm seed); red before the fix: 111.5 px | |
| EXTRACT-AC69 | desktop unchanged | 1280 px viewport, same review | same checks pass, no layout change | n/a: same Playwright test, project desktop, 14 passed at 2b1916df | |
| EXTRACT-AC21 | table content | 5 fields | heading, line, table with header row | EXTRACT-AC21: builds heading, line and table with exact texts | |
| EXTRACT-AC21 | position | after attachment | directly after it | EXTRACT-AC21: inserts heading, line and table directly after the attachment | |
| EXTRACT-AC21 | reviewer and date | current user, fake date | Aus …, geprüft von … am DD.MM.YYYY. | EXTRACT-AC21: inserting writes the reviewer name and today's date directly after the attachment and closes the dialog | |
| EXTRACT-AC21 | pointer leaves | hover lost during review | dialog stays | EXTRACT-AC21: the review stays open when the pointer leaves the attachment | |
| EXTRACT-AC21 | page change | host unmounted with review open | request cleared and aborted | EXTRACT-AC21: unmounting the host with a review open clears the request and aborts it | |
| EXTRACT-AC22 | embedded PDF | pdf node | table after it | EXTRACT-AC22: inserting from the embedded PDF's menu puts the table directly after it | |
| EXTRACT-AC22 | builder | pdf node | inserted after | EXTRACT-AC22: inserts after a pdf node | |
| EXTRACT-AC23 | manual value | 48.000 EUR typed | 48.000 EUR (manuell) | EXTRACT-AC23: typed value for a missing field gets the manual marker | |
| EXTRACT-AC24 | changed value | found value edited | (manuell), source kept | EXTRACT-AC24: changed found value gets the marker and keeps the source | |
| EXTRACT-AC25 | empty data | empty or whitespace | Nicht gefunden | EXTRACT-AC25: empty or whitespace value reads Nicht gefunden | |
| EXTRACT-AC26 | unchanged | value untouched | no marker | EXTRACT-AC26: unchanged values carry no marker | |
| EXTRACT-AC26 | whitespace | value with surrounding spaces | no marker | EXTRACT-AC26: an unchanged extracted value with surrounding whitespace carries no marker | |
| EXTRACT-AC27 | concurrent edits | second browser on the page | table without reload | n/a: Playwright `EXTRACT-AC21, EXTRACT-AC27: E4 inserts the table and a second browser sees it without reload`, 14 passed at 2b1916df (after pnpm seed) | |
| EXTRACT-AC28 | double submit | two clicks | one insertion | EXTRACT-AC28: a double click on Als Tabelle einfügen inserts once, with the edited values | |
| EXTRACT-AC29 | concurrent removal | attachment removed during review | appended at end | EXTRACT-AC29: with the attachment removed during the review, inserting appends the table at the end of the page | |
| EXTRACT-AC29 | builder | attachment gone | last nodes | EXTRACT-AC29: appends at the end when the attachment is gone | |
| EXTRACT-AC30 | permission lost | editor not editable | insert disabled | EXTRACT-AC30: Als Tabelle einfügen is disabled when the editor is not editable | |
| EXTRACT-AC30 | runtime change | setEditable(false) during review | dialog stays, insert disabled | EXTRACT-AC30: the review stays with Als Tabelle einfügen disabled when the editor stops being editable | |
| EXTRACT-AC31 | undo | one undo | all three nodes gone | EXTRACT-AC31: one undo removes heading, line and table | |
| EXTRACT-AC32 | no text layer | blank PDF | refused, model not called | test_extract_ac32_pdf_without_text_is_refused_and_the_model_is_not_called | |
| EXTRACT-AC32 | whitespace pages | whitespace-only text | no text layer | test_extract_ac32_pages_of_whitespace_only_count_as_no_text | |
| EXTRACT-AC32 | dialog | no_text_layer | scan text and Schließen | EXTRACT-AC32, EXTRACT-AC43: shows the text | |
| EXTRACT-AC33 | limit | 11 pages | refused with 11 | test_extract_ac33_eleven_pages_are_refused_with_the_count | |
| EXTRACT-AC33 | limit | 301 pages | too_many_pages, not unreadable | test_extract_ac33_pdf_beyond_the_indexing_page_limit_is_refused_with_its_count | |
| EXTRACT-AC33 | dialog | too_many_pages 11 | Die Datei hat 11 Seiten … | EXTRACT-AC33, EXTRACT-AC43: shows the text | |
| EXTRACT-AC34 | limit | 10 pages | review | test_extract_ac34_ten_pages_are_extracted | |
| EXTRACT-AC35 | limit | 12,163,481 bytes | refused before fetch | test_extract_ac35_ac65_oversize_file_is_refused_before_the_file_is_requested | |
| EXTRACT-AC35 | endpoint | too large via /v1/extract | no fetch | test_extract_ac35_a_too_large_file_is_refused_without_a_fetch | |
| EXTRACT-AC35 | dialog | fileSize 12,163,481 | 11,6 MB | EXTRACT-AC35, EXTRACT-AC43: shows the text | |
| EXTRACT-AC36 | limit | exactly 10,485,760 bytes | fetched | test_extract_ac36_file_of_exactly_10_mb_is_fetched | |
| EXTRACT-AC37 | invalid input | bytes that are no PDF | unreadable | test_extract_ac37_bytes_that_are_no_pdf_are_unreadable | |
| EXTRACT-AC37 | dialog | unreadable | Diese PDF kann nicht gelesen werden. | EXTRACT-AC37, EXTRACT-AC43: shows the text | |
| EXTRACT-AC38 | external call error | connection refused | ModelUnavailable | test_extract_ac38_connection_refused_raises_model_unavailable | |
| EXTRACT-AC38 | external call error | HTTP 500 | ModelUnavailable | test_extract_ac38_server_error_raises_model_unavailable | |
| EXTRACT-AC38 | pipeline | ModelUnavailable | failed result | test_extract_ac38_model_unavailable_is_a_failed_result | |
| EXTRACT-AC38 | dialog | failed | model text | EXTRACT-AC38, EXTRACT-AC43: shows the text | |
| EXTRACT-AC39 | timeout | read timeout | ModelUnavailable | test_extract_ac39_read_timeout_raises_model_unavailable | |
| EXTRACT-AC39 | timeout | answer after deadline | ModelUnavailable | test_extract_ac39_answer_arriving_after_the_deadline_raises_model_unavailable | |
| EXTRACT-AC39 | limit | answer within deadline | returned | test_extract_ac39_answer_within_the_deadline_is_returned | |
| EXTRACT-AC40 | invalid model output | non-object, number value, no JSON | model failure | test_extract_ac40_answer_outside_the_schema_is_a_model_failure | |
| EXTRACT-AC40 | invalid field | present field not an object | model failure | test_extract_ac40_field_that_is_present_but_not_an_object_is_a_model_failure | |
| EXTRACT-AC40 | envelope | missing choices/content | ModelUnavailable | test_extract_ac40_malformed_envelope_raises_model_unavailable | |
| EXTRACT-AC40 | client | malformed body | model error | EXTRACT-AC40: rejects four fields as a model error | |
| EXTRACT-AC41 | external call error | AI service refuses connection | 503 assistant_unavailable | EXTRACT-AC41: a refused connection answers 503 assistant_unavailable | |
| EXTRACT-AC41 | client | network error | unreachable text | EXTRACT-AC41: maps a network error without response to unreachable | |
| EXTRACT-AC41 | dialog | unreachable | unreachable text | EXTRACT-AC41, EXTRACT-AC43: shows the text | |
| EXTRACT-AC42 | permission lost | edit right removed | 403 page_not_editable | EXTRACT-AC42: a user who lost the edit right after the button was shown gets 403 page_not_editable | |
| EXTRACT-AC42 | client | 403 | not_available | EXTRACT-AC42: maps HTTP 403 page_not_editable to not_available | |
| EXTRACT-AC42 | dialog | not_available | Der Anhang ist nicht mehr verfügbar … | EXTRACT-AC42, EXTRACT-AC43: shows the text | |
| EXTRACT-AC43 | close | Schließen on every refusal | closed, no insert | EXTRACT-AC43: shows the text and only Schließen, which closes without inserting | |
| EXTRACT-AC44 | missing permission | viewer, not editor | 403, AI service not called | EXTRACT-AC44: a page the user may view but not edit answers 403 page_not_editable and calls nothing | |
| EXTRACT-AC44 | error path | edit check error that is not a denial | rethrown | EXTRACT-AC44: an error of the edit check that is not a denial is not turned into 403 | |
| EXTRACT-AC45 | missing permission | page not viewable | 404 page_not_found | EXTRACT-AC45: a page the user may not view answers 404 page_not_found and calls nothing | |
| EXTRACT-AC45 | trash | page in trash | 404 page_not_found | EXTRACT-AC45: a page in the trash answers 404 page_not_found and calls nothing | |
| EXTRACT-AC45 | unknown | page id that does not exist | 404 page_not_found | EXTRACT-AC45: a page id that does not exist answers 404 page_not_found and calls nothing | |
| EXTRACT-AC46 | unknown | attachment does not exist | 404 attachment_not_found | EXTRACT-AC46: an attachment that does not exist answers 404 attachment_not_found and calls nothing | |
| EXTRACT-AC46 | other page | attachment of another page | 404, not called | EXTRACT-AC46: an attachment of another page answers 404 attachment_not_found and calls nothing | |
| EXTRACT-AC46 | wrong type | image/png | 404, not called | EXTRACT-AC46: an attachment of type image/png answers 404 attachment_not_found and calls nothing | |
| EXTRACT-AC47 | invalid input | malformed page id | 400 invalid_request | EXTRACT-AC47: rejects a malformed page id | |
| EXTRACT-AC47 | invalid input | missing attachment id | 400 invalid_request | EXTRACT-AC47: rejects a missing attachment id | |
| EXTRACT-AC48 | no session | no cookie | 401 | n/a: server e2e apps/server/test/ai-bridge.e2e-spec.ts `EXTRACT-AC48: an extraction without a session answers 401 and calls nothing`, 92 passed (data run) | |
| EXTRACT-AC49 | switched off | bridge not configured | 503 assistant_disabled | EXTRACT-AC49: a switched-off assistant answers 503 assistant_disabled and calls nothing | |
| EXTRACT-AC50 | missing token | no/wrong service token | 401 codes | test_extract_ac50_a_missing_or_wrong_service_token_is_401 | |
| EXTRACT-AC50 | missing user token | no user token | 401 user_token_missing | test_extract_ac50_a_missing_user_token_is_401 | |
| EXTRACT-AC50 | expired | expired user token | 401 user_token_expired | test_extract_ac50_an_expired_user_token_is_401 | |
| EXTRACT-AC51 | invalid input | userId field, bad sizes, bad uuid | 400 invalid_request | test_extract_ac51_an_invalid_body_is_400_invalid_request | |
| EXTRACT-AC51 | limit | fileSize 0 | accepted | test_extract_ac51_a_zero_file_size_is_accepted | |
| EXTRACT-AC52 | nothing stored | extraction through the app | no Redis key, nothing logged | test_extract_ac52_nothing_is_stored_and_values_are_not_logged | |
| EXTRACT-AC52 | stack | real stack, ai schema and Redis | no value or quote | n/a: local stack test ai-service/tests/test_stack_extract.py `test_extract_ac52_no_value_or_quote_is_left_in_the_ai_database_or_redis`, 5 passed (task 8b) | |
| EXTRACT-AC53 | each outcome | 8 outcomes | one line with fields | test_extract_ac53_one_log_line_per_outcome | |
| EXTRACT-AC53 | bridge error | AttachmentNotFound | no extraction line | test_extract_ac53_a_bridge_error_propagates_without_an_extraction_log_line | |
| EXTRACT-AC53 | unexpected error | RuntimeError | warning with class only | test_extract_ac53_an_unexpected_error_logs_its_class_without_content_and_propagates | |
| EXTRACT-AC54 | no content | extraction logs | no text, value, quote | test_extract_ac54_log_lines_hold_no_pdf_text_value_or_quote | |
| EXTRACT-AC54 | bridge error | endpoint warning | no content | test_extract_ac54_a_bridge_error_logs_one_warning_without_content | |
| EXTRACT-AC55 | local model | Kundenvertrag Stadtwerke | value 1.200.000,00 | n/a: local model only, test_stack_extract.py `test_extract_ac55_the_customer_contract_value_is_found_with_the_local_model`, passed with qwen3:8b | |
| EXTRACT-AC56 | local model | Subunternehmervertrag Tiefbau | renewal not found | n/a: local model only, `test_extract_ac56_the_subcontractor_contract_renewal_is_not_found`, passed with qwen3:8b | |
| EXTRACT-AC57 | limit | 6 seed contracts on the M3 Pro | ≤ 40 s each | n/a: local model only, `test_extract_ac57_each_text_contract_is_extracted_through_the_wiki_in_40_seconds`, 18.0–27.7 s | |
| EXTRACT-AC58 | empty page | text only on page 1 | no Seite 2 | test_extract_ac58_text_only_on_page_one_gives_no_field_on_page_two | |
| EXTRACT-AC59 | extra keys | sixth field | ignored | test_extract_ac59_extra_keys_are_ignored | |
| EXTRACT-AC60 | injection | HTML, Markdown, javascript link | literal text | EXTRACT-AC60: markup in values stays literal text without marks | |
| EXTRACT-AC61 | invalid token | alg none, other secret, wrong aud | 401 user_token_invalid | test_extract_ac61_an_invalid_user_token_is_user_token_invalid | |
| EXTRACT-AC61 | malformed token | garbage token | 401 user_token_invalid | test_extract_ac61_a_malformed_user_token_is_user_token_invalid | |
| EXTRACT-AC62 | missing field | four fields | renewal not found | test_extract_ac62_missing_field_is_not_found | |
| EXTRACT-AC63 | unicode | NFD quote vs NFC page | found | test_extract_ac63_nfd_quote_matches_nfc_page | |
| EXTRACT-AC63 | soft hyphen | U+00AD in page | found | test_extract_ac63_soft_hyphens_are_removed_before_matching | |
| EXTRACT-AC64 | limit | 30,001 vs 30,000 characters | refused / extracted | test_extract_ac64_30001_characters_are_refused_and_30000_are_extracted | |
| EXTRACT-AC64 | dialog | 30,001 | 30.001 Zeichen | EXTRACT-AC64: 30,001 characters get a dot as thousands separator | |
| EXTRACT-AC65 | limit | 10,485,761 bytes | refused | test_extract_ac35_ac65_oversize_file_is_refused_before_the_file_is_requested[10485761] | |
| EXTRACT-AC65 | dialog | 10,485,761 bytes | 10,1 MB | EXTRACT-AC65: a file of exactly 10 MB plus one byte rounds up to 10,1 MB, not 10,0 MB | |
| EXTRACT-AC66 | cut-off input | prompt tokens below a quarter | context_too_small | test_extract_ac66_prompt_tokens_below_a_quarter_of_the_characters_fail | |
| EXTRACT-AC66 | boundary | exactly a quarter | passes | test_extract_ac66_prompt_tokens_at_a_quarter_of_the_characters_pass | |
| EXTRACT-AC66 | no usage | usage missing | None, no guard | test_extract_ac66_missing_or_non_integer_prompt_tokens_are_none | |
| EXTRACT-AC67 | timeout | AI service slower than 200 s | model failure result | EXTRACT-AC67: an AI service slower than 200 s gives the model failure result | |
| EXTRACT-AC67 | boundary | 199,999 ms | not yet timed out | EXTRACT-AC67: an AI service that has not answered after 200 s times out, not earlier | |
| EXTRACT-AC68 | local model | 10-page PDF, 16,384 context | parties found ≤ 180 s | n/a: local model only, `test_extract_ac68_a_ten_page_pdf_of_five_contracts_names_the_customer_as_party`, 19.4 s; at 4,096 context it fails as context_too_small | |
