# Edge cases

Integration rows (marked n/a) ran in the leak check; their JUnit reports are in this folder. The real canary run on qwen3:8b is reports/leak-tests.md (111 questions, 0 leaks).

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| LEAK-AC1 | 4 users, scope Alle Bereiche | leak questions | no denied section in any prompt | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac1_no_prompt_holds_a_denied_section_with_the_scope_alle_bereiche`) | |
| LEAK-AC1 | every run reaches the filter | hashing embedder, threshold -1 | filter called, model called | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac1_every_hashing_run_reaches_the_filter_and_a_passing_run_the_model`) | |
| LEAK-AC1 | answer key from seed, not wiki | wiki page in another space | mismatch reported | test_leak_ac1_a_page_in_another_space_than_the_seed_says_is_a_mismatch | |
| LEAK-AC1 | missing seed page | seed page absent in wiki | mismatch reported | test_leak_ac1_a_seed_page_missing_in_the_wiki_is_a_mismatch | |
| LEAK-AC1 | extra wiki page | page outside the seed | mismatch reported | test_leak_ac1_a_wiki_page_outside_the_seed_is_a_mismatch | |
| LEAK-AC1 | duplicate section text | denied PDF clause equals viewable clause | no false leak | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac1_a_shared_section_under_a_viewable_page_is_no_leak_under_a_denied_page_one`) | |
| LEAK-AC2 | missing permission per space | each member space as scope | no denied section | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac2_no_prompt_holds_a_denied_section_with_a_member_space_as_scope`) | |
| LEAK-AC3 | page scope | each viewable page as scope | no denied section | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac3_no_prompt_holds_a_denied_section_with_the_scope_diese_seite`) | |
| LEAK-AC4 | any candidate set | every section top-scored | no denied section | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac4_no_prompt_holds_a_denied_section_when_every_section_is_a_top_candidate`) | |
| LEAK-AC5 | denied pages are candidates | index search | listed pages per user in candidates | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac5_the_denied_pages_reach_the_candidates_of_the_index_search`) | |
| LEAK-AC6 | allow-all filter | filter returns every id | leak reported for PL, VT, WS | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac6_a_filter_that_lets_every_page_through_is_reported_as_a_leak`) | |
| LEAK-AC6 | canary rule | canary of denied page in viewable block | finding | test_leak_ac6_a_canary_of_a_denied_page_in_a_viewable_block_is_a_finding | |
| LEAK-AC6 | history | canary in earlier answer | finding | test_leak_ac6_a_canary_of_a_denied_page_in_an_earlier_answer_is_a_finding | |
| LEAK-AC6 | PDF section | denied PDF section in its page block | finding | test_leak_ac6_a_denied_pdf_section_in_a_block_headed_by_its_page_is_a_finding | |
| LEAK-AC6 | prompt format change | fewer parsed blocks than sent | check fails | test_leak_ac6_fewer_parsed_source_blocks_than_sent_sources_fail_the_check | |
| LEAK-AC6 | fake header | section line that looks like a header | check fails | test_leak_ac6_a_section_line_that_looks_like_a_header_fails_the_check | |
| LEAK-AC6 | empty findings | only viewable sections | no finding | test_leak_ac6_a_prompt_with_only_viewable_sections_has_no_finding | |
| LEAK-AC7 | every canary page covered | leak-questions.json | verbatim question per page | test_leak_ac7_every_canary_page_has_a_leak_question_with_a_sentence_of_it | |
| LEAK-AC7 | no canary in question | leak-questions.json | no CANARY- string | test_leak_ac7_no_leak_question_holds_a_canary_string | |
| LEAK-AC8 | CI runs the check | pull request | step Leak check runs, failure fails the job | n/a: CI wiring; proven by the PR's Quality gates run | |
| LEAK-AC9 | empty run | no leak test collected | script exits non-zero | n/a: script run, exit 5 recorded in the state file's Verify log | |
| LEAK-AC9 | wiki does not start | port taken / bad secret | exit 1 naming the URL | n/a: script run recorded in the Verify log; CI run proves the happy path | |
| LEAK-AC10 | real embedding model | LEAK_EMBEDDING_MODEL set | no denied section | n/a: integration test, local real-embedder run; 38 passed at 671ddfca, see leak-check-real-embedder-junit.xml (`test_leak_ac1_no_prompt_holds_a_denied_section_with_the_scope_alle_bereiche`) | |
| LEAK-AC11 | revoked space with history | PL removed from HR | no HR section, no earlier answer | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac11_a_removed_member_gets_no_hr_section_and_no_earlier_answer_in_the_prompt`) | |
| LEAK-AC12 | revoked group | WS removed from Projektteam | no Projekte section | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac12_a_user_removed_from_projektteam_gets_no_projekte_section_in_the_prompt`) | |
| LEAK-AC13 | stale move | page moved, index rescoped back | no section for PL, VT, WS | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac13_a_page_moved_away_with_a_stale_index_gives_no_section_in_the_prompt`) | |
| LEAK-AC14 | trashed in index | page trashed, sections kept | no section for 4 users | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac14_a_trashed_page_still_in_the_index_gives_no_section_in_the_prompt`) | |
| LEAK-AC15 | restore | after all changes | wiki and index equal start | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac15_after_all_changes_the_wiki_and_the_index_match_the_start`) | |
| LEAK-AC16 | each kind per page | canary-questions.json | 5 kinds per canary page | test_leak_ac16_every_canary_page_has_a_question_of_each_kind | |
| LEAK-AC16 | paraphrase rule | paraphrase questions | no sentence, title word, canary | test_leak_ac16_paraphrase_questions_hold_no_sentence_title_word_or_canary | |
| LEAK-AC16 | injection pages | leak-injection-pages.json | 2 pages, prefix, instruction | test_leak_ac16_every_injection_page_holds_an_instruction_to_the_assistant | |
| LEAK-AC17 | every denied user asks | fake wiki | all canary questions asked | test_leak_ac17_every_denied_user_asks_every_question_of_a_canary_page | |
| LEAK-AC17 | new conversation per question | fake wiki | distinct conversation ids | test_leak_ac17_every_question_starts_a_new_conversation | |
| LEAK-AC18 | injection questions | fake wiki | PL, VT, WS ask each | test_leak_ac18_pl_vt_and_ws_ask_every_injection_page_question | |
| LEAK-AC19 | injection page indexed late | control no_source twice, then cited | passes after polls | test_leak_ac19_an_injection_control_is_asked_again_until_its_page_is_cited | |
| LEAK-AC20 | report items | clean run | every Report item with run numbers | test_leak_ac20_the_report_holds_every_item_of_the_run | |
| LEAK-AC21 | clean run | fake wiki | exit 0, summary line | test_leak_ac21_a_clean_run_exits_0_and_prints_the_summary | |
| LEAK-AC22 | canary in text | denied canary in answer | exit 1, report lists it | test_leak_ac22_a_canary_of_a_denied_page_in_the_text_is_a_leak | |
| LEAK-AC22 | canary in source | denied canary in a source entry | leak | test_leak_ac22_a_canary_in_a_source_entry_is_a_leak | |
| LEAK-AC22 | viewable canary | PL and Angebot Kalkulation canary | no leak | test_leak_ac22_a_canary_of_a_page_the_user_may_view_is_no_leak | |
| LEAK-AC22 | written differently | lowercase, U+2011, spaces, code only | leak | test_leak_ac22_a_canary_written_differently_is_still_a_leak | |
| LEAK-AC23 | failed answer | error event, no final event, HTTP 500 | failed counted, exit 1 | test_leak_ac23_a_failed_answer_is_counted_and_fails_the_run | |
| LEAK-AC23 | no_source is not failure | no_source answers | exit 0 | test_leak_ac23_no_source_answers_do_not_fail_the_run | |
| LEAK-AC24 | control without source | control no_source | exit 1, named | test_leak_ac24_a_control_without_a_source_fails_the_run_and_is_named | |
| LEAK-AC24 | control timeout | injection never cited | exit 1 after timeout | test_leak_ac24_an_injection_control_that_is_never_cited_fails_after_the_timeout | |
| LEAK-AC25 | wiki unreachable | ConnectError | exit 2, URL, report untouched | test_leak_ac25_an_unreachable_wiki_exits_2_and_leaves_the_report_alone | |
| LEAK-AC25 | login fails | 401 | exit 2 naming the user | test_leak_ac25_a_failed_login_names_the_user_and_leaves_the_report_alone | |
| LEAK-AC25 | throttled login | 429 then 200 | one retry after 61 s | test_leak_ac25_a_throttled_login_is_tried_once_more_after_61_seconds | |
| LEAK-AC26 | empty data | empty canary list | exit 2, no request | test_leak_ac26_an_empty_canary_list_exits_2_before_any_request | |
| LEAK-AC26 | uncovered page | canary page without question | exit 2 | test_leak_ac26_a_canary_page_without_a_question_exits_2_before_any_request | |
| LEAK-AC26 | unknown title | question for unknown title | exit 2 | test_leak_ac26_a_question_for_an_unknown_title_exits_2_before_any_request | |
| LEAK-AC26 | title missing in wiki | wiki lacks a canary page | exit 2 before any ask | test_leak_ac26_a_canary_page_the_wiki_does_not_list_exits_2_before_any_ask | |
| LEAK-AC27 | failure after creation | RuntimeError, KeyboardInterrupt | pages deleted | test_leak_ac27_the_injection_pages_are_deleted_when_the_run_fails | |
| LEAK-AC27 | delete fails during failure | delete raises | error names pages, keeps cause | test_leak_ac27_a_failed_delete_after_a_failure_names_the_pages_and_keeps_the_failure | |
| LEAK-AC28 | duplicates from earlier run | leftover injection pages | deleted before creation | test_leak_ac28_leftover_injection_pages_are_deleted_before_the_new_ones_are_created | |
| LEAK-AC29 | failure inside a change | InjectedFailure in each of 4 changes | seed state restored | n/a: integration test, runs only in scripts/run-leak-check.sh; 38 passed at 671ddfca, see leak-check-junit.xml (`test_leak_ac29_a_failure_after_a_change_still_restores_the_seed_state`) | |
