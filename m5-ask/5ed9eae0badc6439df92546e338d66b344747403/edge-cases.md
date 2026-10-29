# Edge-case matrix (m5-ask)

Rows come from the tests that ran. Cases proven only by the local ai-service integration suite, the stack tests (running wiki, worker, ai-service and Ollama with qwen3:8b), the server e2e suite (Postgres/Redis, not run in CI) or the Playwright screenshot run are marked n/a with their local result; the JUnit reports are in `local-suites/`. All local suites were run at 6419b1bd (integration 135 passed, stack 23 passed, server e2e 86 passed). The ASK-AC57 first-text times were 0.82 s and 1.47 s (limit 10 s); Ollama had no model loaded when the stack run began, and the earlier real-model tests of the same run had loaded qwen3:8b before ASK-AC57 ran. The screenshot rows refer to the screenshot run of the evidence pack. The plan cases of `.work/m5-ask.md` that have a named ASK-AC test are covered by that test's row; two plan cases whose test carries a different criterion ID are added as "plan:" rows.

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| ASK-AC1 | available panel shows heading, hint and the input placeholder | per test | per ASK-AC1 | ASK-AC1: available panel shows heading, hint and the input placeholder | |
| ASK-AC1 | screenshot: A1 shows the heading, the hint, the examples and the input | per test | per ASK-AC1 | n/a: screenshot run, see screenshots/ | |
| ASK-AC2 | shows both example questions | per test | per ASK-AC2 | ASK-AC2: shows both example questions | |
| ASK-AC3 | scope options are sorted with Alle Bereiche selected | per test | per ASK-AC3 | ASK-AC3: scope options are sorted with Alle Bereiche selected | |
| ASK-AC4 | a no_source event ends the turn with status no_source | per test | per ASK-AC4 | ASK-AC4: a no_source event ends the turn with status no_source | |
| ASK-AC4 | clicking an example sends it and shows it as the question | per test | per ASK-AC4 | ASK-AC4: clicking an example sends it and shows it as the question | |
| ASK-AC5 | the menu item does not close a panel that is already open | per test | per ASK-AC5 | ASK-AC5: the menu item does not close a panel that is already open | |
| ASK-AC5 | the menu item opens the panel scoped to this page and keeps the conversation | per test | per ASK-AC5 | ASK-AC5: the menu item opens the panel scoped to this page and keeps the conversation | |
| ASK-AC6 | the page menu has no ask item while the assistant is disabled | per test | per ASK-AC6 | ASK-AC6: the page menu has no ask item while the assistant is disabled | |
| ASK-AC6 | the page menu shows the ask item while the assistant is unavailable | per test | per ASK-AC6 | ASK-AC6: the page menu shows the ask item while the assistant is unavailable | |
| ASK-AC7 | unavailable status disables input and send | per test | per ASK-AC7 | ASK-AC7: unavailable status disables input and send | |
| ASK-AC7 | screenshot: A4 shows the unavailable text with the input disabled | per test | per ASK-AC7 | n/a: screenshot run, see screenshots/ | |
| ASK-AC8 | the scope is mapped to spaceId or pageId in the request | per test | per ASK-AC8 | ASK-AC8: the scope is mapped to spaceId or pageId in the request | |
| ASK-AC8 | the scope survives unmount and remount | per test | per ASK-AC8 | ASK-AC8: the scope survives unmount and remount | |
| ASK-AC9 | client request, event and source fields equal the contract | per test | per ASK-AC9 | ASK-AC9: client request, event and source fields equal the contract | |
| ASK-AC9 | decodes a multi-byte character split across chunks | per test | per ASK-AC9 | ASK-AC9: decodes a multi-byte character split across chunks | |
| ASK-AC9 | delivers several frames that arrive in one chunk | per test | per ASK-AC9 | ASK-AC9: delivers several frames that arrive in one chunk | |
| ASK-AC9 | every ask event the wiki streams has exactly the fields of the contract | per test | per ASK-AC9 | ASK-AC9: every ask event the wiki streams has exactly the fields of the contract | |
| ASK-AC9 | posts JSON with the session cookie to /api/ai/ask | per test | per ASK-AC9 | ASK-AC9: posts JSON with the session cookie to /api/ai/ask | |
| ASK-AC9 | reassembles a frame split mid-JSON and mid-'data:' | per test | per ASK-AC9 | ASK-AC9: reassembles a frame split mid-JSON and mid-'data:' | |
| ASK-AC9 | relays deltas in order, also when lines are split across chunks | per test | per ASK-AC9 | ASK-AC9: relays deltas in order, also when lines are split across chunks | |
| ASK-AC9 | streams deltas into the turn and finishes with the sources | per test | per ASK-AC9 | ASK-AC9: streams deltas into the turn and finishes with the sources | |
| ASK-AC9 | the ask endpoint streams with the contract content type | per test | per ASK-AC9 | ASK-AC9: the ask endpoint streams with the contract content type | |
| ASK-AC9 | the event schema keys equal the contract's event fields | per test | per ASK-AC9 | ASK-AC9: the event schema keys equal the contract's event fields | |
| ASK-AC9 | writes each event as one server-sent event and ends the response | per test | per ASK-AC9 | ASK-AC9: writes each event as one server-sent event and ends the response | |
| ASK-AC9 | test ask ac9 every ask event has exactly the fields of the contract | per test | per ASK-AC9 | test_ask_ac9_every_ask_event_has_exactly_the_fields_of_the_contract | |
| ASK-AC9 | test ask ac9 no source is one line | per test | per ASK-AC9 | test_ask_ac9_no_source_is_one_line | |
| ASK-AC9 | test ask ac9 start serves the app with the loaded model | per test | per ASK-AC9 | test_ask_ac9_start_serves_the_app_with_the_loaded_model | |
| ASK-AC9 | test ask ac9 start with a model that cannot load exits 1 naming the model | per test | per ASK-AC9 | test_ask_ac9_start_with_a_model_that_cannot_load_exits_1_naming_the_model | |
| ASK-AC9 | test ask ac9 start without ai wiki url exits 1 naming it | per test | per ASK-AC9 | test_ask_ac9_start_without_ai_wiki_url_exits_1_naming_it | |
| ASK-AC9 | test ask ac9 the first line reaches the client before the last delta exists | per test | per ASK-AC9 | test_ask_ac9_the_first_line_reaches_the_client_before_the_last_delta_exists | |
| ASK-AC9 | test ask ac9 the response is ndjson with one event per line in order | per test | per ASK-AC9 | test_ask_ac9_the_response_is_ndjson_with_one_event_per_line_in_order | |
| ASK-AC9 | test ask ac9 the session scope and token reach the pipeline | per test | per ASK-AC9 | test_ask_ac9_the_session_scope_and_token_reach_the_pipeline | |
| ASK-AC9 | plan: contract test lists /v1/ask | per plan test case | per ASK-AC9 | test_bridge_ac35_endpoint_exists_with_the_contract_method_and_path[POST /v1/ask] | |
| ASK-AC10 | removed 29.10.2026, replaced by ASK-AC77 | - | - | n/a: criterion removed | |
| ASK-AC77 | the button is named Stoppen from send until the answer ends and stops it | per test | per ASK-AC77 | ASK-AC77: the button is named Stoppen from send until the answer ends and stops it | |
| ASK-AC77 | the button returns to Senden when the answer ends | per test | per ASK-AC77 | ASK-AC77: the button returns to Senden when the answer ends | |
| ASK-AC77 | screenshot: A2 shows the stop button while the answer is generated | per test | per ASK-AC77 | n/a: screenshot run, see screenshots/ | |
| ASK-AC11 | a blank question is not sent | per test | per ASK-AC11 | ASK-AC11: a blank question is not sent | |
| ASK-AC11 | a second send while the answer is streaming does nothing | per test | per ASK-AC11 | ASK-AC11: a second send while the answer is streaming does nothing | |
| ASK-AC12 | a remounted hook can stop a running answer | per test | per ASK-AC12 | ASK-AC12: a remounted hook can stop a running answer | |
| ASK-AC12 | keeps the text and adds Abgebrochen without sources | per test | per ASK-AC12 | ASK-AC12: keeps the text and adds Abgebrochen without sources | |
| ASK-AC12 | rethrows the abort so the caller can mark the turn stopped | per test | per ASK-AC12 | ASK-AC12: rethrows the abort so the caller can mark the turn stopped | |
| ASK-AC12 | stop aborts, keeps the partial text and adds no sources | per test | per ASK-AC12 | ASK-AC12: stop aborts, keeps the partial text and adds no sources | |
| ASK-AC13 | a client that leaves before the AI service answers ends quietly | per test | per ASK-AC13 | ASK-AC13: a client that leaves before the AI service answers ends quietly | |
| ASK-AC13 | a client that left before the stream gets nothing written | per test | per ASK-AC13 | ASK-AC13: a client that left before the stream gets nothing written | |
| ASK-AC13 | aborting the request closes the AI service request and sends no further event | per test | per ASK-AC13 | ASK-AC13: aborting the request closes the AI service request and sends no further event | |
| ASK-AC13 | closing the client connection aborts the signal passed to the service | per test | per ASK-AC13 | ASK-AC13: closing the client connection aborts the signal passed to the service | |
| ASK-AC13 | test ask ac13 a client that disconnects after the first line stops the pipeline | per test | per ASK-AC13 | test_ask_ac13_a_client_that_disconnects_after_the_first_line_stops_the_pipeline | |
| ASK-AC13 | test ask ac13 closing the events after the first delta closes the model stream | per test | per ASK-AC13 | test_ask_ac13_closing_the_events_after_the_first_delta_closes_the_model_stream | |
| ASK-AC13 | plan: closing the iterator closes the HTTP stream | per plan test case | per ASK-AC13 | test_ask_ac69_closing_the_generator_closes_the_response | |
| ASK-AC14 | shows no Quellen while the answer streams | per test | per ASK-AC14 | ASK-AC14: shows no Quellen while the answer streams | |
| ASK-AC14 | shows no sources while streaming | per test | per ASK-AC14 | ASK-AC14: shows no sources while streaming | |
| ASK-AC15 | keeps the numbering and order of the citations, one source per citation | per test | per ASK-AC15 | ASK-AC15: keeps the numbering and order of the citations, one source per citation | |
| ASK-AC15 | links each number of a combined marker to its own source | per test | per ASK-AC15 | ASK-AC15: links each number of a combined marker to its own source | |
| ASK-AC15 | lists the sources in number order with their numbers | per test | per ASK-AC15 | ASK-AC15: lists the sources in number order with their numbers | |
| ASK-AC15 | test ask ac15 repeated citation reuses its number | per test | per ASK-AC15 | test_ask_ac15_repeated_citation_reuses_its_number | |
| ASK-AC15 | screenshot: A2 shows the answer with its two sources | per test | per ASK-AC15 | n/a: screenshot run, see screenshots/ | |
| ASK-AC16 | test ask ac16 an answered question ends with citations and is stored | per test | per ASK-AC16 | test_ask_ac16_an_answered_question_ends_with_citations_and_is_stored | |
| ASK-AC16 | test ask ac16 brackets that are not markers pass through | per test | per ASK-AC16 | test_ask_ac16_brackets_that_are_not_markers_pass_through | |
| ASK-AC16 | test ask ac16 finish flushes unclosed marker as text | per test | per ASK-AC16 | test_ask_ac16_finish_flushes_unclosed_marker_as_text | |
| ASK-AC16 | test ask ac16 held back marker is not shown early | per test | per ASK-AC16 | test_ask_ac16_held_back_marker_is_not_shown_early | |
| ASK-AC16 | test ask ac16 list marker becomes adjacent markers[[3,  1]] | per test | per ASK-AC16 | test_ask_ac16_list_marker_becomes_adjacent_markers[[3,  1]] | |
| ASK-AC16 | test ask ac16 list marker becomes adjacent markers[[3, 1]] | per test | per ASK-AC16 | test_ask_ac16_list_marker_becomes_adjacent_markers[[3, 1]] | |
| ASK-AC16 | test ask ac16 list marker becomes adjacent markers[[3,1]] | per test | per ASK-AC16 | test_ask_ac16_list_marker_becomes_adjacent_markers[[3,1]] | |
| ASK-AC16 | test ask ac16 long unterminated bracket is released | per test | per ASK-AC16 | test_ask_ac16_long_unterminated_bracket_is_released | |
| ASK-AC16 | test ask ac16 marker split across deltas[deltas0] | per test | per ASK-AC16 | test_ask_ac16_marker_split_across_deltas[deltas0] | |
| ASK-AC16 | test ask ac16 marker split across deltas[deltas1] | per test | per ASK-AC16 | test_ask_ac16_marker_split_across_deltas[deltas1] | |
| ASK-AC16 | test ask ac16 marker split across deltas[deltas2] | per test | per ASK-AC16 | test_ask_ac16_marker_split_across_deltas[deltas2] | |
| ASK-AC16 | test ask ac16 marker split across deltas[deltas3] | per test | per ASK-AC16 | test_ask_ac16_marker_split_across_deltas[deltas3] | |
| ASK-AC16 | test ask ac16 marker split across deltas[deltas4] | per test | per ASK-AC16 | test_ask_ac16_marker_split_across_deltas[deltas4] | |
| ASK-AC16 | test ask ac16 non marker bracket split across deltas passes through | per test | per ASK-AC16 | test_ask_ac16_non_marker_bracket_split_across_deltas_passes_through | |
| ASK-AC16 | test ask ac16 question is last in the final user message | per test | per ASK-AC16 | test_ask_ac16_question_is_last_in_the_final_user_message | |
| ASK-AC16 | test ask ac16 renumbers in order of first appearance | per test | per ASK-AC16 | test_ask_ac16_renumbers_in_order_of_first_appearance | |
| ASK-AC16 | test ask ac16 sources are numbered with heading path and pdf location | per test | per ASK-AC16 | test_ask_ac16_sources_are_numbered_with_heading_path_and_pdf_location | |
| ASK-AC16 | test ask ac16 system message is first and german | per test | per ASK-AC16 | test_ask_ac16_system_message_is_first_and_german | |
| ASK-AC17 | a section with the heading path ["Bänder"] in Geschäftsführung gets title, space name, path and the anchor of the first heading with that path | per test | per ASK-AC17 | ASK-AC17: a section with the heading path ["Bänder"] in Geschäftsführung gets title, space name, path and the anchor of the first heading with that path | |
| ASK-AC17 | shows space and one heading level | per test | per ASK-AC17 | ASK-AC17: shows space and one heading level | |
| ASK-AC17 | GF gets the streamed text and a source for "Bänder" in Geschäftsführung linking the heading | per test | per ASK-AC17 | n/a: server e2e only, not in KIT_TEST; "ASK-AC17: GF gets the streamed text and a source for "Bänder" in Geschäftsführung linking the heading" pass in local-suites/server-e2e.tsv | |
| ASK-AC18 | a heading path is matched against the Markdown text of the heading, as the index builds it | per test | per ASK-AC18 | ASK-AC18: a heading path is matched against the Markdown text of the heading, as the index builds it | |
| ASK-AC18 | a section with the heading path ["A", "B"] in Allgemein links the first B under A, not an earlier top-level B | per test | per ASK-AC18 | ASK-AC18: a section with the heading path ["A", "B"] in Allgemein links the first B under A, not an earlier top-level B | |
| ASK-AC18 | shows space and two heading levels | per test | per ASK-AC18 | ASK-AC18: shows space and two heading levels | |
| ASK-AC19 | a section with an empty heading path gets the space name only and no anchor | per test | per ASK-AC19 | ASK-AC19: a section with an empty heading path gets the space name only and no anchor | |
| ASK-AC19 | shows only the space name for an empty heading path | per test | per ASK-AC19 | ASK-AC19: shows only the space name for an empty heading path | |
| ASK-AC20 | a PDF section gets the file name and PDF page and no anchor | per test | per ASK-AC20 | ASK-AC20: a PDF section gets the file name and PDF page and no anchor | |
| ASK-AC20 | shows space, file name and page for a PDF | per test | per ASK-AC20 | ASK-AC20: shows space, file name and page for a PDF | |
| ASK-AC20 | a PDF source gets the file name and page and links the page top | per test | per ASK-AC20 | n/a: server e2e only, not in KIT_TEST; "ASK-AC20: a PDF source gets the file name and page and links the page top" pass in local-suites/server-e2e.tsv | |
| ASK-AC21 | a heading in FirstInItem gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading in FirstInItem gets no anchor | |
| ASK-AC21 | a heading in FirstInOrderedItem gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading in FirstInOrderedItem gets no anchor | |
| ASK-AC21 | a heading in InCell gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading in InCell gets no anchor | |
| ASK-AC21 | a heading in InQuote gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading in InQuote gets no anchor | |
| ASK-AC21 | a heading in InTask gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading in InTask gets no anchor | |
| ASK-AC21 | a heading in TwoLevelsDeep gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading in TwoLevelsDeep gets no anchor | |
| ASK-AC21 | a heading inside a callout gets its id as the anchor | per test | per ASK-AC21 | ASK-AC21: a heading inside a callout gets its id as the anchor | |
| ASK-AC21 | a heading inside a column gets its id as the anchor | per test | per ASK-AC21 | ASK-AC21: a heading inside a column gets its id as the anchor | |
| ASK-AC21 | a heading inside a details block gets its id as the anchor | per test | per ASK-AC21 | ASK-AC21: a heading inside a details block gets its id as the anchor | |
| ASK-AC21 | a heading path that matches no heading gets no anchor | per test | per ASK-AC21 | ASK-AC21: a heading path that matches no heading gets no anchor | |
| ASK-AC21 | every path the index sees as a heading gets that heading id | per test | per ASK-AC21 | ASK-AC21: every path the index sees as a heading gets that heading id | |
| ASK-AC21 | later headings keep their path after a non-first list heading | per test | per ASK-AC21 | ASK-AC21: later headings keep their path after a non-first list heading | |
| ASK-AC21 | the converter still produces the markdown the index was checked against | per test | per ASK-AC21 | ASK-AC21: the converter still produces the markdown the index was checked against | |
| ASK-AC21 | the first heading in document order wins, also across containers | per test | per ASK-AC21 | ASK-AC21: the first heading in document order wins, also across containers | |
| ASK-AC21 | test ask ac21 the index paths of the bridge markdown are exactly the anchored paths | per test | per ASK-AC21 | test_ask_ac21_the_index_paths_of_the_bridge_markdown_are_exactly_the_anchored_paths | |
| ASK-AC21 | screenshot: clicking a source opens the page with the cited heading in view | per test | per ASK-AC21 | n/a: screenshot run, see screenshots/ | |
| ASK-AC22 | links a PDF and an empty-path source to the page top | per test | per ASK-AC22 | ASK-AC22: links a PDF and an empty-path source to the page top | |
| ASK-AC23 | keeps a marker without a source as text | per test | per ASK-AC23 | ASK-AC23: keeps a marker without a source as text | |
| ASK-AC23 | links a citation marker to its source url | per test | per ASK-AC23 | ASK-AC23: links a citation marker to its source url | |
| ASK-AC24 | test ask ac24 invalid numbers are removed | per test | per ASK-AC24 | test_ask_ac24_invalid_numbers_are_removed | |
| ASK-AC24 | test ask ac24 mixed list keeps the valid number | per test | per ASK-AC24 | test_ask_ac24_mixed_list_keeps_the_valid_number | |
| ASK-AC25 | a citations event without citations is answered with no_source | per test | per ASK-AC25 | ASK-AC25: a citations event without citations is answered with no_source | |
| ASK-AC25 | no_source from the AI service is relayed as no_source | per test | per ASK-AC25 | ASK-AC25: no_source from the AI service is relayed as no_source | |
| ASK-AC25 | shows the no-source text instead of the answer | per test | per ASK-AC25 | ASK-AC25: shows the no-source text instead of the answer | |
| ASK-AC25 | test ask ac25 no citation leaves cited empty | per test | per ASK-AC25 | test_ask_ac25_no_citation_leaves_cited_empty | |
| ASK-AC25 | test ask ac25 only invalid citations leave cited empty | per test | per ASK-AC25 | test_ask_ac25_only_invalid_citations_leave_cited_empty | |
| ASK-AC26 | a cited page moved to the trash during the answer withdraws it with no_source | per test | per ASK-AC26 | ASK-AC26: a cited page moved to the trash during the answer withdraws it with no_source | |
| ASK-AC26 | a cited page moved to the trash during the answer is withdrawn with no_source | per test | per ASK-AC26 | n/a: server e2e only, not in KIT_TEST; "ASK-AC26: a cited page moved to the trash during the answer is withdrawn with no_source" pass in local-suites/server-e2e.tsv | |
| ASK-AC27 | a cited page whose space the user was removed from during the answer withdraws it with no_source | per test | per ASK-AC27 | ASK-AC27: a cited page whose space the user was removed from during the answer withdraws it with no_source | |
| ASK-AC27 | a cited page of a space the user was removed from during the answer is withdrawn with no_source | per test | per ASK-AC27 | n/a: server e2e only, not in KIT_TEST; "ASK-AC27: a cited page of a space the user was removed from during the answer is withdrawn with no_source" pass in local-suites/server-e2e.tsv | |
| ASK-AC28 | a cited page that got a restriction excluding the user during the answer withdraws it with no_source | per test | per ASK-AC28 | ASK-AC28: a cited page that got a restriction excluding the user during the answer withdraws it with no_source | |
| ASK-AC28 | a cited page restricted against the user during the answer is withdrawn with no_source | per test | per ASK-AC28 | n/a: server e2e only, not in KIT_TEST; "ASK-AC28: a cited page restricted against the user during the answer is withdrawn with no_source" pass in local-suites/server-e2e.tsv | |
| ASK-AC29 | test ask ac29 filter pages posts the page ids with both tokens | per test | per ASK-AC29 | test_ask_ac29_filter_pages_posts_the_page_ids_with_both_tokens | |
| ASK-AC29 | test ask ac29 filter pages refuses more than 500 ids without sending | per test | per ASK-AC29 | test_ask_ac29_filter_pages_refuses_more_than_500_ids_without_sending | |
| ASK-AC29 | test ask ac29 filter pages without ids sends no request | per test | per ASK-AC29 | test_ask_ac29_filter_pages_without_ids_sends_no_request | |
| ASK-AC29 | test ask ac29 hits outside the token spaces are dropped even if the search returns them | per test | per ASK-AC29 | test_ask_ac29_hits_outside_the_token_spaces_are_dropped_even_if_the_search_returns_them | |
| ASK-AC29 | test ask ac29 one filter call with candidates and history pages and the user token | per test | per ASK-AC29 | test_ask_ac29_one_filter_call_with_candidates_and_history_pages_and_the_user_token | |
| ASK-AC29 | test ask ac29 only sections of pages that pass the filter reach the prompt | per test | per ASK-AC29 | test_ask_ac29_only_sections_of_pages_that_pass_the_filter_reach_the_prompt | |
| ASK-AC29 | test ask ac29 without a space scope one filter call has no space id | per test | per ASK-AC29 | test_ask_ac29_without_a_space_scope_one_filter_call_has_no_space_id | |
| ASK-AC30 | a restricted page in that space is still dropped | per test | per ASK-AC30 | ASK-AC30: a restricted page in that space is still dropped | |
| ASK-AC30 | a space the user is not a member of passes nothing | per test | per ASK-AC30 | ASK-AC30: a space the user is not a member of passes nothing | |
| ASK-AC30 | accepts a space id and lowercases it | per test | per ASK-AC30 | ASK-AC30: accepts a space id and lowercases it | |
| ASK-AC30 | accepts page ids without a space | per test | per ASK-AC30 | ASK-AC30: accepts page ids without a space | |
| ASK-AC30 | keeps only viewable pages that are in that space now | per test | per ASK-AC30 | ASK-AC30: keeps only viewable pages that are in that space now | |
| ASK-AC30 | rejects the malformed space id "" | per test | per ASK-AC30 | ASK-AC30: rejects the malformed space id "" | |
| ASK-AC30 | rejects the malformed space id "space-1" | per test | per ASK-AC30 | ASK-AC30: rejects the malformed space id "space-1" | |
| ASK-AC30 | rejects the malformed space id 42 | per test | per ASK-AC30 | ASK-AC30: rejects the malformed space id 42 | |
| ASK-AC30 | test ask ac30 a page indexed in the scope but now in another space is not in the prompt | per test | per ASK-AC30 | test_ask_ac30_a_page_indexed_in_the_scope_but_now_in_another_space_is_not_in_the_prompt | |
| ASK-AC30 | test ask ac30 filter pages sends the space id only when given | per test | per ASK-AC30 | test_ask_ac30_filter_pages_sends_the_space_id_only_when_given | |
| ASK-AC30 | test ask ac30 history pages are filtered without the space scope | per test | per ASK-AC30 | test_ask_ac30_history_pages_are_filtered_without_the_space_scope | |
| ASK-AC30 | test ask ac30 space scope outside the token spaces is no source without search | per test | per ASK-AC30 | test_ask_ac30_space_scope_outside_the_token_spaces_is_no_source_without_search | |
| ASK-AC30 | test ask ac30 space scope searches that space and keeps only its sections | per test | per ASK-AC30 | test_ask_ac30_space_scope_searches_that_space_and_keeps_only_its_sections | |
| ASK-AC30 | a malformed spaceId answers 400 invalid_request | per test | per ASK-AC30 | n/a: server e2e only, not in KIT_TEST; "ASK-AC30: a malformed spaceId answers 400 invalid_request" pass in local-suites/server-e2e.tsv | |
| ASK-AC30 | with a spaceId, filter-pages keeps a viewable page only while it is in that space | per test | per ASK-AC30 | n/a: server e2e only, not in KIT_TEST; "ASK-AC30: with a spaceId, filter-pages keeps a viewable page only while it is in that space" pass in local-suites/server-e2e.tsv | |
| ASK-AC31 | test ask ac31 page scope passes the page id and keeps only that page | per test | per ASK-AC31 | test_ask_ac31_page_scope_passes_the_page_id_and_keeps_only_that_page | |
| ASK-AC31 | test ask ac31 search index refuses a page id that is not a uuid | per test | per ASK-AC31 | test_ask_ac31_search_index_refuses_a_page_id_that_is_not_a_uuid | |
| ASK-AC31 | test ask ac31 store search with a page id returns only that page and its pdfs | per test | per ASK-AC31 | n/a: ai-service integration only, not in KIT_TEST; "test_ask_ac31_store_search_with_a_page_id_returns_only_that_page_and_its_pdfs" pass in local-suites/ai-service-integration.tsv | |
| ASK-AC32 | test ask ac32 restricted page in an open space is not in the prompt | per test | per ASK-AC32 | test_ask_ac32_restricted_page_in_an_open_space_is_not_in_the_prompt | |
| ASK-AC32 | test ask ac32 a restricted page in an open space gives no section in the prompt | per test | per ASK-AC32 | n/a: stack only, not in KIT_TEST; "test_ask_ac32_a_restricted_page_in_an_open_space_gives_no_section_in_the_prompt" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC32 | test ask ac32 control without the filter the restricted sections reach the prompt | per test | per ASK-AC32 | n/a: stack only, not in KIT_TEST; "test_ask_ac32_control_without_the_filter_the_restricted_sections_reach_the_prompt" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC33 | test ask ac33 page moved out of a readable space is not in the prompt | per test | per ASK-AC33 | test_ask_ac33_page_moved_out_of_a_readable_space_is_not_in_the_prompt | |
| ASK-AC33 | test ask ac33 a page moved out of a readable space gives no section in the prompt | per test | per ASK-AC33 | n/a: stack only, not in KIT_TEST; "test_ask_ac33_a_page_moved_out_of_a_readable_space_gives_no_section_in_the_prompt" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC34 | test ask ac34 trashed page still in the index is not in the prompt | per test | per ASK-AC34 | test_ask_ac34_trashed_page_still_in_the_index_is_not_in_the_prompt | |
| ASK-AC34 | test ask ac34 a trashed page still in the index gives no section in the prompt | per test | per ASK-AC34 | n/a: stack only, not in KIT_TEST; "test_ask_ac34_a_trashed_page_still_in_the_index_gives_no_section_in_the_prompt" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Wann ist die Kernarbeitszeit?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Wann ist die Kernarbeitszeit?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Wann ist die Kernarbeitszeit?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Wann ist die Kernarbeitszeit?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Wie pflege ich eine Orchidee?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Wie pflege ich eine Orchidee?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Wie pflege ich eine Orchidee?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Wie pflege ich eine Orchidee?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Wann ist die Kernarbeitszeit?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Wann ist die Kernarbeitszeit?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Wann ist die Kernarbeitszeit?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Wann ist die Kernarbeitszeit?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Wie pflege ich eine Orchidee?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Wie pflege ich eine Orchidee?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Wie pflege ich eine Orchidee?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Wie pflege ich eine Orchidee?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Wann ist die Kernarbeitszeit?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Wann ist die Kernarbeitszeit?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Wann ist die Kernarbeitszeit?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Wann ist die Kernarbeitszeit?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Wie pflege ich eine Orchidee?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Wie pflege ich eine Orchidee?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Wie pflege ich eine Orchidee?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Wie pflege ich eine Orchidee?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Wann ist die Kernarbeitszeit?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Wann ist die Kernarbeitszeit?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Wann ist die Kernarbeitszeit?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Wann ist die Kernarbeitszeit?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Welche Gehaltsb\xe4nder gelten f\xfcr die Abteilungsleitung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Wer beantwortet R\xfcckfragen zur Reisekostenabrechnung?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Wie pflege ich eine Orchidee?-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Wie pflege ich eine Orchidee?-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Wie pflege ich eine Orchidee?-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Wie pflege ich eine Orchidee?-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Zwei Stellen in der Verwaltung entfallen.-index-spaces] | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | per test | per ASK-AC35 | test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS-Zwei Stellen in der Verwaltung entfallen.-stale-index-spaces] | |
| ASK-AC35 | test ask ac35 the seed matrix denies every user but gf some pages | per test | per ASK-AC35 | test_ask_ac35_the_seed_matrix_denies_every_user_but_gf_some_pages | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[GF] | per test | per ASK-AC35 | n/a: stack only, not in KIT_TEST; "test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[GF]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[PL] | per test | per ASK-AC35 | n/a: stack only, not in KIT_TEST; "test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[PL]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[VT] | per test | per ASK-AC35 | n/a: stack only, not in KIT_TEST; "test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[VT]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC35 | test ask ac35 no seed user gets a section of a page they may not view into the prompt[WS] | per test | per ASK-AC35 | n/a: stack only, not in KIT_TEST; "test_ask_ac35_no_seed_user_gets_a_section_of_a_page_they_may_not_view_into_the_prompt[WS]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC36 | shows the no-source text for an empty answer | per test | per ASK-AC36 | ASK-AC36: shows the no-source text for an empty answer | |
| ASK-AC36 | test ask ac36 a score exactly at the threshold is kept | per test | per ASK-AC36 | test_ask_ac36_a_score_exactly_at_the_threshold_is_kept | |
| ASK-AC36 | test ask ac36 only the best eight passing sections reach the model | per test | per ASK-AC36 | test_ask_ac36_only_the_best_eight_passing_sections_reach_the_model | |
| ASK-AC36 | test ask ac36 passing sections below the threshold give no source without the model | per test | per ASK-AC36 | test_ask_ac36_passing_sections_below_the_threshold_give_no_source_without_the_model | |
| ASK-AC36 | screenshot: A3 shows the no-source text without sources | per test | per ASK-AC36 | n/a: screenshot run, see screenshots/ | |
| ASK-AC37 | test ask ac37 candidates that all fail the filter give no source without the model | per test | per ASK-AC37 | test_ask_ac37_candidates_that_all_fail_the_filter_give_no_source_without_the_model | |
| ASK-AC38 | test ask ac38 a space scope for a user without spaces gets no source | per test | per ASK-AC38 | test_ask_ac38_a_space_scope_for_a_user_without_spaces_gets_no_source | |
| ASK-AC38 | test ask ac38 a user without spaces gets no source without search filter or model | per test | per ASK-AC38 | test_ask_ac38_a_user_without_spaces_gets_no_source_without_search_filter_or_model | |
| ASK-AC39 | test ask ac39 gehaltsbaender for ws gives the no source answer | per test | per ASK-AC39 | n/a: stack only, not in KIT_TEST; "test_ask_ac39_gehaltsbaender_for_ws_gives_the_no_source_answer" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC40 | test ask ac40 orchid question gives the same no source answer[GF] | per test | per ASK-AC40 | n/a: stack only, not in KIT_TEST; "test_ask_ac40_orchid_question_gives_the_same_no_source_answer[GF]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC40 | test ask ac40 orchid question gives the same no source answer[PL] | per test | per ASK-AC40 | n/a: stack only, not in KIT_TEST; "test_ask_ac40_orchid_question_gives_the_same_no_source_answer[PL]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC40 | test ask ac40 orchid question gives the same no source answer[VT] | per test | per ASK-AC40 | n/a: stack only, not in KIT_TEST; "test_ask_ac40_orchid_question_gives_the_same_no_source_answer[VT]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC40 | test ask ac40 orchid question gives the same no source answer[WS] | per test | per ASK-AC40 | n/a: stack only, not in KIT_TEST; "test_ask_ac40_orchid_question_gives_the_same_no_source_answer[WS]" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC41 | test ask ac41 gf gets the salary band with the gehaltsbaender page as source | per test | per ASK-AC41 | n/a: stack only, not in KIT_TEST; "test_ask_ac41_gf_gets_the_salary_band_with_the_gehaltsbaender_page_as_source" pass in local-suites/ai-service-stack.tsv | |
| ASK-AC42 | renders block html as literal text | per test | per ASK-AC42 | ASK-AC42: renders block html as literal text | |
| ASK-AC42 | renders inline html as literal text | per test | per ASK-AC42 | ASK-AC42: renders inline html as literal text | |
| ASK-AC43 | renders an image as its alt text without an img element | per test | per ASK-AC43 | ASK-AC43: renders an image as its alt text without an img element | |
| ASK-AC44 | renders a data link as text only | per test | per ASK-AC44 | ASK-AC44: renders a data link as text only | |
| ASK-AC44 | renders a javascript link as text only | per test | per ASK-AC44 | ASK-AC44: renders a javascript link as text only | |
| ASK-AC45 | keeps an https link whose text is a word | per test | per ASK-AC45 | ASK-AC45: keeps an https link whose text is a word | |
| ASK-AC45 | opens an https link in a new tab with noopener | per test | per ASK-AC45 | ASK-AC45: opens an https link in a new tab with noopener | |
| ASK-AC45 | renders the citation-looking link [1, 2](https://evil.example) as plain text | per test | per ASK-AC45 | ASK-AC45: renders the citation-looking link [1, 2](https://evil.example) as plain text | |
| ASK-AC45 | renders the citation-looking link [1](https://evil.example) as plain text | per test | per ASK-AC45 | ASK-AC45: renders the citation-looking link [1](https://evil.example) as plain text | |
| ASK-AC45 | renders the citation-looking link [[1]](https://evil.example) as plain text | per test | per ASK-AC45 | ASK-AC45: renders the citation-looking link [[1]](https://evil.example) as plain text | |
| ASK-AC46 | test ask ac46 history turn precedes the question | per test | per ASK-AC46 | test_ask_ac46_history_turn_precedes_the_question | |
| ASK-AC46 | test ask ac46 the second prompt holds the first question and its answer | per test | per ASK-AC46 | test_ask_ac46_the_second_prompt_holds_the_first_question_and_its_answer | |
| ASK-AC47 | test ask ac47 only the last five turns are kept in order | per test | per ASK-AC47 | test_ask_ac47_only_the_last_five_turns_are_kept_in_order | |
| ASK-AC48 | test ask ac48 the search uses the previous question and the current one | per test | per ASK-AC48 | test_ask_ac48_the_search_uses_the_previous_question_and_the_current_one | |
| ASK-AC49 | shows no Neue Unterhaltung button on another aside tab | per test | per ASK-AC49 | ASK-AC49: shows no Neue Unterhaltung button on another aside tab | |
| ASK-AC49 | shows no Neue Unterhaltung button while the assistant is unavailable | per test | per ASK-AC49 | ASK-AC49: shows no Neue Unterhaltung button while the assistant is unavailable | |
| ASK-AC49 | the Neue Unterhaltung button is enabled while an answer streams | per test | per ASK-AC49 | ASK-AC49: the Neue Unterhaltung button is enabled while an answer streams | |
| ASK-AC49 | the Neue Unterhaltung icon button in the title row returns to the empty state | per test | per ASK-AC49 | ASK-AC49: the Neue Unterhaltung icon button in the title row returns to the empty state | |
| ASK-AC50 | a new conversation aborts the answer, clears turns, renews the id and resets the scope to all spaces | per test | per ASK-AC50 | ASK-AC50: a new conversation aborts the answer, clears turns, renews the id and resets the scope to all spaces | |
| ASK-AC50 | follow-up questions reuse the conversation id | per test | per ASK-AC50 | ASK-AC50: follow-up questions reuse the conversation id | |
| ASK-AC51 | a fresh store starts with no turns and scope all | per test | per ASK-AC51 | ASK-AC51: a fresh store starts with no turns and scope all | |
| ASK-AC51 | a new store (reload) holds none of the earlier turns | per test | per ASK-AC51 | ASK-AC51: a new store (reload) holds none of the earlier turns | |
| ASK-AC52 | turns survive unmount and remount | per test | per ASK-AC52 | ASK-AC52: turns survive unmount and remount | |
| ASK-AC53 | test ask ac53 a question does not create the conversation | per test | per ASK-AC53 | test_ask_ac53_a_question_does_not_create_the_conversation | |
| ASK-AC53 | test ask ac53 a question outside every space extends the expiry | per test | per ASK-AC53 | test_ask_ac53_a_question_outside_every_space_extends_the_expiry | |
| ASK-AC53 | test ask ac53 a question that ends in no source extends the expiry | per test | per ASK-AC53 | test_ask_ac53_a_question_that_ends_in_no_source_extends_the_expiry | |
| ASK-AC53 | test ask ac53 a question that fails extends the expiry | per test | per ASK-AC53 | test_ask_ac53_a_question_that_fails_extends_the_expiry | |
| ASK-AC53 | test ask ac53 append sets and resets ttl | per test | per ASK-AC53 | test_ask_ac53_append_sets_and_resets_ttl | |
| ASK-AC53 | test ask ac53 confirm keeps the remaining ttl | per test | per ASK-AC53 | test_ask_ac53_confirm_keeps_the_remaining_ttl | |
| ASK-AC53 | test ask ac53 expired conversation loads empty | per test | per ASK-AC53 | test_ask_ac53_expired_conversation_loads_empty | |
| ASK-AC53 | test ask ac53 load of unknown conversation is empty | per test | per ASK-AC53 | test_ask_ac53_load_of_unknown_conversation_is_empty | |
| ASK-AC53 | test ask ac53 malformed entry is dropped with a warning | per test | per ASK-AC53 | test_ask_ac53_malformed_entry_is_dropped_with_a_warning | |
| ASK-AC53 | test ask ac53 round trip keeps order | per test | per ASK-AC53 | test_ask_ac53_round_trip_keeps_order | |
| ASK-AC53 | test ask ac53 touch resets the ttl without creating the conversation | per test | per ASK-AC53 | test_ask_ac53_touch_resets_the_ttl_without_creating_the_conversation | |
| ASK-AC54 | test ask ac54 another user cannot confirm a turn | per test | per ASK-AC54 | test_ask_ac54_another_user_cannot_confirm_a_turn | |
| ASK-AC54 | test ask ac54 confirm with another users token leaves the turn pending | per test | per ASK-AC54 | test_ask_ac54_confirm_with_another_users_token_leaves_the_turn_pending | |
| ASK-AC54 | test ask ac54 keeps only the last turns | per test | per ASK-AC54 | test_ask_ac54_keeps_only_the_last_turns | |
| ASK-AC54 | test ask ac54 other user sees nothing and cannot change turns | per test | per ASK-AC54 | test_ask_ac54_other_user_sees_nothing_and_cannot_change_turns | |
| ASK-AC54 | test ask ac54 rejects ids that could address another key[-0192f000-0000-7000-8000-0000000000c1] | per test | per ASK-AC54 | test_ask_ac54_rejects_ids_that_could_address_another_key[-0192f000-0000-7000-8000-0000000000c1] | |
| ASK-AC54 | test ask ac54 rejects ids that could address another key[0192f000-0000-7000-8000-00000000000a-0192f000-0000-7000-8000-0000000000c1:0192f000-0000-7000-8000-00000000000b] | per test | per ASK-AC54 | test_ask_ac54_rejects_ids_that_could_address_another_key[0192f000-0000-7000-8000-00000000000a-0192f000-0000-7000-8000-0000000000c1:0192f000-0000-7000-8000-00000000000b] | |
| ASK-AC54 | test ask ac54 rejects ids that could address another key[0192f000-0000-7000-8000-00000000000a-] | per test | per ASK-AC54 | test_ask_ac54_rejects_ids_that_could_address_another_key[0192f000-0000-7000-8000-00000000000a-] | |
| ASK-AC54 | test ask ac54 rejects ids that could address another key[0192f000-0000-7000-8000-00000000000a:0192f000-0000-7000-8000-0000000000c1-other] | per test | per ASK-AC54 | test_ask_ac54_rejects_ids_that_could_address_another_key[0192f000-0000-7000-8000-00000000000a:0192f000-0000-7000-8000-0000000000c1-other] | |
| ASK-AC54 | test ask ac54 rejects ids that could address another key[0192f000-0000-7000-8000-00000000000a:x-0192f000-0000-7000-8000-0000000000c1] | per test | per ASK-AC54 | test_ask_ac54_rejects_ids_that_could_address_another_key[0192f000-0000-7000-8000-00000000000a:x-0192f000-0000-7000-8000-0000000000c1] | |
| ASK-AC55 | test ask ac55 a history answer whose source page fails is dropped and its question kept | per test | per ASK-AC55 | test_ask_ac55_a_history_answer_whose_source_page_fails_is_dropped_and_its_question_kept | |
| ASK-AC55 | test ask ac55 history of another user is not loaded | per test | per ASK-AC55 | test_ask_ac55_history_of_another_user_is_not_loaded | |
| ASK-AC56 | a citations event without the contract turn id is malformed | per test | per ASK-AC56 | ASK-AC56: a citations event without the contract turn id is malformed | |
| ASK-AC56 | a client that stops before the final check ended leaves the turn unconfirmed | per test | per ASK-AC56 | ASK-AC56: a client that stops before the final check ended leaves the turn unconfirmed | |
| ASK-AC56 | a failed confirm keeps the shown answer and logs no answer text | per test | per ASK-AC56 | ASK-AC56: a failed confirm keeps the shown answer and logs no answer text | |
| ASK-AC56 | a turn confirmation answered with another status fails | per test | per ASK-AC56 | ASK-AC56: a turn confirmation answered with another status fails | |
| ASK-AC56 | an answer withdrawn by the final check is not confirmed | per test | per ASK-AC56 | ASK-AC56: an answer withdrawn by the final check is not confirmed | |
| ASK-AC56 | an upstream error or no_source is not confirmed | per test | per ASK-AC56 | ASK-AC56: an upstream error or no_source is not confirmed | |
| ASK-AC56 | confirms the turn with both tokens before the sources event is sent | per test | per ASK-AC56 | ASK-AC56: confirms the turn with both tokens before the sources event is sent | |
| ASK-AC56 | the turn confirmation posts the contract request fields with both token headers | per test | per ASK-AC56 | ASK-AC56: the turn confirmation posts the contract request fields with both token headers | |
| ASK-AC56 | test ask ac56 a failed answer shows the error after its text and is not stored | per test | per ASK-AC56 | test_ask_ac56_a_failed_answer_shows_the_error_after_its_text_and_is_not_stored | |
| ASK-AC56 | test ask ac56 a model that fails before any text logs no first text time | per test | per ASK-AC56 | test_ask_ac56_a_model_that_fails_before_any_text_logs_no_first_text_time | |
| ASK-AC56 | test ask ac56 a pending turn is dropped by the next append | per test | per ASK-AC56 | test_ask_ac56_a_pending_turn_is_dropped_by_the_next_append | |
| ASK-AC56 | test ask ac56 an answer the wiki did not confirm is not in the next prompt | per test | per ASK-AC56 | test_ask_ac56_an_answer_the_wiki_did_not_confirm_is_not_in_the_next_prompt | |
| ASK-AC56 | test ask ac56 an answer without a valid citation is no source and not stored | per test | per ASK-AC56 | test_ask_ac56_an_answer_without_a_valid_citation_is_no_source_and_not_stored | |
| ASK-AC56 | test ask ac56 an appended turn is pending until confirmed | per test | per ASK-AC56 | test_ask_ac56_an_appended_turn_is_pending_until_confirmed | |
| ASK-AC56 | test ask ac56 confirm answers 204 and puts the turn in the history | per test | per ASK-AC56 | test_ask_ac56_confirm_answers_204_and_puts_the_turn_in_the_history | |
| ASK-AC56 | test ask ac56 confirm with an invalid body is 400 invalid request[bad-conversation] | per test | per ASK-AC56 | test_ask_ac56_confirm_with_an_invalid_body_is_400_invalid_request[bad-conversation] | |
| ASK-AC56 | test ask ac56 confirm with an invalid body is 400 invalid request[bad-turn] | per test | per ASK-AC56 | test_ask_ac56_confirm_with_an_invalid_body_is_400_invalid_request[bad-turn] | |
| ASK-AC56 | test ask ac56 confirm with an invalid body is 400 invalid request[no-conversation] | per test | per ASK-AC56 | test_ask_ac56_confirm_with_an_invalid_body_is_400_invalid_request[no-conversation] | |
| ASK-AC56 | test ask ac56 confirm with an invalid body is 400 invalid request[no-turn] | per test | per ASK-AC56 | test_ask_ac56_confirm_with_an_invalid_body_is_400_invalid_request[no-turn] | |
| ASK-AC56 | test ask ac56 confirm with an invalid body is 400 invalid request[unknown-field-userId] | per test | per ASK-AC56 | test_ask_ac56_confirm_with_an_invalid_body_is_400_invalid_request[unknown-field-userId] | |
| ASK-AC56 | test ask ac56 confirm without valid tokens is 401[header names0-service token missing] | per test | per ASK-AC56 | test_ask_ac56_confirm_without_valid_tokens_is_401[header_names0-service_token_missing] | |
| ASK-AC56 | test ask ac56 confirm without valid tokens is 401[header names1-service token invalid] | per test | per ASK-AC56 | test_ask_ac56_confirm_without_valid_tokens_is_401[header_names1-service_token_invalid] | |
| ASK-AC56 | test ask ac56 confirm without valid tokens is 401[header names2-user token missing] | per test | per ASK-AC56 | test_ask_ac56_confirm_without_valid_tokens_is_401[header_names2-user_token_missing] | |
| ASK-AC56 | test ask ac56 confirm without valid tokens is 401[header names3-user token expired] | per test | per ASK-AC56 | test_ask_ac56_confirm_without_valid_tokens_is_401[header_names3-user_token_expired] | |
| ASK-AC56 | test ask ac56 confirm without valid tokens is 401[header names4-user token invalid] | per test | per ASK-AC56 | test_ask_ac56_confirm_without_valid_tokens_is_401[header_names4-user_token_invalid] | |
| ASK-AC56 | test ask ac56 confirming an unknown turn changes nothing | per test | per ASK-AC56 | test_ask_ac56_confirming_an_unknown_turn_changes_nothing | |
| ASK-AC56 | test ask ac56 pending turns do not push confirmed turns out | per test | per ASK-AC56 | test_ask_ac56_pending_turns_do_not_push_confirmed_turns_out | |
| ASK-AC57 | test ask ac57 the first answer text appears within 10 seconds[Wie beantrage ich Urlaub \xfcber das Personalportal?] | per test | per ASK-AC57 | n/a: stack only, not in KIT_TEST; "test_ask_ac57_the_first_answer_text_appears_within_10_seconds[Wie beantrage ich Urlaub \xfcber das Personalportal?]" pass in local-suites/ai-service-stack.tsv; first text 0.82 s and 1.47 s for the two cases, limit 10 s | |
| ASK-AC57 | test ask ac57 the first answer text appears within 10 seconds[Wie l\xe4uft die Einarbeitung neuer Mitarbeitender ab?] | per test | per ASK-AC57 | n/a: stack only, not in KIT_TEST; "test_ask_ac57_the_first_answer_text_appears_within_10_seconds[Wie l\xe4uft die Einarbeitung neuer Mitarbeitender ab?]" pass in local-suites/ai-service-stack.tsv; first text 0.82 s and 1.47 s for the two cases, limit 10 s | |
| ASK-AC58 | Enter sends, Shift+Enter does not, and the input is cleared | per test | per ASK-AC58 | ASK-AC58: Enter sends, Shift+Enter does not, and the input is cleared | |
| ASK-AC58 | empty and whitespace-only input keep send disabled | per test | per ASK-AC58 | ASK-AC58: empty and whitespace-only input keep send disabled | |
| ASK-AC59 | 2,001 characters disable send and show the limit text | per test | per ASK-AC59 | ASK-AC59: 2,001 characters disable send and show the limit text | |
| ASK-AC59 | 2,001 characters with surrounding whitespace trimmed to 2,000 are allowed | per test | per ASK-AC59 | ASK-AC59: 2,001 characters with surrounding whitespace trimmed to 2,000 are allowed | |
| ASK-AC60 | exactly 2,000 characters are sent | per test | per ASK-AC60 | ASK-AC60: exactly 2,000 characters are sent | |
| ASK-AC61 | accepts a trimmed question of 1 to 2,000 characters with an optional space or page | per test | per ASK-AC61 | ASK-AC61: accepts a trimmed question of 1 to 2,000 characters with an optional space or page | |
| ASK-AC61 | rejects a malformed conversation id | per test | per ASK-AC61 | ASK-AC61: rejects a malformed conversation id | |
| ASK-AC61 | rejects a malformed page id | per test | per ASK-AC61 | ASK-AC61: rejects a malformed page id | |
| ASK-AC61 | rejects a malformed space id | per test | per ASK-AC61 | ASK-AC61: rejects a malformed space id | |
| ASK-AC61 | rejects a missing conversation id | per test | per ASK-AC61 | ASK-AC61: rejects a missing conversation id | |
| ASK-AC61 | rejects a question of 2,001 characters | per test | per ASK-AC61 | ASK-AC61: rejects a question of 2,001 characters | |
| ASK-AC61 | rejects a question that is not a string | per test | per ASK-AC61 | ASK-AC61: rejects a question that is not a string | |
| ASK-AC61 | rejects a whitespace-only question | per test | per ASK-AC61 | ASK-AC61: rejects a whitespace-only question | |
| ASK-AC61 | rejects an empty question | per test | per ASK-AC61 | ASK-AC61: rejects an empty question | |
| ASK-AC61 | rejects both a space and a page | per test | per ASK-AC61 | ASK-AC61: rejects both a space and a page | |
| ASK-AC61 | sends the trimmed question, conversation and scope with both tokens to POST /v1/ask | per test | per ASK-AC61 | ASK-AC61: sends the trimmed question, conversation and scope with both tokens to POST /v1/ask | |
| ASK-AC61 | the question length limit of the DTO equals the contract | per test | per ASK-AC61 | ASK-AC61: the question length limit of the DTO equals the contract | |
| ASK-AC61 | every malformed question request answers 400 invalid_request | per test | per ASK-AC61 | n/a: server e2e only, not in KIT_TEST; "ASK-AC61: every malformed question request answers 400 invalid_request" pass in local-suites/server-e2e.tsv | |
| ASK-AC62 | a page of a space the user left answers 404 page_not_found | per test | per ASK-AC62 | ASK-AC62: a page of a space the user left answers 404 page_not_found | |
| ASK-AC62 | a space id that does not exist answers 404 space_not_found and calls nothing | per test | per ASK-AC62 | ASK-AC62: a space id that does not exist answers 404 space_not_found and calls nothing | |
| ASK-AC62 | a space marked as deleted answers 404 space_not_found and calls nothing | per test | per ASK-AC62 | ASK-AC62: a space marked as deleted answers 404 space_not_found and calls nothing | |
| ASK-AC62 | a space the user is not a member of answers 404 space_not_found and calls nothing | per test | per ASK-AC62 | ASK-AC62: a space the user is not a member of answers 404 space_not_found and calls nothing | |
| ASK-AC62 | a foreign, deleted or unknown space answers the same 404 space_not_found | per test | per ASK-AC62 | n/a: server e2e only, not in KIT_TEST; "ASK-AC62: a foreign, deleted or unknown space answers the same 404 space_not_found" pass in local-suites/server-e2e.tsv | |
| ASK-AC63 | a page id that does not exist answers 404 page_not_found and calls nothing | per test | per ASK-AC63 | ASK-AC63: a page id that does not exist answers 404 page_not_found and calls nothing | |
| ASK-AC63 | a page in the trash answers 404 page_not_found and calls nothing | per test | per ASK-AC63 | ASK-AC63: a page in the trash answers 404 page_not_found and calls nothing | |
| ASK-AC63 | a page the user may not view answers 404 page_not_found and calls nothing | per test | per ASK-AC63 | ASK-AC63: a page the user may not view answers 404 page_not_found and calls nothing | |
| ASK-AC63 | a viewable page scope is sent as pageId only | per test | per ASK-AC63 | ASK-AC63: a viewable page scope is sent as pageId only | |
| ASK-AC63 | a restricted, trashed or unknown page answers the same 404 page_not_found | per test | per ASK-AC63 | n/a: server e2e only, not in KIT_TEST; "ASK-AC63: a restricted, trashed or unknown page answers the same 404 page_not_found" pass in local-suites/server-e2e.tsv | |
| ASK-AC64 | a question without a session answers 401 and calls nothing | per test | per ASK-AC64 | n/a: server e2e only, not in KIT_TEST; "ASK-AC64: a question without a session answers 401 and calls nothing" pass in local-suites/server-e2e.tsv | |
| ASK-AC65 | a switched-off assistant answers 503 assistant_disabled and calls nothing | per test | per ASK-AC65 | ASK-AC65: a switched-off assistant answers 503 assistant_disabled and calls nothing | |
| ASK-AC65 | an error before the stream is thrown before any header is written | per test | per ASK-AC65 | ASK-AC65: an error before the stream is thrown before any header is written | |
| ASK-AC65 | a switched-off assistant answers 503 assistant_disabled and calls nothing | per test | per ASK-AC65 | n/a: server e2e only, not in KIT_TEST; "ASK-AC65: a switched-off assistant answers 503 assistant_disabled and calls nothing" pass in local-suites/server-e2e.tsv | |
| ASK-AC66 | HTTP 400 from the AI service answers 503 assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: HTTP 400 from the AI service answers 503 assistant_unavailable | |
| ASK-AC66 | HTTP 401 from the AI service answers 503 assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: HTTP 401 from the AI service answers 503 assistant_unavailable | |
| ASK-AC66 | HTTP 500 from the AI service answers 503 assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: HTTP 500 from the AI service answers 503 assistant_unavailable | |
| ASK-AC66 | a delta without text ends the stream as model_unavailable | per test | per ASK-AC66 | ASK-AC66: a delta without text ends the stream as model_unavailable | |
| ASK-AC66 | a frame that is not JSON ends the stream as model_unavailable | per test | per ASK-AC66 | ASK-AC66: a frame that is not JSON ends the stream as model_unavailable | |
| ASK-AC66 | a refused connection answers 503 assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: a refused connection answers 503 assistant_unavailable | |
| ASK-AC66 | a source with a missing field ends the stream as model_unavailable | per test | per ASK-AC66 | ASK-AC66: a source with a missing field ends the stream as model_unavailable | |
| ASK-AC66 | a stream that ends without a final event becomes model_unavailable | per test | per ASK-AC66 | ASK-AC66: a stream that ends without a final event becomes model_unavailable | |
| ASK-AC66 | an AI service that sends no response head within the timeout answers 503 assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: an AI service that sends no response head within the timeout answers 503 assistant_unavailable | |
| ASK-AC66 | an error event marks the turn error and keeps the partial text | per test | per ASK-AC66 | ASK-AC66: an error event marks the turn error and keeps the partial text | |
| ASK-AC66 | an error with an unknown code ends the stream as model_unavailable | per test | per ASK-AC66 | ASK-AC66: an error with an unknown code ends the stream as model_unavailable | |
| ASK-AC66 | an unknown event type ends the stream as model_unavailable | per test | per ASK-AC66 | ASK-AC66: an unknown event type ends the stream as model_unavailable | |
| ASK-AC66 | assistant_unavailable drops the turn and raises the unavailable flag | per test | per ASK-AC66 | ASK-AC66: assistant_unavailable drops the turn and raises the unavailable flag | |
| ASK-AC66 | assistant_unavailable keeps earlier turns, and clearUnavailable lowers the flag | per test | per ASK-AC66 | ASK-AC66: assistant_unavailable keeps earlier turns, and clearUnavailable lowers the flag | |
| ASK-AC66 | assistant_unavailable shows state A4 with input and send disabled until retry succeeds | per test | per ASK-AC66 | ASK-AC66: assistant_unavailable shows state A4 with input and send disabled until retry succeeds | |
| ASK-AC66 | client error codes cover the contract's errors | per test | per ASK-AC66 | ASK-AC66: client error codes cover the contract's errors | |
| ASK-AC66 | does not add an error after a final event | per test | per ASK-AC66 | ASK-AC66: does not add an error after a final event | |
| ASK-AC66 | maps 401 without a code to unauthorized | per test | per ASK-AC66 | ASK-AC66: maps 401 without a code to unauthorized | |
| ASK-AC66 | maps HTTP 400 with code invalid_request to a typed error | per test | per ASK-AC66 | ASK-AC66: maps HTTP 400 with code invalid_request to a typed error | |
| ASK-AC66 | maps HTTP 404 with code page_not_found to a typed error | per test | per ASK-AC66 | ASK-AC66: maps HTTP 404 with code page_not_found to a typed error | |
| ASK-AC66 | maps HTTP 404 with code space_not_found to a typed error | per test | per ASK-AC66 | ASK-AC66: maps HTTP 404 with code space_not_found to a typed error | |
| ASK-AC66 | maps HTTP 503 with code assistant_disabled to a typed error | per test | per ASK-AC66 | ASK-AC66: maps HTTP 503 with code assistant_disabled to a typed error | |
| ASK-AC66 | maps HTTP 503 with code assistant_unavailable to a typed error | per test | per ASK-AC66 | ASK-AC66: maps HTTP 503 with code assistant_unavailable to a typed error | |
| ASK-AC66 | maps a network failure to assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: maps a network failure to assistant_unavailable | |
| ASK-AC66 | maps a non-JSON error body to assistant_unavailable | per test | per ASK-AC66 | ASK-AC66: maps a non-JSON error body to assistant_unavailable | |
| ASK-AC66 | other request errors mark the turn error | per test | per ASK-AC66 | ASK-AC66: other request errors mark the turn error | |
| ASK-AC66 | page_not_found marks the turn no_source so nothing is revealed | per test | per ASK-AC66 | ASK-AC66: page_not_found marks the turn no_source so nothing is revealed | |
| ASK-AC66 | space_not_found marks the turn no_source so nothing is revealed | per test | per ASK-AC66 | ASK-AC66: space_not_found marks the turn no_source so nothing is revealed | |
| ASK-AC66 | HTTP 401 and 500 from the AI service answer 503 assistant_unavailable | per test | per ASK-AC66 | n/a: server e2e only, not in KIT_TEST; "ASK-AC66: HTTP 401 and 500 from the AI service answer 503 assistant_unavailable" pass in local-suites/server-e2e.tsv | |
| ASK-AC66 | a refused connection answers 503 assistant_unavailable | per test | per ASK-AC66 | n/a: server e2e only, not in KIT_TEST; "ASK-AC66: a refused connection answers 503 assistant_unavailable" pass in local-suites/server-e2e.tsv | |
| ASK-AC67 | an error event from the AI service is relayed as model_unavailable | per test | per ASK-AC67 | ASK-AC67: an error event from the AI service is relayed as model_unavailable | |
| ASK-AC67 | shows the model error when no text arrived | per test | per ASK-AC67 | ASK-AC67: shows the model error when no text arrived | |
| ASK-AC67 | test ask ac67 ask settings defaults | per test | per ASK-AC67 | test_ask_ac67_ask_settings_defaults | |
| ASK-AC67 | test ask ac67 ask settings require ai wiki url | per test | per ASK-AC67 | test_ask_ac67_ask_settings_require_ai_wiki_url | |
| ASK-AC67 | test ask ac67 connection refused raises model unavailable | per test | per ASK-AC67 | test_ask_ac67_connection_refused_raises_model_unavailable | |
| ASK-AC67 | test ask ac67 deltas are yielded in order | per test | per ASK-AC67 | test_ask_ac67_deltas_are_yielded_in_order | |
| ASK-AC67 | test ask ac67 empty and role only deltas are skipped | per test | per ASK-AC67 | test_ask_ac67_empty_and_role_only_deltas_are_skipped | |
| ASK-AC67 | test ask ac67 malformed stream raises model unavailable | per test | per ASK-AC67 | test_ask_ac67_malformed_stream_raises_model_unavailable | |
| ASK-AC67 | test ask ac67 model name is exposed | per test | per ASK-AC67 | test_ask_ac67_model_name_is_exposed | |
| ASK-AC67 | test ask ac67 request body and url | per test | per ASK-AC67 | test_ask_ac67_request_body_and_url | |
| ASK-AC67 | test ask ac67 server error raises model unavailable | per test | per ASK-AC67 | test_ask_ac67_server_error_raises_model_unavailable | |
| ASK-AC67 | test ask ac67 stream without done raises model unavailable | per test | per ASK-AC67 | test_ask_ac67_stream_without_done_raises_model_unavailable | |
| ASK-AC67 | an error event after text ends the stream with model_unavailable | per test | per ASK-AC67 | n/a: server e2e only, not in KIT_TEST; "ASK-AC67: an error event after text ends the stream with model_unavailable" pass in local-suites/server-e2e.tsv | |
| ASK-AC68 | test ask ac68 a model that sends only empty chunks past 60 seconds fails and closes | per test | per ASK-AC68 | test_ask_ac68_a_model_that_sends_only_empty_chunks_past_60_seconds_fails_and_closes | |
| ASK-AC68 | test ask ac68 a stream without extra info leaves the read timeout to end the call | per test | per ASK-AC68 | test_ask_ac68_a_stream_without_extra_info_leaves_the_read_timeout_to_end_the_call | |
| ASK-AC68 | test ask ac68 an empty chunk then silence fails at the deadline not at the read timeout | per test | per ASK-AC68 | test_ask_ac68_an_empty_chunk_then_silence_fails_at_the_deadline_not_at_the_read_timeout | |
| ASK-AC68 | test ask ac68 an unexpected socket lookup error is logged not raised in the timer thread | per test | per ASK-AC68 | test_ask_ac68_an_unexpected_socket_lookup_error_is_logged_not_raised_in_the_timer_thread | |
| ASK-AC68 | test ask ac68 default client waits 60 seconds to read and 10 to connect | per test | per ASK-AC68 | test_ask_ac68_default_client_waits_60_seconds_to_read_and_10_to_connect | |
| ASK-AC68 | test ask ac68 read timeout raises model unavailable | per test | per ASK-AC68 | test_ask_ac68_read_timeout_raises_model_unavailable | |
| ASK-AC68 | test ask ac68 text that starts within 60 seconds may continue past them | per test | per ASK-AC68 | test_ask_ac68_text_that_starts_within_60_seconds_may_continue_past_them | |
| ASK-AC69 | a malformed line ends with model_unavailable | per test | per ASK-AC69 | ASK-AC69: a malformed line ends with model_unavailable | |
| ASK-AC69 | a stream that breaks off ends with model_unavailable | per test | per ASK-AC69 | ASK-AC69: a stream that breaks off ends with model_unavailable | |
| ASK-AC69 | a stream that ends without a final event ends with model_unavailable | per test | per ASK-AC69 | ASK-AC69: a stream that ends without a final event ends with model_unavailable | |
| ASK-AC69 | shows the partial text, then the model error, without sources | per test | per ASK-AC69 | ASK-AC69: shows the partial text, then the model error, without sources | |
| ASK-AC69 | test ask ac69 closing the generator closes the response | per test | per ASK-AC69 | test_ask_ac69_closing_the_generator_closes_the_response | |
| ASK-AC69 | test ask ac69 error after first delta keeps the text then raises | per test | per ASK-AC69 | test_ask_ac69_error_after_first_delta_keeps_the_text_then_raises | |
| ASK-AC69 | a stream that breaks off after text ends with model_unavailable, not a 500 | per test | per ASK-AC69 | n/a: server e2e only, not in KIT_TEST; "ASK-AC69: a stream that breaks off after text ends with model_unavailable, not a 500" pass in local-suites/server-e2e.tsv | |
| ASK-AC70 | a failing final check ends with model_unavailable | per test | per ASK-AC70 | ASK-AC70: a failing final check ends with model_unavailable | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[4xx] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[4xx] | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[5xx] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[5xx] | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[disabled] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[disabled] | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[expired-token] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[expired-token] | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[malformed] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[malformed] | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[not-json] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[not-json] | |
| ASK-AC70 | test ask ac70 a failing filter gives model unavailable without calling the model[refused] | per test | per ASK-AC70 | test_ask_ac70_a_failing_filter_gives_model_unavailable_without_calling_the_model[refused] | |
| ASK-AC70 | test ask ac70 filter pages maps failures to bridge errors[5xx] | per test | per ASK-AC70 | test_ask_ac70_filter_pages_maps_failures_to_bridge_errors[5xx] | |
| ASK-AC70 | test ask ac70 filter pages maps failures to bridge errors[disabled] | per test | per ASK-AC70 | test_ask_ac70_filter_pages_maps_failures_to_bridge_errors[disabled] | |
| ASK-AC70 | test ask ac70 filter pages maps failures to bridge errors[non-string-id] | per test | per ASK-AC70 | test_ask_ac70_filter_pages_maps_failures_to_bridge_errors[non-string-id] | |
| ASK-AC70 | test ask ac70 filter pages maps failures to bridge errors[not-an-object] | per test | per ASK-AC70 | test_ask_ac70_filter_pages_maps_failures_to_bridge_errors[not-an-object] | |
| ASK-AC70 | test ask ac70 filter pages maps failures to bridge errors[refused] | per test | per ASK-AC70 | test_ask_ac70_filter_pages_maps_failures_to_bridge_errors[refused] | |
| ASK-AC70 | test ask ac70 filter pages maps failures to bridge errors[user-token] | per test | per ASK-AC70 | test_ask_ac70_filter_pages_maps_failures_to_bridge_errors[user-token] | |
| ASK-AC71 | test ask ac71 a missing or wrong service token is 401[None-service token missing] | per test | per ASK-AC71 | test_ask_ac71_a_missing_or_wrong_service_token_is_401[None-service_token_missing] | |
| ASK-AC71 | test ask ac71 a missing or wrong service token is 401[xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-service token invalid] | per test | per ASK-AC71 | test_ask_ac71_a_missing_or_wrong_service_token_is_401[xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-service_token_invalid] | |
| ASK-AC71 | test ask ac71 a missing user token is 401 | per test | per ASK-AC71 | test_ask_ac71_a_missing_user_token_is_401 | |
| ASK-AC71 | test ask ac71 an expired user token is 401 | per test | per ASK-AC71 | test_ask_ac71_an_expired_user_token_is_401 | |
| ASK-AC71 | test ask ac71 the service token is checked before the body | per test | per ASK-AC71 | test_ask_ac71_the_service_token_is_checked_before_the_body | |
| ASK-AC71 | test ask ac71 the session holds space ids and the raw token | per test | per ASK-AC71 | test_ask_ac71_the_session_holds_space_ids_and_the_raw_token | |
| ASK-AC71 | test ask ac71 the session route still answers user and workspace | per test | per ASK-AC71 | test_ask_ac71_the_session_route_still_answers_user_and_workspace | |
| ASK-AC72 | test ask ac72 a malformed user token is user token invalid | per test | per ASK-AC72 | test_ask_ac72_a_malformed_user_token_is_user_token_invalid | |
| ASK-AC72 | test ask ac72 an invalid user token is user token invalid[alg-none] | per test | per ASK-AC72 | test_ask_ac72_an_invalid_user_token_is_user_token_invalid[alg-none] | |
| ASK-AC72 | test ask ac72 an invalid user token is user token invalid[other-secret] | per test | per ASK-AC72 | test_ask_ac72_an_invalid_user_token_is_user_token_invalid[other-secret] | |
| ASK-AC72 | test ask ac72 an invalid user token is user token invalid[space-ids-ints] | per test | per ASK-AC72 | test_ask_ac72_an_invalid_user_token_is_user_token_invalid[space-ids-ints] | |
| ASK-AC72 | test ask ac72 an invalid user token is user token invalid[space-ids-string] | per test | per ASK-AC72 | test_ask_ac72_an_invalid_user_token_is_user_token_invalid[space-ids-string] | |
| ASK-AC72 | test ask ac72 an invalid user token is user token invalid[type] | per test | per ASK-AC72 | test_ask_ac72_an_invalid_user_token_is_user_token_invalid[type] | |
| ASK-AC72 | test ask ac72 an invalid user token is user token invalid[wrong-audience] | per test | per ASK-AC72 | test_ask_ac72_an_invalid_user_token_is_user_token_invalid[wrong-audience] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[2001-chars] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[2001-chars] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[bad-conversation] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[bad-conversation] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[bad-page] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[bad-page] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[bad-space] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[bad-space] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[blank] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[blank] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[both-scopes] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[both-scopes] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[empty] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[empty] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[no-conversation] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[no-conversation] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[no-question] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[no-question] | |
| ASK-AC73 | test ask ac73 an invalid body is 400 invalid request[unknown-field-userId] | per test | per ASK-AC73 | test_ask_ac73_an_invalid_body_is_400_invalid_request[unknown-field-userId] | |
| ASK-AC73 | test ask ac73 the limits and one scope are accepted[2000-chars-padded] | per test | per ASK-AC73 | test_ask_ac73_the_limits_and_one_scope_are_accepted[2000-chars-padded] | |
| ASK-AC73 | test ask ac73 the limits and one scope are accepted[2000-chars] | per test | per ASK-AC73 | test_ask_ac73_the_limits_and_one_scope_are_accepted[2000-chars] | |
| ASK-AC73 | test ask ac73 the limits and one scope are accepted[page] | per test | per ASK-AC73 | test_ask_ac73_the_limits_and_one_scope_are_accepted[page] | |
| ASK-AC73 | test ask ac73 the limits and one scope are accepted[space] | per test | per ASK-AC73 | test_ask_ac73_the_limits_and_one_scope_are_accepted[space] | |
| ASK-AC73 | test ask ac73 the question is trimmed before it reaches the pipeline | per test | per ASK-AC73 | test_ask_ac73_the_question_is_trimmed_before_it_reaches_the_pipeline | |
| ASK-AC74 | test ask ac74 a failing search gives model unavailable and logs model failed[database-error] | per test | per ASK-AC74 | test_ask_ac74_a_failing_search_gives_model_unavailable_and_logs_model_failed[database-error] | |
| ASK-AC74 | test ask ac74 a failing search gives model unavailable and logs model failed[embedding] | per test | per ASK-AC74 | test_ask_ac74_a_failing_search_gives_model_unavailable_and_logs_model_failed[embedding] | |
| ASK-AC74 | test ask ac74 a failing search gives model unavailable and logs model failed[lost-database] | per test | per ASK-AC74 | test_ask_ac74_a_failing_search_gives_model_unavailable_and_logs_model_failed[lost-database] | |
| ASK-AC74 | test ask ac74 an embedding that fails raises naming the model | per test | per ASK-AC74 | test_ask_ac74_an_embedding_that_fails_raises_naming_the_model | |
| ASK-AC74 | test ask ac74 each outcome logs exactly one line naming it[answered] | per test | per ASK-AC74 | test_ask_ac74_each_outcome_logs_exactly_one_line_naming_it[answered] | |
| ASK-AC74 | test ask ac74 each outcome logs exactly one line naming it[filter failed] | per test | per ASK-AC74 | test_ask_ac74_each_outcome_logs_exactly_one_line_naming_it[filter_failed] | |
| ASK-AC74 | test ask ac74 each outcome logs exactly one line naming it[model failed] | per test | per ASK-AC74 | test_ask_ac74_each_outcome_logs_exactly_one_line_naming_it[model_failed] | |
| ASK-AC74 | test ask ac74 each outcome logs exactly one line naming it[no source] | per test | per ASK-AC74 | test_ask_ac74_each_outcome_logs_exactly_one_line_naming_it[no_source] | |
| ASK-AC74 | test ask ac74 each outcome logs exactly one line naming it[stopped] | per test | per ASK-AC74 | test_ask_ac74_each_outcome_logs_exactly_one_line_naming_it[stopped] | |
| ASK-AC74 | test ask ac74 the log line holds conversation mode model counts and first text time | per test | per ASK-AC74 | test_ask_ac74_the_log_line_holds_conversation_mode_model_counts_and_first_text_time | |
| ASK-AC75 | a line that is not JSON is logged without its content | per test | per ASK-AC75 | ASK-AC75: a line that is not JSON is logged without its content | |
| ASK-AC75 | test ask ac75 log lines hold no question answer page text title or token[answered] | per test | per ASK-AC75 | test_ask_ac75_log_lines_hold_no_question_answer_page_text_title_or_token[answered] | |
| ASK-AC75 | test ask ac75 log lines hold no question answer page text title or token[filter failed] | per test | per ASK-AC75 | test_ask_ac75_log_lines_hold_no_question_answer_page_text_title_or_token[filter_failed] | |
| ASK-AC75 | test ask ac75 log lines hold no question answer page text title or token[model failed] | per test | per ASK-AC75 | test_ask_ac75_log_lines_hold_no_question_answer_page_text_title_or_token[model_failed] | |
| ASK-AC75 | test ask ac75 log lines hold no question answer page text title or token[no source] | per test | per ASK-AC75 | test_ask_ac75_log_lines_hold_no_question_answer_page_text_title_or_token[no_source] | |
| ASK-AC75 | test ask ac75 log lines hold no question answer page text title or token[stopped] | per test | per ASK-AC75 | test_ask_ac75_log_lines_hold_no_question_answer_page_text_title_or_token[stopped] | |
| ASK-AC76 | test ask ac76 page scope puts a section and a pdf of that page in the prompt | per test | per ASK-AC76 | test_ask_ac76_page_scope_puts_a_section_and_a_pdf_of_that_page_in_the_prompt | |
