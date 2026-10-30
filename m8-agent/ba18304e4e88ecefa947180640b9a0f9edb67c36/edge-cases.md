# Edge cases

Local-only rows (n/a) ran with qwen3:8b on this Mac through scripts/run-agent-check.sh (2 passed, 28.3 s) and in the ai-service integration run (72 passed, 30.10.2026) and the server e2e run (157 passed, 30.10.2026); browser rows ran in apps/client/e2e/agent.screenshots.ts in verify step 4.

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| AGENT-AC1 | happy path | The first open | shows the tabs Fragen and Aufgabe with Fragen selected | AGENT-AC1: the first open shows the tabs Fragen and Aufgabe with Fragen selected | |
| AGENT-AC1 | happy path | the case named in the test | the panel shows the tabs Fragen and Aufgabe with Fragen selected | n/a: Playwright, "AGENT-AC1: the panel shows the tabs Fragen and Aufgabe with Fragen selected" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC2 | happy path | the case named in the test | shows the selector, hint, examples and the input | AGENT-AC2: shows the selector, hint, examples and the input | |
| AGENT-AC2 | happy path | the case named in the test | G1 shows the space, the hint, the examples and the input | n/a: Playwright, "AGENT-AC2: G1 shows the space, the hint, the examples and the input" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC3 | error path | An unavailable assistant | shows state A4 with a retry button in the Aufgabe tab | AGENT-AC3: an unavailable assistant shows state A4 with a retry button in the Aufgabe tab | |
| AGENT-AC3 | error path | An unavailable assistant | shows state A4 in the Fragen tab too | AGENT-AC3: an unavailable assistant shows state A4 in the Fragen tab too | |
| AGENT-AC3 | error path | An unreachable service during the | start shows state A4 and retry clears it | AGENT-AC3: an unreachable service during the start shows state A4 and retry clears it | |
| AGENT-AC4 | empty data | the case named in the test | lists the user's spaces alphabetically and no other | AGENT-AC4: lists the user | |
| AGENT-AC5 | happy path | the case named in the test | preselects the space of the open page | AGENT-AC5: preselects the space of the open page | |
| AGENT-AC6 | happy path | Falls back to the first space when the page's space | is not listed | AGENT-AC6: falls back to the first space when the page | |
| AGENT-AC7 | empty data | An example fills the input and | starts nothing | AGENT-AC7: an example fills the input and starts nothing | |
| AGENT-AC8 | limit | 2,001 characters disable Starten and | show the limit hint | AGENT-AC8: 2,001 characters disable Starten and show the limit hint | |
| AGENT-AC8 | limit | 2,000 characters surrounded by whitespace | can start | AGENT-AC8: 2,000 characters surrounded by whitespace can start | |
| AGENT-AC9 | empty data | the case named in the test | whitespace only disables Starten | AGENT-AC9: whitespace only disables Starten | |
| AGENT-AC10 | empty data | A user without spaces sees Kein Bereich and | cannot start | AGENT-AC10: a user without spaces sees Kein Bereich and cannot start | |
| AGENT-AC11 | happy path | Enter starts the | run with the trimmed task in the chosen space | AGENT-AC11: Enter starts the run with the trimmed task in the chosen space | |
| AGENT-AC12 | happy path | An ask turn | is still there after switching to Aufgabe and back | AGENT-AC12: an ask turn is still there after switching to Aufgabe and back | |
| AGENT-AC13 | happy path | A running agent task | is not stopped by switching tabs | AGENT-AC13: a running agent task is not stopped by switching tabs | |
| AGENT-AC14 | happy path | the case named in the test | Neue Unterhaltung is shown on Fragen and hidden on Aufgabe | AGENT-AC14: Neue Unterhaltung is shown on Fragen and hidden on Aufgabe | |
| AGENT-AC15 | happy path | Zu dieser Seite fragen selects Fragen with the scope Diese Seite while Aufgabe | was selected | AGENT-AC15: Zu dieser Seite fragen selects Fragen with the scope Diese Seite while Aufgabe was selected | |
| AGENT-AC15 | happy path | The last selected tab | is kept when the aside is opened again | AGENT-AC15: the last selected tab is kept when the aside is opened again | |
| AGENT-AC16 | limit | the case named in the test | shows task and space, step 0 and Abbrechen before the first step | AGENT-AC16: shows task and space, step 0 and Abbrechen before the first step | |
| AGENT-AC16 | happy path | Abbrechen stops the | run and keeps header and step lines | AGENT-AC16: Abbrechen stops the run and keeps header and step lines | |
| AGENT-AC16 | happy path | the case named in the test | an ended run keeps header and step lines | AGENT-AC16: an ended run keeps header and step lines | |
| AGENT-AC16 | limit | run started, no step ended yet | task, space, Schritt 0 von höchstens 20, Abbrechen | n/a: Playwright, "AGENT-AC16: G2 shows the task, Schritt 0 von höchstens 20 and Abbrechen before the first step ended" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC17 | happy path | A search step | shows its line and counts the step | AGENT-AC17: a search step shows its line and counts the step | |
| AGENT-AC17 | happy path | Run_in_progress shows the hint in the | start state | AGENT-AC17: run_in_progress shows the hint in the start state | |
| AGENT-AC17 | happy path | The run endpoint | streams with the contract content type | AGENT-AC17: the run endpoint streams with the contract content type | |
| AGENT-AC17 | happy path | Every event the wiki | streams has exactly the fields of the contract, the same as the AI service sends | AGENT-AC17: every event the wiki streams has exactly the fields of the contract, the same as the AI service sends | |
| AGENT-AC17 | happy path | Relays the run, step, proposal and | end events in their order | AGENT-AC17: relays the run, step, proposal and end events in their order | |
| AGENT-AC17 | happy path | the case named in the test | relays only the fields of the contract | AGENT-AC17: relays only the fields of the contract | |
| AGENT-AC17 | happy path | Writes each event as one server-sent event and | ends the response | AGENT-AC17: writes each event as one server-sent event and ends the response | |
| AGENT-AC17 | happy path | the case named in the test | a search step reports its query and count | test_agent_ac17_a_search_step_reports_its_query_and_count | |
| AGENT-AC18 | limit | A search with one or no page | ends in 1 Seite or keine Seiten | AGENT-AC18: a search with one or no page ends in 1 Seite or keine Seiten | |
| AGENT-AC18 | empty data | A search step | counts one page or none | test_agent_ac18_a_search_step_counts_one_page_or_none | |
| AGENT-AC19 | happy path | A read step | shows the page title | AGENT-AC19: a read step shows the page title | |
| AGENT-AC19 | happy path | the case named in the test | a read step reports the page title and gives numbered blocks | test_agent_ac19_a_read_step_reports_the_page_title_and_gives_numbered_blocks | |
| AGENT-AC20 | happy path | A propose step | shows Vorschlag erstellt | AGENT-AC20: a propose step shows Vorschlag erstellt | |
| AGENT-AC20 | happy path | A proposal step | is followed by the proposal event | test_agent_ac20_a_proposal_step_is_followed_by_the_proposal_event | |
| AGENT-AC21 | happy path | Shows the run time since the | start and ticks every second | AGENT-AC21: shows the run time since the start and ticks every second | |
| AGENT-AC22 | error path | A refused step | reads Schritt ohne Ergebnis | AGENT-AC22: a refused step reads Schritt ohne Ergebnis | |
| AGENT-AC22 | missing permission or unreadable page | An unknown tool | is refused and the run goes on | test_agent_ac22_an_unknown_tool_is_refused_and_the_run_goes_on | |
| AGENT-AC22 | error path | Invalid arguments are refused and the | run goes on | test_agent_ac22_invalid_arguments_are_refused_and_the_run_goes_on | |
| AGENT-AC22 | error path | A refused proposal gives its reason and | stores nothing | test_agent_ac22_a_refused_proposal_gives_its_reason_and_stores_nothing | |
| AGENT-AC23 | missing permission or unreadable page | the case named in the test | a bridge failure at the task token exchange propagates before storing | test_agent_ac23_a_bridge_failure_at_the_task_token_exchange_propagates_before_storing | |
| AGENT-AC23 | missing permission or unreadable page | A failing wiki | is answered as unavailable not as not found | test_agent_ac23_a_failing_wiki_is_answered_as_unavailable_not_as_not_found | |
| AGENT-AC23 | missing permission or unreadable page | the case named in the test | failures are unavailable and not not found | test_agent_ac23_failures_are_unavailable_and_not_not_found | |
| AGENT-AC24 | double submit or concurrent | the case named in the test | two steps show in order and count 2 | AGENT-AC24: two steps show in order and count 2 | |
| AGENT-AC24 | happy path | two ended steps in the browser | search line above read line, Schritt 2 von höchstens 20 | n/a: Playwright, "AGENT-AC24: G2 shows the search line before the read line and Schritt 2 von höchstens 20" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC24 | double submit or concurrent | Two calls of one | answer run in order as two steps | test_agent_ac24_two_calls_of_one_answer_run_in_order_as_two_steps | |
| AGENT-AC25 | happy path | Search and read always | send the run space | test_agent_ac25_search_and_read_always_send_the_run_space | |
| AGENT-AC25 | missing permission or unreadable page | the case named in the test | results of another space never reach the model | test_agent_ac25_results_of_another_space_never_reach_the_model | |
| AGENT-AC26 | missing permission or unreadable page | A page of another space the user may view | is refused as not found | AGENT-AC26: a page of another space the user may view is refused as not found | |
| AGENT-AC26 | missing permission or unreadable page | A page out of reach | is not found with no page text | test_agent_ac26_a_page_out_of_reach_is_not_found_with_no_page_text | |
| AGENT-AC26 | missing permission or unreadable page | Read blocks sends the task token and | parses blocks | test_agent_ac26_read_blocks_sends_the_task_token_and_parses_blocks | |
| AGENT-AC26 | missing permission or unreadable page | the case named in the test | tools reject the user token | test_agent_ac26_tools_reject_the_user_token | |
| AGENT-AC26 | happy path | the case named in the test | search returns viewable pages of the space | test_agent_ac26_search_returns_viewable_pages_of_the_space | |
| AGENT-AC27 | missing permission or unreadable page | A restricted page | is refused with the same answer as an unknown id | AGENT-AC27: a restricted page is refused with the same answer as an unknown id | |
| AGENT-AC27 | missing permission or unreadable page | the case named in the test | unreadable page is not found | test_agent_ac27_ac28_unreadable_page_is_not_found | |
| AGENT-AC28 | missing permission or unreadable page | A trashed page | is refused with the same answer as an unknown id | AGENT-AC28: a trashed page is refused with the same answer as an unknown id | |
| AGENT-AC28 | missing permission or unreadable page | A page deleted after the access check and held by no node | is refused as not found | AGENT-AC28: a page deleted after the access check and held by no node is refused as not found | |
| AGENT-AC28 | missing permission or unreadable page | the case named in the test | unreadable page is not found | test_agent_ac27_ac28_unreadable_page_is_not_found | |
| AGENT-AC29 | missing permission or unreadable page | A page of a | run space marked as deleted is refused as not found | AGENT-AC29: a page of a run space marked as deleted is refused as not found | |
| AGENT-AC29 | missing permission or unreadable page | A search in a space the wiki no longer knows | is refused as not found | test_agent_ac29_a_search_in_a_space_the_wiki_no_longer_knows_is_refused_as_not_found | |
| AGENT-AC29 | missing permission or unreadable page | Page in another space or unknown | is not found | test_agent_ac29_page_in_another_space_or_unknown_is_not_found | |
| AGENT-AC30 | missing permission or unreadable page | A restricted page | is not in the search answer | test_agent_ac30_a_restricted_page_is_not_in_the_search_answer | |
| AGENT-AC31 | missing permission or unreadable page | After the user | is removed from the run space the next read is refused as not found | AGENT-AC31: after the user is removed from the run space the next read is refused as not found | |
| AGENT-AC31 | missing permission or unreadable page | A member removed from the | run space gets 404 page_not_found on read-blocks with a still valid token | n/a: e2e only, "AGENT-AC31: a member removed from the run space gets 404 page_not_found on read-blocks with a still valid token" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC31 | missing permission or unreadable page | the case named in the test | not found variants share one handling | test_agent_ac31_not_found_variants_share_one_handling | |
| AGENT-AC32 | missing permission or unreadable page | the case named in the test | the route accepts a task token | AGENT-AC32: the route accepts a task token | |
| AGENT-AC32 | missing permission or unreadable page | Three minutes into a | run the task token still reads the blocks for the run user | AGENT-AC32: three minutes into a run the task token still reads the blocks for the run user | |
| AGENT-AC32 | missing permission or unreadable page | Three minutes into a | run the task token still reads blocks while the user token has expired | n/a: e2e only, "AGENT-AC32: three minutes into a run the task token still reads blocks while the user token has expired" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC33 | happy path | An edit made to the live document | is in the next read | AGENT-AC33: an edit made to the live document is in the next read | |
| AGENT-AC33 | happy path | the case named in the test | reading does not change the document | AGENT-AC33: reading does not change the document | |
| AGENT-AC33 | empty data | the case named in the test | readAgentBlocks reads the loaded live document without opening a direct connection | AGENT-AC33: readAgentBlocks reads the loaded live document without opening a direct connection | |
| AGENT-AC33 | empty data | Read-blocks holds a character typed in an open editor that the wiki | has not saved, and stores nothing | n/a: e2e only, "AGENT-AC33: read-blocks holds a character typed in an open editor that the wiki has not saved, and stores nothing" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC34 | happy path | the case named in the test | numbers heading, paragraph, list items and table cells in document order | AGENT-AC34: numbers heading, paragraph, list items and table cells in document order | |
| AGENT-AC34 | happy path | the case named in the test | counts toggle content but not its summary | AGENT-AC34: counts toggle content but not its summary | |
| AGENT-AC34 | happy path | the case named in the test | counts paragraphs in task lists, quotes and callouts | AGENT-AC34: counts paragraphs in task lists, quotes and callouts | |
| AGENT-AC34 | empty data | the case named in the test | skips whitespace-only paragraphs and headings | AGENT-AC34: skips whitespace-only paragraphs and headings | |
| AGENT-AC34 | happy path | the case named in the test | a block takes the nearest preceding heading as context | AGENT-AC34: a block takes the nearest preceding heading as context | |
| AGENT-AC34 | happy path | A heading block | is marked in the read | test_agent_ac34_a_heading_block_is_marked_in_the_read | |
| AGENT-AC34 | happy path | the case named in the test | read blocks parses is heading | test_agent_ac34_read_blocks_parses_is_heading | |
| AGENT-AC34 | happy path | the case named in the test | read blocks is heading must be a bool | test_agent_ac34_read_blocks_is_heading_must_be_a_bool | |
| AGENT-AC35 | limit | the case named in the test | a read keeps the blocks within 6000 characters and notes the rest | test_agent_ac35_a_read_keeps_the_blocks_within_6000_characters_and_notes_the_rest | |
| AGENT-AC35 | limit | A block ending exactly at 6000 characters | is kept | test_agent_ac35_a_block_ending_exactly_at_6000_characters_is_kept | |
| AGENT-AC36 | happy path | the case named in the test | page text cannot make the agent write | test_agent_ac36_page_text_cannot_make_the_agent_write | |
| AGENT-AC37 | error path | Every bridge endpoint for the AI service | declares that it does not change page content | AGENT-AC37: every bridge endpoint for the AI service declares that it does not change page content | |
| AGENT-AC37 | error path | Every route of the internal controller | is a bridge endpoint of the contract | AGENT-AC37: every route of the internal controller is a bridge endpoint of the contract | |
| AGENT-AC37 | empty data | ReadAgentBlocks answers null and | opens no direct connection when the document is not loaded | AGENT-AC37: readAgentBlocks answers null and opens no direct connection when the document is not loaded | |
| AGENT-AC37 | empty data | When no collaboration node | holds the page (%s), the read comes from the stored page without loading it | AGENT-AC37: when no collaboration node holds the page ( | |
| AGENT-AC37 | empty data | A read through read-blocks | attempts no store and leaves the stored page and its updated_at unchanged | n/a: e2e only, "AGENT-AC37: a read through read-blocks attempts no store and leaves the stored page and its updated_at unchanged" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC38 | happy path | Accepted change holds old text of the | read and new text | test_agent_ac38_accepted_change_holds_old_text_of_the_read_and_new_text | |
| AGENT-AC38 | happy path | the case named in the test | json form has the stored shape | test_agent_ac38_json_form_has_the_stored_shape | |
| AGENT-AC38 | happy path | the case named in the test | new text is kept as given | test_agent_ac38_new_text_is_kept_as_given | |
| AGENT-AC39 | error path | Refuses a page that | was not read | test_agent_ac39_refuses_a_page_that_was_not_read | |
| AGENT-AC40 | error path | Refuses a block number not in the | read | test_agent_ac40_refuses_a_block_number_not_in_the_read | |
| AGENT-AC40 | error path | Refuses a block that | is not an int | test_agent_ac40_refuses_a_block_that_is_not_an_int | |
| AGENT-AC41 | error path | the case named in the test | refuses unusable new texts | test_agent_ac41_refuses_unusable_new_texts | |
| AGENT-AC41 | limit | the case named in the test | accepts 2000 characters | test_agent_ac41_accepts_2000_characters | |
| AGENT-AC41 | error path | Refuses a new text that | is not a string | test_agent_ac41_refuses_a_new_text_that_is_not_a_string | |
| AGENT-AC41 | error path | the case named in the test | refuses malformed changes | test_agent_ac41_refuses_malformed_changes | |
| AGENT-AC42 | error path | the case named in the test | refuses unusable reasons | test_agent_ac42_refuses_unusable_reasons | |
| AGENT-AC42 | error path | Refuses a reason that | is not a string | test_agent_ac42_refuses_a_reason_that_is_not_a_string | |
| AGENT-AC42 | error path | the case named in the test | accepts 500 characters | test_agent_ac42_accepts_500_characters | |
| AGENT-AC43 | double submit or concurrent | the case named in the test | refuses two changes to one block | test_agent_ac43_refuses_two_changes_to_one_block | |
| AGENT-AC44 | error path | Refuses changes that | are not a list | test_agent_ac44_refuses_changes_that_are_not_a_list | |
| AGENT-AC44 | error path | the case named in the test | refuses 11 changes and no changes | test_agent_ac44_refuses_11_changes_and_no_changes | |
| AGENT-AC44 | limit | the case named in the test | accepts 10 changes | test_agent_ac44_accepts_10_changes | |
| AGENT-AC45 | missing permission or unreadable page | A block with a mention | is not editable and its text leaves the mention out | AGENT-AC45: a block with a mention is not editable and its text leaves the mention out | |
| AGENT-AC45 | error path | A change to a block with a mention | makes apply stale | AGENT-AC45: a change to a block with a mention makes apply stale | |
| AGENT-AC45 | missing permission or unreadable page | Refuses a block that | is not editable | test_agent_ac45_refuses_a_block_that_is_not_editable | |
| AGENT-AC46 | double submit or concurrent | the case named in the test | refuses a second proposal for a page | test_agent_ac46_refuses_a_second_proposal_for_a_page | |
| AGENT-AC46 | happy path | Uses the most recent | read passed in | test_agent_ac46_uses_the_most_recent_read_passed_in | |
| AGENT-AC46 | double submit or concurrent | Second proposal for a page in one | run is refused | n/a: integration only, test_agent_ac46_second_proposal_for_a_page_in_one_run_is_refused in ai-service/tests/test_migrations.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC46 | double submit or concurrent | Second proposal for a page in one | run is refused by the store | n/a: integration only, test_agent_ac46_second_proposal_for_a_page_in_one_run_is_refused_by_the_store in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC47 | happy path | A proposal event | adds a card with Ansehen | AGENT-AC47: a proposal event adds a card with Ansehen | |
| AGENT-AC48 | happy path | the case named in the test | summary, cards in order, final message and Neue Aufgabe | AGENT-AC48: summary, cards in order, final message and Neue Aufgabe | |
| AGENT-AC48 | double submit or concurrent | the case named in the test | G3 shows the summary, two cards, the final message and Neue Aufgabe | n/a: Playwright, "AGENT-AC48: G3 shows the summary, two cards, the final message and Neue Aufgabe" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC48 | happy path | Pages read counts distinct pages and proposals | keep their order | test_agent_ac48_pages_read_counts_distinct_pages_and_proposals_keep_their_order | |
| AGENT-AC49 | happy path | One proposal and one page | read use the singular | AGENT-AC49: one proposal and one page read use the singular | |
| AGENT-AC49 | happy path | Stores steps, the proposal and the | end event of a run | AGENT-AC49: stores steps, the proposal and the end event of a run | |
| AGENT-AC49 | happy path | the case named in the test | setProposalStatus updates one proposal card | AGENT-AC49: setProposalStatus updates one proposal card | |
| AGENT-AC49 | missing permission or unreadable page | the case named in the test | posts to /api/ai/agent/run and delivers events from one shared frame reader | AGENT-AC49: posts to /api/ai/agent/run and delivers events from one shared frame reader | |
| AGENT-AC49 | happy path | GetAgentProposal posts the id and | parses the view | AGENT-AC49: getAgentProposal posts the id and parses the view | |
| AGENT-AC49 | happy path | the case named in the test | apply and discard post to their routes | AGENT-AC49: apply and discard post to their routes | |
| AGENT-AC49 | error path | A malformed view | maps to unreachable | AGENT-AC49: a malformed view maps to unreachable | |
| AGENT-AC50 | empty data | No proposal and no page | read | AGENT-AC50: no proposal and no page read | |
| AGENT-AC50 | empty data | A run without found pages | reads zero pages | test_agent_ac50_a_run_without_found_pages_reads_zero_pages | |
| AGENT-AC51 | limit | the case named in the test | the card shows title, +3 −3, reason and Ansehen | AGENT-AC51: the card shows title, +3 −3, reason and Ansehen | |
| AGENT-AC51 | missing permission or unreadable page | the case named in the test | counts added and removed words over all changes | test_agent_ac51_counts_added_and_removed_words_over_all_changes | |
| AGENT-AC52 | empty data | The final message | renders bold, loads no image, has no script link | AGENT-AC52: the final message renders bold, loads no image, has no script link | |
| AGENT-AC53 | happy path | Reason, title and new text | are shown literally | AGENT-AC53: reason, title and new text are shown literally | |
| AGENT-AC53 | happy path | A query with markup | shows literally | AGENT-AC53: a query with markup shows literally | |
| AGENT-AC53 | happy path | Reason and title with markup | show literally on the card | AGENT-AC53: reason and title with markup show literally on the card | |
| AGENT-AC54 | happy path | An out of scope | run shows only the capability text | AGENT-AC54: an out of scope run shows only the capability text | |
| AGENT-AC54 | empty data | A first answer without tool | calls is out of scope | test_agent_ac54_a_first_answer_without_tool_calls_is_out_of_scope | |
| AGENT-AC55 | empty data | Neue Aufgabe shows the | start view with the run's space and no cards | AGENT-AC55: Neue Aufgabe shows the start view with the run | |
| AGENT-AC56 | happy path | the case named in the test | state persists after the component unmounts and remounts | AGENT-AC56: state persists after the component unmounts and remounts | |
| AGENT-AC57 | happy path | The 21st tool call | is not executed | test_agent_ac57_the_21st_tool_call_is_not_executed | |
| AGENT-AC57 | limit | A final message after 20 steps still | finishes | test_agent_ac57_a_final_message_after_20_steps_still_finishes | |
| AGENT-AC58 | limit | At 19 steps only the first of three | calls runs | test_agent_ac58_at_19_steps_only_the_first_of_three_calls_runs | |
| AGENT-AC59 | happy path | Every end outcome and step kind of the contract | is streamed, others end the stream | AGENT-AC59: every end outcome and step kind of the contract is streamed, others end the stream | |
| AGENT-AC59 | limit | A run stopped after 10 minutes | shows the orange limit hint and its card | n/a: Playwright, "AGENT-AC59: a run stopped after 10 minutes shows the orange limit hint and its card" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC59 | error path | the case named in the test | setting the cancel event during the call raises model call cancelled | test_agent_ac59_setting_the_cancel_event_during_the_call_raises_model_call_cancelled | |
| AGENT-AC59 | error path | A cancel event that | is already set makes no request | test_agent_ac59_a_cancel_event_that_is_already_set_makes_no_request | |
| AGENT-AC59 | error path | An unset cancel event | does not disturb the call | test_agent_ac59_an_unset_cancel_event_does_not_disturb_the_call | |
| AGENT-AC59 | error path | the case named in the test | the deadline closes the connection to the model | test_agent_ac59_the_deadline_closes_the_connection_to_the_model | |
| AGENT-AC59 | error path | A model call at the 10 minute mark | is aborted as time limit | test_agent_ac59_a_model_call_at_the_10_minute_mark_is_aborted_as_time_limit | |
| AGENT-AC59 | limit | Tool calls after the deadline | are not executed | test_agent_ac59_tool_calls_after_the_deadline_are_not_executed | |
| AGENT-AC59 | limit | No model call | starts after the deadline | test_agent_ac59_no_model_call_starts_after_the_deadline | |
| AGENT-AC60 | limit | An answer crossing 200000 tokens | stops without its tool call | test_agent_ac60_an_answer_crossing_200000_tokens_stops_without_its_tool_call | |
| AGENT-AC61 | limit | An answer reaching exactly 200000 tokens | runs its tool call | test_agent_ac61_an_answer_reaching_exactly_200000_tokens_runs_its_tool_call | |
| AGENT-AC62 | limit | A final message after crossing the token limit | shows no hint | AGENT-AC62: a final message after crossing the token limit shows no hint | |
| AGENT-AC62 | limit | A final message crossing 200000 tokens still | finishes | test_agent_ac62_a_final_message_crossing_200000_tokens_still_finishes | |
| AGENT-AC63 | happy path | the case named in the test | returns prompt and completion tokens | test_agent_ac63_returns_prompt_and_completion_tokens | |
| AGENT-AC63 | empty data | Missing or non integer token | counts are none | test_agent_ac63_missing_or_non_integer_token_counts_are_none | |
| AGENT-AC63 | limit | Too few prompt tokens for the input | stops as context too small | test_agent_ac63_too_few_prompt_tokens_for_the_input_stops_as_context_too_small | |
| AGENT-AC63 | missing permission or unreadable page | the case named in the test | enough or unknown prompt tokens go on | test_agent_ac63_enough_or_unknown_prompt_tokens_go_on | |
| AGENT-AC64 | error path | Abbrechen keeps the card and | shows the cancelled text | AGENT-AC64: Abbrechen keeps the card and shows the cancelled text | |
| AGENT-AC64 | error path | Cancel aborts the request and later events | are not applied | AGENT-AC64: cancel aborts the request and later events are not applied | |
| AGENT-AC64 | error path | A stream that | ends without an end event ends without one | AGENT-AC64: a stream that ends without an end event ends without one | |
| AGENT-AC64 | error path | Aborting the request | closes the AI service request and sends no further event | AGENT-AC64: aborting the request closes the AI service request and sends no further event | |
| AGENT-AC64 | limit | the case named in the test | a long run is not cut off by the head timeout | AGENT-AC64: a long run is not cut off by the head timeout | |
| AGENT-AC64 | error path | Closing the client connection | aborts the signal passed to the service | AGENT-AC64: closing the client connection aborts the signal passed to the service | |
| AGENT-AC64 | error path | Cancel during a model call | ends the run without further calls | test_agent_ac64_cancel_during_a_model_call_ends_the_run_without_further_calls | |
| AGENT-AC64 | error path | Cancel between tool | calls runs no further call | test_agent_ac64_cancel_between_tool_calls_runs_no_further_call | |
| AGENT-AC64 | error path | Closing the event stream | ends the run as cancelled | test_agent_ac64_closing_the_event_stream_ends_the_run_as_cancelled | |
| AGENT-AC65 | empty data | A fresh store | starts empty | AGENT-AC65: a fresh store starts empty | |
| AGENT-AC65 | happy path | A client that | leaves before the AI service answers ends quietly | AGENT-AC65: a client that leaves before the AI service answers ends quietly | |
| AGENT-AC65 | happy path | A client that left before the request | is sent ends quietly | AGENT-AC65: a client that left before the request is sent ends quietly | |
| AGENT-AC65 | empty data | A client that left before the stream | gets nothing written | AGENT-AC65: a client that left before the stream gets nothing written | |
| AGENT-AC66 | error path | After cancel a new | start is allowed at once | AGENT-AC66: after cancel a new start is allowed at once | |
| AGENT-AC66 | error path | NewTask clears the | run and aborts a running request | AGENT-AC66: newTask clears the run and aborts a running request | |
| AGENT-AC66 | error path | Cancel during the call | closes the connection to the model | test_agent_ac66_cancel_during_the_call_closes_the_connection_to_the_model | |
| AGENT-AC66 | error path | A cancelled call after an answered one also | closes its connection | test_agent_ac66_a_cancelled_call_after_an_answered_one_also_closes_its_connection | |
| AGENT-AC66 | error path | A connection made after the | cancel is closed at once | test_agent_ac66_a_connection_made_after_the_cancel_is_closed_at_once | |
| AGENT-AC66 | happy path | After a disconnect the lock | is gone at once and a new run starts | test_agent_ac66_after_a_disconnect_the_lock_is_gone_at_once_and_a_new_run_starts | |
| AGENT-AC66 | error path | A disconnect sets the | cancel event of the model call | test_agent_ac66_a_disconnect_sets_the_cancel_event_of_the_model_call | |
| AGENT-AC66 | happy path | A finished run does not delete the lock of a newer | run | test_agent_ac66_a_finished_run_does_not_delete_the_lock_of_a_newer_run | |
| AGENT-AC67 | error path | A model failure | shows the card and the failure text | AGENT-AC67: a model failure shows the card and the failure text | |
| AGENT-AC67 | double submit or concurrent | A stream that breaks after two | reads shows 2 Seiten gelesen with the model failure text | AGENT-AC67: a stream that breaks after two reads shows 2 Seiten gelesen with the model failure text | |
| AGENT-AC67 | error path | A line that | is not JSON ends the stream without an end event and is logged without its content | AGENT-AC67: a line that is not JSON ends the stream without an end event and is logged without its content | |
| AGENT-AC67 | error path | %s ends the stream without an | end event | AGENT-AC67: | |
| AGENT-AC67 | error path | A body that breaks off | ends the stream without an end event | AGENT-AC67: a body that breaks off ends the stream without an end event | |
| AGENT-AC67 | error path | the case named in the test | connection refused raises model unavailable | test_agent_ac67_connection_refused_raises_model_unavailable | |
| AGENT-AC67 | error path | the case named in the test | server error raises model unavailable | test_agent_ac67_server_error_raises_model_unavailable | |
| AGENT-AC67 | error path | the case named in the test | malformed body raises model unavailable | test_agent_ac67_malformed_body_raises_model_unavailable | |
| AGENT-AC67 | error path | A failing model after a proposal | keeps the proposal | test_agent_ac67_a_failing_model_after_a_proposal_keeps_the_proposal | |
| AGENT-AC68 | error path | A call that | does not complete within the deadline raises model unavailable | test_agent_ac68_a_call_that_does_not_complete_within_the_deadline_raises_model_unavailable | |
| AGENT-AC68 | limit | The transport gets the deadline as | read timeout | test_agent_ac68_the_transport_gets_the_deadline_as_read_timeout | |
| AGENT-AC68 | error path | A model call silent for 120 seconds | is a model failure | test_agent_ac68_a_model_call_silent_for_120_seconds_is_a_model_failure | |
| AGENT-AC69 | error path | A rejected request | sets the unavailable flag and keeps no run | AGENT-AC69: a rejected request sets the unavailable flag and keeps no run | |
| AGENT-AC69 | error path | A stream that | ends without an end event counts as a model failure | AGENT-AC69: a stream that ends without an end event counts as a model failure | |
| AGENT-AC69 | error path | An invalid event | counts as a model failure and stops the stream | AGENT-AC69: an invalid event counts as a model failure and stops the stream | |
| AGENT-AC69 | error path | the case named in the test | a rejected fetch throws assistant_unavailable | AGENT-AC69: a rejected fetch throws assistant_unavailable | |
| AGENT-AC69 | limit | the case named in the test | 401 maps to unauthorized | AGENT-AC69: 401 maps to unauthorized | |
| AGENT-AC69 | error path | A refused connection | answers 503 assistant_unavailable | AGENT-AC69: a refused connection answers 503 assistant_unavailable | |
| AGENT-AC69 | error path | HTTP %i (%s) from the AI service | answers 503 assistant_unavailable | AGENT-AC69: HTTP | |
| AGENT-AC69 | error path | An AI service that | sends no response head within the timeout answers 503 assistant_unavailable | AGENT-AC69: an AI service that sends no response head within the timeout answers 503 assistant_unavailable | |
| AGENT-AC70 | error path | the case named in the test | run_in_progress sets inProgressRefused | AGENT-AC70: run_in_progress sets inProgressRefused | |
| AGENT-AC70 | happy path | The run call | posts the contract request fields with both token headers and passes run_in_progress | AGENT-AC70: the run call posts the contract request fields with both token headers and passes run_in_progress | |
| AGENT-AC70 | error path | Run_in_progress from the AI service | answers 409 run_in_progress | AGENT-AC70: run_in_progress from the AI service answers 409 run_in_progress | |
| AGENT-AC70 | error path | A 409 with another code | answers 503 assistant_unavailable | AGENT-AC70: a 409 with another code answers 503 assistant_unavailable | |
| AGENT-AC70 | double submit or concurrent | A held lock | is 409 run in progress before anything runs | test_agent_ac70_a_held_lock_is_409_run_in_progress_before_anything_runs | |
| AGENT-AC70 | missing permission or unreadable page | The lock of another user | does not block | test_agent_ac70_the_lock_of_another_user_does_not_block | |
| AGENT-AC70 | error path | A bridge failure before the stream | is 503 and frees the lock | test_agent_ac70_a_bridge_failure_before_the_stream_is_503_and_frees_the_lock | |
| AGENT-AC71 | happy path | the case named in the test | shows title, reason, save hint and both buttons | AGENT-AC71: shows title, reason, save hint and both buttons | |
| AGENT-AC71 | happy path | the case named in the test | shows a loading state before the view arrives | AGENT-AC71: shows a loading state before the view arrives | |
| AGENT-AC71 | happy path | the case named in the test | G4 shows the reason, the diff and the buttons Verwerfen and Übernehmen | n/a: Playwright, "AGENT-AC71: G4 shows the reason, the diff and the buttons Verwerfen and Übernehmen" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC72 | missing permission or unreadable page | the case named in the test | removed words are struck, added highlighted, kept plain | AGENT-AC72: removed words are struck, added highlighted, kept plain | |
| AGENT-AC72 | happy path | the case named in the test | marks only the changed number | test_agent_ac72_marks_only_the_changed_number | |
| AGENT-AC72 | happy path | the case named in the test | ops rebuild old and new text exactly | test_agent_ac72_ops_rebuild_old_and_new_text_exactly | |
| AGENT-AC72 | happy path | Adjacent ops of one kind | are merged | test_agent_ac72_adjacent_ops_of_one_kind_are_merged | |
| AGENT-AC72 | missing permission or unreadable page | the case named in the test | removed text comes before added text | test_agent_ac72_removed_text_comes_before_added_text | |
| AGENT-AC72 | happy path | the case named in the test | marks the fewest words | test_agent_ac72_marks_the_fewest_words | |
| AGENT-AC72 | happy path | Finds a minimal edit where greedy matching | is longer | test_agent_ac72_finds_a_minimal_edit_where_greedy_matching_is_longer | |
| AGENT-AC72 | limit | the case named in the test | diffs 2000 characters quickly | test_agent_ac72_diffs_2000_characters_quickly | |
| AGENT-AC73 | happy path | the case named in the test | the heading is shown above the change | AGENT-AC73: the heading is shown above the change | |
| AGENT-AC73 | empty data | A change without a heading | shows none | AGENT-AC73: a change without a heading shows none | |
| AGENT-AC74 | happy path | An applied proposal | shows diff, badge and only Schließen | AGENT-AC74: an applied proposal shows diff, badge and only Schließen | |
| AGENT-AC74 | happy path | A discarded proposal | shows the badge Verworfen | AGENT-AC74: a discarded proposal shows the badge Verworfen | |
| AGENT-AC74 | empty data | The wiki reads only fields the AI service contract | lists and shows its statuses without applying | AGENT-AC74: the wiki reads only fields the AI service contract lists and shows its statuses without applying | |
| AGENT-AC74 | happy path | the case named in the test | the view answers the contract status values for every stored status | AGENT-AC74: the view answers the contract status values for every stored status | |
| AGENT-AC74 | happy path | An applied proposal | shows its diff with the status applied and only the fields the client needs | AGENT-AC74: an applied proposal shows its diff with the status applied and only the fields the client needs | |
| AGENT-AC74 | happy path | A discarded proposal | shows its diff with the status discarded | AGENT-AC74: a discarded proposal shows its diff with the status discarded | |
| AGENT-AC74 | happy path | An open proposal whose page | is unchanged shows its diff as open and editable | AGENT-AC74: an open proposal whose page is unchanged shows its diff as open and editable | |
| AGENT-AC74 | happy path | A proposal being applied | is shown as open | AGENT-AC74: a proposal being applied is shown as open | |
| AGENT-AC75 | error path | An unreachable service on opening | shows the text and Schließen | AGENT-AC75: an unreachable service on opening shows the text and Schließen | |
| AGENT-AC76 | happy path | Claims the proposal, | writes exactly its changes as the user and records it applied | AGENT-AC76: claims the proposal, writes exactly its changes as the user and records it applied | |
| AGENT-AC76 | limit | Changes block 3 and | leaves every other block and attribute as it was | AGENT-AC76: changes block 3 and leaves every other block and attribute as it was | |
| AGENT-AC76 | happy path | the case named in the test | applies several changes in one call | AGENT-AC76: applies several changes in one call | |
| AGENT-AC76 | happy path | the case named in the test | applies ops across several text nodes of one block | AGENT-AC76: applies ops across several text nodes of one block | |
| AGENT-AC76 | happy path | ApplyAgentChanges writes with the user as connection context and | returns the result | AGENT-AC76: applyAgentChanges writes with the user as connection context and returns the result | |
| AGENT-AC77 | happy path | the case named in the test | Übernehmen closes, marks applied and notifies | AGENT-AC77: Übernehmen closes, marks applied and notifies | |
| AGENT-AC78 | happy path | Keep and remove | runs must spell the old text | AGENT-AC78: keep and remove runs must spell the old text | |
| AGENT-AC78 | missing permission or unreadable page | An unknown op kind | does not match | AGENT-AC78: an unknown op kind does not match | |
| AGENT-AC78 | happy path | Added words that replace bold words | are bold | AGENT-AC78: added words that replace bold words are bold | |
| AGENT-AC78 | missing permission or unreadable page | the case named in the test | added words take the formatting of the first removed word they replace | AGENT-AC78: added words take the formatting of the first removed word they replace | |
| AGENT-AC78 | happy path | the case named in the test | added words that replace plain words next to bold ones stay plain | AGENT-AC78: added words that replace plain words next to bold ones stay plain | |
| AGENT-AC79 | empty data | the case named in the test | a word added after a link carries no link | AGENT-AC79: a word added after a link carries no link | |
| AGENT-AC79 | happy path | A word added after bold linked text | keeps the bold but not the link | AGENT-AC79: a word added after bold linked text keeps the bold but not the link | |
| AGENT-AC79 | empty data | A word added at the | start of a block carries no formatting | AGENT-AC79: a word added at the start of a block carries no formatting | |
| AGENT-AC80 | empty data | An applied proposal | shows in another open editor without reloading | n/a: e2e only, "AGENT-AC80: an applied proposal shows in another open editor without reloading" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC81 | happy path | Once the wiki | has saved an applied page it names the applying user as last editor | n/a: e2e only, "AGENT-AC81: once the wiki has saved an applied page it names the applying user as last editor" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC82 | happy path | A view after the write of an | apply in flight leaves the proposal to the apply, which records it applied | AGENT-AC82: a view after the write of an apply in flight leaves the proposal to the apply, which records it applied | |
| AGENT-AC82 | happy path | Applied proposal records user | run page and time | n/a: integration only, test_agent_ac82_applied_proposal_records_user_run_page_and_time in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC82 | happy path | Saved proposal is open and | holds the draft and the run space | n/a: integration only, test_agent_ac82_saved_proposal_is_open_and_holds_the_draft_and_the_run_space in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC83 | happy path | Verwerfen closes, marks discarded and never | applies | AGENT-AC83: Verwerfen closes, marks discarded and never applies | |
| AGENT-AC83 | empty data | An open proposal | is discarded without touching the page | AGENT-AC83: an open proposal is discarded without touching the page | |
| AGENT-AC84 | error path | An apply request for a proposal that | is %s answers 409 proposal_not_open and writes nothing | AGENT-AC84: an apply request for a proposal that is | |
| AGENT-AC84 | error path | A discard request for a proposal that | is %s answers 409 proposal_not_open | AGENT-AC84: a discard request for a proposal that is | |
| AGENT-AC84 | error path | Proposal status outside the five states | is refused | n/a: integration only, test_agent_ac84_proposal_status_outside_the_five_states_is_refused in ai-service/tests/test_migrations.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC84 | happy path | Applied or discarded proposal | cannot be claimed or discarded | n/a: integration only, test_agent_ac84_applied_or_discarded_proposal_cannot_be_claimed_or_discarded in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC84 | happy path | Transition outside the allowed set | leaves the proposal unchanged | n/a: integration only, test_agent_ac84_transition_outside_the_allowed_set_leaves_the_proposal_unchanged in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC84 | happy path | the case named in the test | every allowed transition succeeds | n/a: integration only, test_agent_ac84_every_allowed_transition_succeeds in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC85 | double submit or concurrent | Two apply requests at the same time write the page once and one | answers 409 proposal_not_open | AGENT-AC85: two apply requests at the same time write the page once and one answers 409 proposal_not_open | |
| AGENT-AC85 | double submit or concurrent | A write whose record fails still | answers applied, so the user does not apply it twice | AGENT-AC85: a write whose record fails still answers applied, so the user does not apply it twice | |
| AGENT-AC85 | happy path | the case named in the test | claim sets claimed at | n/a: integration only, test_agent_ac85_claim_sets_claimed_at in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC85 | double submit or concurrent | the case named in the test | two concurrent claims let exactly one win | n/a: integration only, test_agent_ac85_two_concurrent_claims_let_exactly_one_win in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC85 | limit | Abandoned claim older than 60 seconds | can be claimed again | n/a: integration only, test_agent_ac85_abandoned_claim_older_than_60_seconds_can_be_claimed_again in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC85 | limit | Claim younger than 60 seconds | cannot be claimed again | n/a: integration only, test_agent_ac85_claim_younger_than_60_seconds_cannot_be_claimed_again in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC86 | error path | A failed write | shows the text and keeps the proposal open | AGENT-AC86: a failed write shows the text and keeps the proposal open | |
| AGENT-AC86 | error path | A write that %s | answers 503 write_failed and the proposal is open again | AGENT-AC86: a write that | |
| AGENT-AC86 | error path | A failed write whose release fails still | answers 503 write_failed | AGENT-AC86: a failed write whose release fails still answers 503 write_failed | |
| AGENT-AC87 | error path | A retry after a failed write | applies | AGENT-AC87: a retry after a failed write applies | |
| AGENT-AC87 | error path | After a write failure answered 503 write_failed and left the proposal open, applying again | writes the new text | n/a: e2e only, "AGENT-AC87: after a write failure answered 503 write_failed and left the proposal open, applying again writes the new text" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC87 | error path | Failed write reopens the proposal and | clears the claim | n/a: integration only, test_agent_ac87_failed_write_reopens_the_proposal_and_clears_the_claim in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC88 | error path | An unreachable service on | apply shows the unreachable text | AGENT-AC88: an unreachable service on apply shows the unreachable text | |
| AGENT-AC88 | happy path | %s from the AI service | is not taken as a proposal | AGENT-AC88: | |
| AGENT-AC88 | error path | An AI service that | refuses connections answers 503 assistant_unavailable and nothing is written | AGENT-AC88: an AI service that refuses connections answers 503 assistant_unavailable and nothing is written | |
| AGENT-AC88 | error path | An AI service that fails the claim | answers 503 assistant_unavailable and nothing is written | AGENT-AC88: an AI service that fails the claim answers 503 assistant_unavailable and nothing is written | |
| AGENT-AC88 | error path | A %s request while the AI service | refuses connections answers 503 assistant_unavailable | AGENT-AC88: a | |
| AGENT-AC89 | error path | A stale error on | apply shows G5 and marks the card stale | AGENT-AC89: a stale error on apply shows G5 and marks the card stale | |
| AGENT-AC89 | error path | A not_open error on | apply reloads the view | AGENT-AC89: a not_open error on apply reloads the view | |
| AGENT-AC89 | error path | A stale view | shows G5, marks the card and offers a new proposal | AGENT-AC89: a stale view shows G5, marks the card and offers a new proposal | |
| AGENT-AC89 | error path | A stale proposal | turns its card to Veraltet | AGENT-AC89: a stale proposal turns its card to Veraltet | |
| AGENT-AC89 | missing permission or unreadable page | An open proposal for a block that | is no longer editable is shown stale, as apply would refuse it | AGENT-AC89: an open proposal for a block that is no longer editable is shown stale, as apply would refuse it | |
| AGENT-AC89 | error path | An open proposal whose ops | do not spell the old text is shown stale, as apply would refuse it | AGENT-AC89: an open proposal whose ops do not spell the old text is shown stale, as apply would refuse it | |
| AGENT-AC89 | happy path | the case named in the test | the fingerprint is the same for the same content | AGENT-AC89: the fingerprint is the same for the same content | |
| AGENT-AC89 | happy path | The fingerprint does not depend on the order attributes | were set in | AGENT-AC89: the fingerprint does not depend on the order attributes were set in | |
| AGENT-AC89 | happy path | A page with a stored ydoc | reads with the fingerprint the collaboration server loads for apply | AGENT-AC89: a page with a stored ydoc reads with the fingerprint the collaboration server loads for apply | |
| AGENT-AC89 | happy path | A page with only stored content | reads with the fingerprint the collaboration server loads for apply | AGENT-AC89: a page with only stored content reads with the fingerprint the collaboration server loads for apply | |
| AGENT-AC89 | error path | A text edit in the changed block since the | read makes apply stale | AGENT-AC89: a text edit in the changed block since the read makes apply stale | |
| AGENT-AC89 | error path | A changed node attribute since the | read makes apply stale | AGENT-AC89: a changed node attribute since the read makes apply stale | |
| AGENT-AC89 | happy path | A read of a page nobody | has open has the fingerprint apply finds, so the proposal applies | n/a: e2e only, "AGENT-AC89: a read of a page nobody has open has the fingerprint apply finds, so the proposal applies" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC89 | error path | the case named in the test | G5 shows the stale text with Schließen and Neuen Vorschlag erstellen | n/a: Playwright, "AGENT-AC89: G5 shows the stale text with Schließen and Neuen Vorschlag erstellen" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC90 | error path | A character typed in an open editor after the proposal | was shown makes apply answer 409 proposal_stale and keeps only that character | n/a: e2e only, "AGENT-AC90: a character typed in an open editor after the proposal was shown makes apply answer 409 proposal_stale and keeps only that character" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC91 | error path | An open proposal whose page fingerprint changed | becomes stale and is shown stale | AGENT-AC91: an open proposal whose page fingerprint changed becomes stale and is shown stale | |
| AGENT-AC91 | missing permission or unreadable page | An open proposal whose changed block no longer | holds the old text is shown stale | AGENT-AC91: an open proposal whose changed block no longer holds the old text is shown stale | |
| AGENT-AC91 | error path | A proposal that changed state while it | was marked stale is shown in its new state | AGENT-AC91: a proposal that changed state while it was marked stale is shown in its new state | |
| AGENT-AC91 | error path | A live document that | rejects answers 503 assistant_unavailable and the proposal stays open | AGENT-AC91: a live document that rejects answers 503 assistant_unavailable and the proposal stays open | |
| AGENT-AC91 | error path | A page no collaboration node | holds is compared with the stored page and shown stale when it changed | AGENT-AC91: a page no collaboration node holds is compared with the stored page and shown stale when it changed | |
| AGENT-AC91 | error path | A page that changed since the | read answers 409 proposal_stale and the proposal becomes stale | AGENT-AC91: a page that changed since the read answers 409 proposal_stale and the proposal becomes stale | |
| AGENT-AC91 | error path | A text edit in another block since the | read makes apply stale | AGENT-AC91: a text edit in another block since the read makes apply stale | |
| AGENT-AC91 | error path | An old text that differs from the block | makes apply stale | AGENT-AC91: an old text that differs from the block makes apply stale | |
| AGENT-AC91 | error path | Ops that do not spell the old text | make apply stale | AGENT-AC91: ops that do not spell the old text make apply stale | |
| AGENT-AC91 | missing permission or unreadable page | An unknown block number | makes apply stale | AGENT-AC91: an unknown block number makes apply stale | |
| AGENT-AC91 | double submit or concurrent | Two changes for the same block | make apply stale | AGENT-AC91: two changes for the same block make apply stale | |
| AGENT-AC91 | error path | One invalid change | writes none of the changes | AGENT-AC91: one invalid change writes none of the changes | |
| AGENT-AC91 | error path | the case named in the test | applyAgentChanges returns stale for an old fingerprint | AGENT-AC91: applyAgentChanges returns stale for an old fingerprint | |
| AGENT-AC92 | error path | Bold added to an untouched word since the | read makes apply stale | AGENT-AC92: bold added to an untouched word since the read makes apply stale | |
| AGENT-AC93 | error path | An edit in a block beyond the first 6,000 characters | makes apply stale | AGENT-AC93: an edit in a block beyond the first 6,000 characters makes apply stale | |
| AGENT-AC94 | error path | An edit typed after the | read the proposal is based on makes apply answer 409 proposal_stale | n/a: e2e only, "AGENT-AC94: an edit typed after the read the proposal is based on makes apply answer 409 proposal_stale" in apps/server/test/ai-agent.e2e-spec.ts, 157 passed on 30.10.2026 (server e2e run) | |
| AGENT-AC95 | happy path | Neuen Vorschlag erstellen | starts the fixed task in the same space | AGENT-AC95: Neuen Vorschlag erstellen starts the fixed task in the same space | |
| AGENT-AC95 | error path | the case named in the test | startFromStale starts the fixed task in the run's space | AGENT-AC95: startFromStale starts the fixed task in the run | |
| AGENT-AC96 | error path | A stale proposal | answers 409 proposal_not_open and is not written, even if the page is back to its old content | AGENT-AC96: a stale proposal answers 409 proposal_not_open and is not written, even if the page is back to its old content | |
| AGENT-AC96 | error path | the case named in the test | stale proposal cannot be claimed | n/a: integration only, test_agent_ac96_stale_proposal_cannot_be_claimed in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC97 | missing permission or unreadable page | the case named in the test | a reader sees the diff, the hint and a disabled Übernehmen | AGENT-AC97: a reader sees the diff, the hint and a disabled Übernehmen | |
| AGENT-AC97 | missing permission or unreadable page | A user who may only view the page | gets the diff with canEdit false | AGENT-AC97: a user who may only view the page gets the diff with canEdit false | |
| AGENT-AC97 | happy path | the case named in the test | G6 shows the diff, the read-only hint and Übernehmen disabled | n/a: Playwright, "AGENT-AC97: G6 shows the diff, the read-only hint and Übernehmen disabled" in apps/client/e2e/agent.screenshots.ts, run in verify step 4 | |
| AGENT-AC98 | missing permission or unreadable page | A user who may only view the page | gets 403 page_not_editable, no claim and no write | AGENT-AC98: a user who may only view the page gets 403 page_not_editable, no claim and no write | |
| AGENT-AC99 | missing permission or unreadable page | A gone page | shows the text, Schließen and no proposal text | AGENT-AC99: a gone page shows the text, Schließen and no proposal text | |
| AGENT-AC99 | happy path | A page that vanishes on | apply shows the same text | AGENT-AC99: a page that vanishes on apply shows the same text | |
| AGENT-AC100 | missing permission or unreadable page | A page that | is %s answers 404 page_not_found with no text of the proposal | AGENT-AC100: a page that is | |
| AGENT-AC101 | missing permission or unreadable page | A page that | is %s answers 404 page_not_found, no claim and no write | AGENT-AC101: a page that is | |
| AGENT-AC102 | happy path | the case named in the test | %s is posted with the contract request fields and both token headers | AGENT-AC102: | |
| AGENT-AC102 | happy path | %s from the AI service | passes through with the contract status | AGENT-AC102: | |
| AGENT-AC102 | missing permission or unreadable page | A %s request for a proposal of another user | answers 404 proposal_not_found | AGENT-AC102: a | |
| AGENT-AC102 | missing permission or unreadable page | A %s request for a proposal id that | does not exist answers 404 proposal_not_found | AGENT-AC102: a | |
| AGENT-AC102 | missing permission or unreadable page | An unknown or foreign proposal | is 404 proposal not found | test_agent_ac102_an_unknown_or_foreign_proposal_is_404_proposal_not_found | |
| AGENT-AC102 | missing permission or unreadable page | Proposal of another user | is not found | n/a: integration only, test_agent_ac102_proposal_of_another_user_is_not_found in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC103 | missing permission or unreadable page | %s answers 404 space_not_found and the AI service | is not called | AGENT-AC103: | |
| AGENT-AC103 | missing permission or unreadable page | A space the user | was removed from answers 404 space_not_found | AGENT-AC103: a space the user was removed from answers 404 space_not_found | |
| AGENT-AC104 | limit | the case named in the test | the task length limit of the DTO equals the contract | AGENT-AC104: the task length limit of the DTO equals the contract | |
| AGENT-AC104 | limit | the case named in the test | accepts a space id and a task of 1 to 2,000 characters after trimming | AGENT-AC104: accepts a space id and a task of 1 to 2,000 characters after trimming | |
| AGENT-AC104 | happy path | the case named in the test | trims the task and lowercases the space id | AGENT-AC104: trims the task and lowercases the space id | |
| AGENT-AC104 | error path | the case named in the test | %s answers 400 invalid_request | AGENT-AC104: | |
| AGENT-AC104 | happy path | the case named in the test | sends exactly the space id and the task with both tokens to POST /v1/agent/runs | AGENT-AC104: sends exactly the space id and the task with both tokens to POST /v1/agent/runs | |
| AGENT-AC104 | error path | A run request with a field the contract | does not list answers invalid_request | AGENT-AC104: a run request with a field the contract does not list answers invalid_request | |
| AGENT-AC104 | happy path | A run request with only the fields of the contract | passes to validation | AGENT-AC104: a run request with only the fields of the contract passes to validation | |
| AGENT-AC104 | happy path | The allowed fields | are the properties of the body DTO of the handler | AGENT-AC104: the allowed fields are the properties of the body DTO of the handler | |
| AGENT-AC104 | empty data | the case named in the test | a handler without a body DTO allows no field | AGENT-AC104: a handler without a body DTO allows no field | |
| AGENT-AC104 | missing permission or unreadable page | The refusal names the unknown field and | answers 400 through the bridge filter | AGENT-AC104: the refusal names the unknown field and answers 400 through the bridge filter | |
| AGENT-AC104 | error path | An invalid run body | is 400 invalid request | test_agent_ac104_an_invalid_run_body_is_400_invalid_request | |
| AGENT-AC104 | error path | An invalid proposal body | is 400 invalid request | test_agent_ac104_an_invalid_proposal_body_is_400_invalid_request | |
| AGENT-AC104 | limit | A task of 2000 characters | is accepted and trimmed | test_agent_ac104_a_task_of_2000_characters_is_accepted_and_trimmed | |
| AGENT-AC105 | error path | the case named in the test | %s sits behind the session guard, the body field guard and the bridge filter | AGENT-AC105: | |
| AGENT-AC105 | error path | An apply request with new texts besides the proposal id | answers 400 invalid_request | AGENT-AC105: an apply request with new texts besides the proposal id answers 400 invalid_request | |
| AGENT-AC105 | happy path | the case named in the test | the routes pass only the proposal id to the service | AGENT-AC105: the routes pass only the proposal id to the service | |
| AGENT-AC106 | error path | the case named in the test | the run route sits behind the session guard of the controller, then the body field guard and the bridge filter | AGENT-AC106: the run route sits behind the session guard of the controller, then the body field guard and the bridge filter | |
| AGENT-AC107 | error path | A switched-off assistant | answers 503 assistant_disabled and calls nothing | AGENT-AC107: a switched-off assistant answers 503 assistant_disabled and calls nothing | |
| AGENT-AC107 | happy path | %s is thrown before any header | is written | AGENT-AC107: | |
| AGENT-AC107 | error path | A %s request with the assistant switched off | answers 503 assistant_disabled | AGENT-AC107: a | |
| AGENT-AC108 | limit | A bad token | is 401 with the exact code | test_agent_ac108_a_bad_token_is_401_with_the_exact_code | |
| AGENT-AC108 | happy path | The service token | is checked before the body | test_agent_ac108_the_service_token_is_checked_before_the_body | |
| AGENT-AC108 | happy path | the case named in the test | the owner gets the stored proposal | test_agent_ac108_the_owner_gets_the_stored_proposal | |
| AGENT-AC108 | happy path | the case named in the test | the owner transitions the proposal | test_agent_ac108_the_owner_transitions_the_proposal | |
| AGENT-AC108 | error path | A proposal that | is not open is 409 proposal not open | test_agent_ac108_a_proposal_that_is_not_open_is_409_proposal_not_open | |
| AGENT-AC109 | missing permission or unreadable page | Proposals of a deleted | run go with it | n/a: integration only, test_agent_ac109_proposals_of_a_deleted_run_go_with_it in ai-service/tests/test_migrations.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC109 | happy path | Retention runs when the worker | starts | test_agent_ac109_retention_runs_when_the_worker_starts | |
| AGENT-AC109 | limit | Retention does not | run again before 24 h | test_agent_ac109_retention_does_not_run_again_before_24_h | |
| AGENT-AC109 | limit | the case named in the test | retention runs again 24 h after the last one | test_agent_ac109_retention_runs_again_24_h_after_the_last_one | |
| AGENT-AC109 | limit | the case named in the test | retention passes now minus 30 days as the cutoff | test_agent_ac109_retention_passes_now_minus_30_days_as_the_cutoff | |
| AGENT-AC109 | error path | A failing retention | is logged and the worker goes on | test_agent_ac109_a_failing_retention_is_logged_and_the_worker_goes_on | |
| AGENT-AC109 | limit | Run started 30 days and 1 minute ago | goes with its proposals | n/a: integration only, test_agent_ac109_run_started_30_days_and_1_minute_ago_goes_with_its_proposals in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC109 | happy path | Retention keeps a | run started exactly at the cutoff | n/a: integration only, test_agent_ac109_retention_keeps_a_run_started_exactly_at_the_cutoff in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC110 | empty data | the case named in the test | the store gets no page text and no model messages | test_agent_ac110_the_store_gets_no_page_text_and_no_model_messages | |
| AGENT-AC110 | happy path | the case named in the test | upgrade as ai role creates the agent tables in schema ai | n/a: integration only, test_agent_ac110_upgrade_as_ai_role_creates_the_agent_tables_in_schema_ai in ai-service/tests/test_migrations.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC110 | happy path | Downgrade to the index revision | drops the agent tables and keeps the index | n/a: integration only, test_agent_ac110_downgrade_to_the_index_revision_drops_the_agent_tables_and_keeps_the_index in ai-service/tests/test_migrations.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC110 | happy path | the case named in the test | run records task space steps and outcome only | n/a: integration only, test_agent_ac110_run_records_task_space_steps_and_outcome_only in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC110 | empty data | Running run has no outcome and no | end | n/a: integration only, test_agent_ac110_running_run_has_no_outcome_and_no_end in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC110 | empty data | the case named in the test | store has no column for messages or other page text | n/a: integration only, test_agent_ac110_store_has_no_column_for_messages_or_other_page_text in ai-service/tests/test_agent_store.py, 72 passed on 30.10.2026 (ai-service integration run: agent store, migrations, worker) | |
| AGENT-AC111 | happy path | Each outcome logs one line with the | run facts | test_agent_ac111_each_outcome_logs_one_line_with_the_run_facts | |
| AGENT-AC111 | happy path | The log line | counts steps tokens and proposals | test_agent_ac111_the_log_line_counts_steps_tokens_and_proposals | |
| AGENT-AC111 | error path | A failing store | ends the run as model failed and raises | test_agent_ac111_a_failing_store_ends_the_run_as_model_failed_and_raises | |
| AGENT-AC112 | happy path | The outcome %s of a %s request | logs one line with the run id, the proposal id and the outcome | AGENT-AC112: the outcome | |
| AGENT-AC112 | missing permission or unreadable page | A request for a proposal that | is not found logs no outcome line, as it has no run id | AGENT-AC112: a request for a proposal that is not found logs no outcome line, as it has no run id | |
| AGENT-AC113 | empty data | the case named in the test | the log lines of the outcome %s (%s) hold no reason, title, page text or token | AGENT-AC113: the log lines of the outcome | |
| AGENT-AC113 | empty data | The log line | holds no task page text message or token | test_agent_ac113_the_log_line_holds_no_task_page_text_message_or_token | |
| AGENT-AC114 | happy path | the case named in the test | a read ends with the hint to propose changes after the page text | test_agent_ac114_a_read_ends_with_the_hint_to_propose_changes_after_the_page_text | |
| AGENT-AC114 | happy path | A saved proposal tells the model the page | is unchanged | test_agent_ac114_a_saved_proposal_tells_the_model_the_page_is_unchanged | |
| AGENT-AC114 | limit | the case named in the test | the run ends with a card for the travel policy within 10 minutes | n/a: local model check, test_agent_ac114_the_run_ends_with_a_card_for_the_travel_policy_within_10_minutes in ai-service/tests/test_stack_agent.py via scripts/run-agent-check.sh with qwen3:8b: 2 passed, elapsed 28.3 s, 4 steps, proposal for "Reisekosten Richtlinie 2022" | |
| AGENT-AC114 | happy path | The proposal is open editable and | applies to the page | n/a: local model check, test_agent_ac114_the_proposal_is_open_editable_and_applies_to_the_page in ai-service/tests/test_stack_agent.py via scripts/run-agent-check.sh with qwen3:8b: 2 passed, elapsed 28.3 s, 4 steps, proposal for "Reisekosten Richtlinie 2022" | |
| AGENT-AC115 | double submit or concurrent | Two starts in a row | send one request | AGENT-AC115: two starts in a row send one request | |
| AGENT-AC115 | double submit or concurrent | the case named in the test | two simultaneous starts make one stream and one 409 | test_agent_ac115_two_simultaneous_starts_make_one_stream_and_one_409 | |
| AGENT-AC116 | happy path | A linked word the diff | keeps still carries its link | AGENT-AC116: a linked word the diff keeps still carries its link | |
| AGENT-AC117 | empty data | A page with only a code block and an empty paragraph | has no blocks | AGENT-AC117: a page with only a code block and an empty paragraph has no blocks | |
| AGENT-AC117 | empty data | A page without content or ydoc | reads as no blocks with the fingerprint of the loaded empty page | AGENT-AC117: a page without content or ydoc reads as no blocks with the fingerprint of the loaded empty page | |
| AGENT-AC117 | empty data | the case named in the test | an empty read gives the title only without a note | test_agent_ac117_an_empty_read_gives_the_title_only_without_a_note | |
