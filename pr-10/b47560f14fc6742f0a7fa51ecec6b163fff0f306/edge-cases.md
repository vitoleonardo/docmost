# Edge cases

ai-service and seed generator only; no UI, so no browser rows and no screenshots. Every row is a unit test in the fast suite (`-m "not integration"`); the eval tests need no stack. AC19 and AC50 are stack-level (plan) and were checked in two runs of `scripts/run-evals.sh`, recorded in the state file's Verify log.

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| EVAL-AC1 | empty data | the case named in the test | at least 14 questions have pages and at least 5 have none | test_eval_ac1_at_least_14_questions_have_pages_and_at_least_5_have_none | |
| EVAL-AC1 | happy path | the case named in the test | every answering page is a seed page | test_eval_ac1_every_answering_page_is_a_seed_page | |
| EVAL-AC1 | happy path | the case named in the test | every asker is a seed user and every question is unique | test_eval_ac1_every_asker_is_a_seed_user_and_every_question_is_unique | |
| EVAL-AC1 | happy path | the case named in the test | no golden question and no agent scenario holds a canary string | test_eval_ac1_no_golden_question_and_no_agent_scenario_holds_a_canary_string | |
| EVAL-AC1 | permission | the case named in the test | questions with pages have a reference a key fact and answer among them | test_eval_ac1_questions_with_pages_have_a_reference_a_key_fact_and_answer_among_them | |
| EVAL-AC1 | permission | the case named in the test | questions without pages have no reference answer and no key fact | test_eval_ac1_questions_without_pages_have_no_reference_answer_and_no_key_fact | |
| EVAL-AC1 | happy path | the case named in the test | the golden list has 20 entries with unique ids | test_eval_ac1_the_golden_list_has_20_entries_with_unique_ids | |
| EVAL-AC2 | happy path | the case named in the test | each contradiction pair has a question expecting only the current page | test_eval_ac2_each_contradiction_pair_has_a_question_expecting_only_the_current_page | |
| EVAL-AC3 | happy path | the case named in the test | every expected page is a seed page the asker may view | test_eval_ac3_every_expected_page_is_a_seed_page_the_asker_may_view | |
| EVAL-AC3 | happy path | the case named in the test | the access rules follow the space and page matrices | test_eval_ac3_the_access_rules_follow_the_space_and_page_matrices | |
| EVAL-AC4 | permission | the case named in the test | a key fact found only in an attached pdf occurs in no seed page | test_eval_ac4_a_key_fact_found_only_in_an_attached_pdf_occurs_in_no_seed_page | |
| EVAL-AC4 | permission | the case named in the test | every key fact occurs in an expected page or a pdf attached to one | test_eval_ac4_every_key_fact_occurs_in_an_expected_page_or_a_pdf_attached_to_one | |
| EVAL-AC4 | happy path | the case named in the test | one question is answered only from a contract pdf of its only expected page | test_eval_ac4_one_question_is_answered_only_from_a_contract_pdf_of_its_only_expected_page | |
| EVAL-AC4 | happy path | the case named in the test | the pdf text helper reads the text layer of a seed contract | test_eval_ac4_the_pdf_text_helper_reads_the_text_layer_of_a_seed_contract | |
| EVAL-AC5 | error | the case named in the test | a named page of a question without pages is hidden and not copied | test_eval_ac5_a_named_page_of_a_question_without_pages_is_hidden_and_not_copied | |
| EVAL-AC5 | permission | the case named in the test | at least two questions without pages name a page their asker may not view | test_eval_ac5_at_least_two_questions_without_pages_name_a_page_their_asker_may_not_view | |
| EVAL-AC5 | error | the case named in the test | at least two questions without pages name no page | test_eval_ac5_at_least_two_questions_without_pages_name_no_page | |
| EVAL-AC6 | happy path | the case named in the test | a task outside the tools expects no proposal | test_eval_ac6_a_task_outside_the_tools_expects_no_proposal | |
| EVAL-AC6 | happy path | the case named in the test | every outdated page has a scenario by a user who may edit it | test_eval_ac6_every_outdated_page_has_a_scenario_by_a_user_who_may_edit_it | |
| EVAL-AC6 | happy path | the case named in the test | every scenario user is a seed user and member of the space | test_eval_ac6_every_scenario_user_is_a_seed_user_and_member_of_the_space | |
| EVAL-AC6 | happy path | the case named in the test | expected outcomes are known and proposal pages lie in the space | test_eval_ac6_expected_outcomes_are_known_and_proposal_pages_lie_in_the_space | |
| EVAL-AC6 | permission | the case named in the test | one scenario user may only view the space and expects an outdated page | test_eval_ac6_one_scenario_user_may_only_view_the_space_and_expects_an_outdated_page | |
| EVAL-AC6 | happy path | the case named in the test | the scenario list has unique ids | test_eval_ac6_the_scenario_list_has_unique_ids | |
| EVAL-AC7 | error | the case named in the test | every golden question is in the leak list without a page | test_eval_ac7_every_golden_question_is_in_the_leak_list_without_a_page | |
| EVAL-AC8 | error | the case named in the test | a malformed event line is a failed case and the run goes on | test_eval_ac8_a_malformed_event_line_is_a_failed_case_and_the_run_goes_on | |
| EVAL-AC8 | error | the case named in the test | an error event without a code is a failed case | test_eval_ac8_an_error_event_without_a_code_is_a_failed_case | |
| EVAL-AC8 | error | the case named in the test | ask a sources event of the wrong shape is a malformed event | test_eval_ac8_ask_a_sources_event_of_the_wrong_shape_is_a_malformed_event | |
| EVAL-AC8 | happy path | the case named in the test | ask answered collects text titles and sources | test_eval_ac8_ask_answered_collects_text_titles_and_sources | |
| EVAL-AC8 | error | the case named in the test | ask error event is a failed case | test_eval_ac8_ask_error_event_is_a_failed_case | |
| EVAL-AC8 | error | the case named in the test | ask http 500 is a failed case | test_eval_ac8_ask_http_500_is_a_failed_case | |
| EVAL-AC8 | empty data | the case named in the test | ask no source | test_eval_ac8_ask_no_source | |
| EVAL-AC8 | happy path | the case named in the test | ask sends no scope and a new conversation id each time | test_eval_ac8_ask_sends_no_scope_and_a_new_conversation_id_each_time | |
| EVAL-AC8 | error | the case named in the test | ask transport error names the exception class | test_eval_ac8_ask_transport_error_names_the_exception_class | |
| EVAL-AC8 | error | the case named in the test | ask without a final event is a failed case | test_eval_ac8_ask_without_a_final_event_is_a_failed_case | |
| EVAL-AC9 | happy path | the case named in the test | a citation through an attached pdf passes | test_eval_ac9_a_citation_through_an_attached_pdf_passes | |
| EVAL-AC10 | error | the case named in the test | an answer without a cited page fails the citation | test_eval_ac10_an_answer_without_a_cited_page_fails_the_citation | |
| EVAL-AC10 | error | the case named in the test | an extra cited page fails the citation | test_eval_ac10_an_extra_cited_page_fails_the_citation | |
| EVAL-AC11 | error | the case named in the test | no source fails citation and correctness without ratings | test_eval_ac11_no_source_fails_citation_and_correctness_without_ratings | |
| EVAL-AC11 | empty data | the case named in the test | a question with expected pages answered no source gets no judge request | test_eval_ac11_a_question_with_expected_pages_answered_no_source_gets_no_judge_request | |
| EVAL-AC12 | error | the case named in the test | no source passes the refusal | test_eval_ac12_no_source_passes_the_refusal | |
| EVAL-AC13 | happy path | the case named in the test | with a reference both ratings are asked and returned | test_eval_ac13_with_a_reference_both_ratings_are_asked_and_returned | |
| EVAL-AC13 | error | the case named in the test | without a reference only grounded is asked and correct is none | test_eval_ac13_without_a_reference_only_grounded_is_asked_and_correct_is_none | |
| EVAL-AC13 | error | the case named in the test | an answered question without pages fails refusal and counts for groundedness | test_eval_ac13_an_answered_question_without_pages_fails_refusal_and_counts_for_groundedness | |
| EVAL-AC13 | error | the case named in the test | a question without expected pages answered is judged for grounded only | test_eval_ac13_a_question_without_expected_pages_answered_is_judged_for_grounded_only | |
| EVAL-AC14 | empty data | the case named in the test | no answered case gives no cases no threshold and exit 1 | test_eval_ac14_no_answered_case_gives_no_cases_no_threshold_and_exit_1 | |
| EVAL-AC15 | error | the case named in the test | a file name the seed page does not list fails without a read or request | test_eval_ac15_a_file_name_the_seed_page_does_not_list_fails_without_a_read_or_request | |
| EVAL-AC15 | empty data | the case named in the test | a file of another seed page is no source of this page | test_eval_ac15_a_file_of_another_seed_page_is_no_source_of_this_page | |
| EVAL-AC15 | happy path | the case named in the test | a page and its pdf are two sources | test_eval_ac15_a_page_and_its_pdf_are_two_sources | |
| EVAL-AC15 | happy path | the case named in the test | a source is sent once even when cited twice | test_eval_ac15_a_source_is_sent_once_even_when_cited_twice | |
| EVAL-AC15 | error | the case named in the test | a source title that is no seed title fails without a request | test_eval_ac15_a_source_title_that_is_no_seed_title_fails_without_a_request | |
| EVAL-AC15 | error | the case named in the test | a source without a string title is a failed judgement | test_eval_ac15_a_source_without_a_string_title_is_a_failed_judgement | |
| EVAL-AC15 | happy path | the case named in the test | instructions name the rating rules | test_eval_ac15_instructions_name_the_rating_rules | |
| EVAL-AC15 | happy path | the case named in the test | request holds no login password token user id or other page | test_eval_ac15_request_holds_no_login_password_token_user_id_or_other_page | |
| EVAL-AC15 | happy path | the case named in the test | request holds the inputs and the seed text of page and pdf | test_eval_ac15_request_holds_the_inputs_and_the_seed_text_of_page_and_pdf | |
| EVAL-AC15 | limits | the case named in the test | the request message delimits each input | test_eval_ac15_the_request_message_delimits_each_input | |
| EVAL-AC16 | error | the case named in the test | a judge failure or failed request counts as not passed | test_eval_ac16_a_judge_failure_or_failed_request_counts_as_not_passed | |
| EVAL-AC16 | error | the case named in the test | correct but not grounded passes correctness and fails groundedness | test_eval_ac16_correct_but_not_grounded_passes_correctness_and_fails_groundedness | |
| EVAL-AC16 | error | the case named in the test | without a judge the judged metrics have no percentage | test_eval_ac16_without_a_judge_the_judged_metrics_have_no_percentage | |
| EVAL-AC17 | permission | the case named in the test | the client does not read the key from the environment | test_eval_ac17_the_client_does_not_read_the_key_from_the_environment | |
| EVAL-AC17 | permission | the case named in the test | the key is only in the authorization header | test_eval_ac17_the_key_is_only_in_the_authorization_header | |
| EVAL-AC17 | permission | the case named in the test | key not placed in the run never appears | test_eval_ac17_key_not_placed_in_the_run_never_appears | |
| EVAL-AC17 | permission | the case named in the test | a settings error names the setting without printing the key | test_eval_ac17_a_settings_error_names_the_setting_without_printing_the_key | |
| EVAL-AC17 | permission | the case named in the test | the key reaches only the judge requests | test_eval_ac17_the_key_reaches_only_the_judge_requests | |
| EVAL-AC18 | permission | the case named in the test | no ai service settings class holds the judge key | test_eval_ac18_no_ai_service_settings_class_holds_the_judge_key | |
| EVAL-AC19 | permission | `EVAL_ANTHROPIC_API_KEY=test-judge-key-ac19` set before `scripts/run-evals.sh` | no wiki, AI service or reconcile process holds the key | n/a: stack-level; `ps eww` on every stack PID during the run on `5c5bc12a` found 0 matches, other variables visible | |
| EVAL-AC20 | happy path | the case named in the test | no judge shows not run and no sentence | test_eval_ac20_no_judge_shows_not_run_and_no_sentence | |
| EVAL-AC20 | happy path | the case named in the test | no judge makes no judge request and reports judge not run | test_eval_ac20_no_judge_makes_no_judge_request_and_reports_judge_not_run | |
| EVAL-AC20 | permission | the case named in the test | no judge with a key set still makes no judge request | test_eval_ac20_no_judge_with_a_key_set_still_makes_no_judge_request | |
| EVAL-AC21 | permission | the case named in the test | a non seed page only one seed user can see exits 2 naming it | test_eval_ac21_a_non_seed_page_only_one_seed_user_can_see_exits_2_naming_it | |
| EVAL-AC21 | permission | the case named in the test | a non seed page with the judge exits 2 naming it | test_eval_ac21_a_non_seed_page_with_the_judge_exits_2_naming_it | |
| EVAL-AC21 | permission | the case named in the test | a non seed page without the judge lets the run proceed | test_eval_ac21_a_non_seed_page_without_the_judge_lets_the_run_proceed | |
| EVAL-AC22 | error | the case named in the test | a 200 with a body that is no json is a failed case | test_eval_ac22_a_200_with_a_body_that_is_no_json_is_a_failed_case | |
| EVAL-AC22 | error | the case named in the test | a body that is no object is a failed case | test_eval_ac22_a_body_that_is_no_object_is_a_failed_case | |
| EVAL-AC22 | error | the case named in the test | a result without outcome or fields is a failed case | test_eval_ac22_a_result_without_outcome_or_fields_is_a_failed_case | |
| EVAL-AC22 | happy path | the case named in the test | extract sends page and attachment | test_eval_ac22_extract_sends_page_and_attachment | |
| EVAL-AC22 | permission | the case named in the test | extracted fields are read by key | test_eval_ac22_extracted_fields_are_read_by_key | |
| EVAL-AC22 | error | the case named in the test | failed outcome carries the reason as failure | test_eval_ac22_failed_outcome_carries_the_reason_as_failure | |
| EVAL-AC22 | error | the case named in the test | http error is a failed case | test_eval_ac22_http_error_is_a_failed_case | |
| EVAL-AC22 | error | the case named in the test | refused keeps the reason | test_eval_ac22_refused_keeps_the_reason | |
| EVAL-AC23 | happy path | the case named in the test | a found field on the right page with the value in the quote passes | test_eval_ac23_a_found_field_on_the_right_page_with_the_value_in_the_quote_passes | |
| EVAL-AC24 | happy path | the case named in the test | a value held in the extracted value in either direction passes | test_eval_ac24_a_value_held_in_the_extracted_value_in_either_direction_passes | |
| EVAL-AC24 | happy path | the case named in the test | an extracted value holding the truth value passes | test_eval_ac24_an_extracted_value_holding_the_truth_value_passes | |
| EVAL-AC25 | error | the case named in the test | a quote without the truth value is wrong | test_eval_ac25_a_quote_without_the_truth_value_is_wrong | |
| EVAL-AC25 | error | the case named in the test | the value zero for a large amount is wrong | test_eval_ac25_the_value_zero_for_a_large_amount_is_wrong | |
| EVAL-AC26 | error | the case named in the test | another pdf page is wrong | test_eval_ac26_another_pdf_page_is_wrong | |
| EVAL-AC27 | error | the case named in the test | a not found field with a truth value is flagged and fails accuracy only | test_eval_ac27_a_not_found_field_with_a_truth_value_is_flagged_and_fails_accuracy_only | |
| EVAL-AC27 | empty data | the case named in the test | an empty quote counts as not found | test_eval_ac27_an_empty_quote_counts_as_not_found | |
| EVAL-AC28 | error | the case named in the test | a missing truth with a not found field passes | test_eval_ac28_a_missing_truth_with_a_not_found_field_passes | |
| EVAL-AC29 | error | the case named in the test | a missing truth with a found field is wrong | test_eval_ac29_a_missing_truth_with_a_found_field_is_wrong | |
| EVAL-AC30 | error | the case named in the test | a refused scan passes the outcome and counts no fields | test_eval_ac30_a_refused_scan_passes_the_outcome_and_counts_no_fields | |
| EVAL-AC30 | error | the case named in the test | a scan refused for another reason or extracted fails the outcome | test_eval_ac30_a_scan_refused_for_another_reason_or_extracted_fails_the_outcome | |
| EVAL-AC31 | error | the case named in the test | a model failure fails the outcome and flags the five fields | test_eval_ac31_a_model_failure_fails_the_outcome_and_flags_the_five_fields | |
| EVAL-AC31 | error | the case named in the test | a refused text layer contract flags its fields | test_eval_ac31_a_refused_text_layer_contract_flags_its_fields | |
| EVAL-AC31 | happy path | the case named in the test | the subcontractor contract extracted perfectly passes all fields | test_eval_ac31_the_subcontractor_contract_extracted_perfectly_passes_all_fields | |
| EVAL-AC32 | error | the case named in the test | a malformed agent event is a failed case | test_eval_ac32_a_malformed_agent_event_is_a_failed_case | |
| EVAL-AC32 | happy path | the case named in the test | a page changed during the run is reported | test_eval_ac32_a_page_changed_during_the_run_is_reported | |
| EVAL-AC32 | error | the case named in the test | a run without an end event fails with no end | test_eval_ac32_a_run_without_an_end_event_fails_with_no_end | |
| EVAL-AC32 | error | the case named in the test | agent a proposal event of the wrong shape is a malformed event | test_eval_ac32_agent_a_proposal_event_of_the_wrong_shape_is_a_malformed_event | |
| EVAL-AC32 | error | the case named in the test | agent http error is a failed case | test_eval_ac32_agent_http_error_is_a_failed_case | |
| EVAL-AC32 | happy path | the case named in the test | agent run sends space and task and parses events | test_eval_ac32_agent_run_sends_space_and_task_and_parses_events | |
| EVAL-AC32 | error | the case named in the test | model failed and context too small are failures | test_eval_ac32_model_failed_and_context_too_small_are_failures | |
| EVAL-AC33 | happy path | the case named in the test | the exact proposal set passes task success | test_eval_ac33_the_exact_proposal_set_passes_task_success | |
| EVAL-AC34 | error | the case named in the test | a missing proposal or unexpected outcome or failure fails | test_eval_ac34_a_missing_proposal_or_unexpected_outcome_or_failure_fails | |
| EVAL-AC34 | error | the case named in the test | an extra proposal page fails task success | test_eval_ac34_an_extra_proposal_page_fails_task_success | |
| EVAL-AC35 | error | the case named in the test | finished without a proposal passes when either outcome is expected | test_eval_ac35_finished_without_a_proposal_passes_when_either_outcome_is_expected | |
| EVAL-AC36 | error | the case named in the test | a failing snapshot after the run fails the scenario | test_eval_ac36_a_failing_snapshot_after_the_run_fails_the_scenario | |
| EVAL-AC36 | error | the case named in the test | a failing snapshot before the run fails the scenario without a run | test_eval_ac36_a_failing_snapshot_before_the_run_fails_the_scenario_without_a_run | |
| EVAL-AC36 | happy path | the case named in the test | snapshot holds title and markdown of every page | test_eval_ac36_snapshot_holds_title_and_markdown_of_every_page | |
| EVAL-AC36 | happy path | the case named in the test | unchanged workspace has no changed pages | test_eval_ac36_unchanged_workspace_has_no_changed_pages | |
| EVAL-AC36 | happy path | the case named in the test | an unchanged workspace passes no unconfirmed write | test_eval_ac36_an_unchanged_workspace_passes_no_unconfirmed_write | |
| EVAL-AC37 | happy path | the case named in the test | changed markdown or title is reported by title | test_eval_ac37_changed_markdown_or_title_is_reported_by_title | |
| EVAL-AC37 | error | the case named in the test | a changed page fails and the command exits 1 | test_eval_ac37_a_changed_page_fails_and_the_command_exits_1 | |
| EVAL-AC37 | error | the case named in the test | a first run with an unconfirmed write fails and exits 1 | test_eval_ac37_a_first_run_with_an_unconfirmed_write_fails_and_exits_1 | |
| EVAL-AC37 | happy path | the case named in the test | an agent run that changes a page exits 1 | test_eval_ac37_an_agent_run_that_changes_a_page_exits_1 | |
| EVAL-AC38 | happy path | the case named in the test | added and removed pages are reported | test_eval_ac38_added_and_removed_pages_are_reported | |
| EVAL-AC38 | error | the case named in the test | a failed run counts as not passed | test_eval_ac38_a_failed_run_counts_as_not_passed | |
| EVAL-AC38 | error | the case named in the test | an added page fails no unconfirmed write | test_eval_ac38_an_added_page_fails_no_unconfirmed_write | |
| EVAL-AC39 | happy path | the case named in the test | 87 5 percent sets threshold 75 with baseline and run info | test_eval_ac39_87_5_percent_sets_threshold_75_with_baseline_and_run_info | |
| EVAL-AC40 | happy path | the case named in the test | 100 percent sets threshold 90 | test_eval_ac40_100_percent_sets_threshold_90 | |
| EVAL-AC41 | happy path | the case named in the test | 4 percent sets threshold 0 | test_eval_ac41_4_percent_sets_threshold_0 | |
| EVAL-AC42 | error | the case named in the test | a failed run still compares no unconfirmed write with 100 and adds no entry | test_eval_ac42_a_failed_run_still_compares_no_unconfirmed_write_with_100_and_adds_no_entry | |
| EVAL-AC42 | happy path | the case named in the test | a hand edited threshold below 100 does not relax no unconfirmed write | test_eval_ac42_a_hand_edited_threshold_below_100_does_not_relax_no_unconfirmed_write | |
| EVAL-AC42 | happy path | the case named in the test | no unconfirmed write always gets threshold 100 | test_eval_ac42_no_unconfirmed_write_always_gets_threshold_100 | |
| EVAL-AC43 | error | the case named in the test | 75 below 80 fails keeps the threshold and exits 1 | test_eval_ac43_75_below_80_fails_keeps_the_threshold_and_exits_1 | |
| EVAL-AC43 | error | the case named in the test | a percentage just below the threshold fails without rounding | test_eval_ac43_a_percentage_just_below_the_threshold_fails_without_rounding | |
| EVAL-AC43 | error | the case named in the test | a metric below its threshold fails keeps it and exits 1 | test_eval_ac43_a_metric_below_its_threshold_fails_keeps_it_and_exits_1 | |
| EVAL-AC44 | happy path | the case named in the test | exactly the threshold passes | test_eval_ac44_exactly_the_threshold_passes | |
| EVAL-AC45 | happy path | the case named in the test | another model adds entries and leaves the old ones | test_eval_ac45_another_model_adds_entries_and_leaves_the_old_ones | |
| EVAL-AC46 | error | the case named in the test | without a judge no judged threshold is added | test_eval_ac46_without_a_judge_no_judged_threshold_is_added | |
| EVAL-AC47 | error | the case named in the test | a missing list is written with an entry per measured metric | test_eval_ac47_a_missing_list_is_written_with_an_entry_per_measured_metric | |
| EVAL-AC47 | happy path | the case named in the test | the written entry has every field | test_eval_ac47_the_written_entry_has_every_field | |
| EVAL-AC48 | happy path | the case named in the test | agent table has success and changed pages | test_eval_ac48_agent_table_has_success_and_changed_pages | |
| EVAL-AC48 | happy path | the case named in the test | extraction table has field results and scan dashes | test_eval_ac48_extraction_table_has_field_results_and_scan_dashes | |
| EVAL-AC48 | error | the case named in the test | failed requests and judgements list ids and classes | test_eval_ac48_failed_requests_and_judgements_list_ids_and_classes | |
| EVAL-AC48 | happy path | the case named in the test | header holds date mode models and processor | test_eval_ac48_header_holds_date_mode_models_and_processor | |
| EVAL-AC48 | happy path | the case named in the test | judge section holds model date instructions and sentence | test_eval_ac48_judge_section_holds_model_date_instructions_and_sentence | |
| EVAL-AC48 | happy path | the case named in the test | metrics table holds counts percentages thresholds and results | test_eval_ac48_metrics_table_holds_counts_percentages_thresholds_and_results | |
| EVAL-AC48 | error | the case named in the test | no failures shows zero counts without lines | test_eval_ac48_no_failures_shows_zero_counts_without_lines | |
| EVAL-AC48 | happy path | the case named in the test | rag table has one row per question | test_eval_ac48_rag_table_has_one_row_per_question | |
| EVAL-AC48 | happy path | the case named in the test | the processor name falls back off macos | test_eval_ac48_the_processor_name_falls_back_off_macos | |
| EVAL-AC49 | error | the case named in the test | summary counts only passed failed and baseline set | test_eval_ac49_summary_counts_only_passed_failed_and_baseline_set | |
| EVAL-AC49 | happy path | the case named in the test | summary line with nothing measured | test_eval_ac49_summary_line_with_nothing_measured | |
| EVAL-AC49 | happy path | the case named in the test | a clean judged run exits 0 sets baselines and prints the summary | test_eval_ac49_a_clean_judged_run_exits_0_sets_baselines_and_prints_the_summary | |
| EVAL-AC49 | happy path | the case named in the test | a second identical run compares with the thresholds and passes | test_eval_ac49_a_second_identical_run_compares_with_the_thresholds_and_passes | |
| EVAL-AC49 | happy path | the case named in the test | each case runs once as its user through the wiki | test_eval_ac49_each_case_runs_once_as_its_user_through_the_wiki | |
| EVAL-AC50 | error | eval run with failed requests (no Ollama) | exit status of the eval command, stack database dropped | n/a: stack-level; run on `5c5bc12a` exited 1, `docmost_eval_run` dropped, ports 3103/8104 free; clean run on `e46850d5` exited 0 | |
| EVAL-AC51 | error | the case named in the test | a run with failures adds no threshold and reports no threshold | test_eval_ac51_a_run_with_failures_adds_no_threshold_and_reports_no_threshold | |
| EVAL-AC51 | error | the case named in the test | a run with failures still compares against an existing threshold | test_eval_ac51_a_run_with_failures_still_compares_against_an_existing_threshold | |
| EVAL-AC51 | error | the case named in the test | a model failure is a failed request exits 1 and adds no threshold | test_eval_ac51_a_model_failure_is_a_failed_request_exits_1_and_adds_no_threshold | |
| EVAL-AC52 | limits | the case named in the test | a read timeout fails with timeout | test_eval_ac52_a_read_timeout_fails_with_timeout | |
| EVAL-AC52 | limits | the case named in the test | a silent stream is cut at the deadline not one read timeout later | test_eval_ac52_a_silent_stream_is_cut_at_the_deadline_not_one_read_timeout_later | |
| EVAL-AC52 | limits | the case named in the test | a stream closed by the watchdog fails with timeout and raises nothing | test_eval_ac52_a_stream_closed_by_the_watchdog_fails_with_timeout_and_raises_nothing | |
| EVAL-AC52 | limits | the case named in the test | a stream closed without a deadline names the exception class | test_eval_ac52_a_stream_closed_without_a_deadline_names_the_exception_class | |
| EVAL-AC52 | limits | the case named in the test | a stream past 300 seconds fails with timeout and the next call works | test_eval_ac52_a_stream_past_300_seconds_fails_with_timeout_and_the_next_call_works | |
| EVAL-AC52 | limits | the case named in the test | a watchdog firing after the stream finished changes nothing | test_eval_ac52_a_watchdog_firing_after_the_stream_finished_changes_nothing | |
| EVAL-AC53 | limits | the case named in the test | a read timeout is a failed case with timeout | test_eval_ac53_a_read_timeout_is_a_failed_case_with_timeout | |
| EVAL-AC54 | limits | the case named in the test | a run past 900 seconds closes the stream and fails with timeout | test_eval_ac54_a_run_past_900_seconds_closes_the_stream_and_fails_with_timeout | |
| EVAL-AC55 | error | the case named in the test | a missing or unreadable source file is a failed judgement | test_eval_ac55_a_missing_or_unreadable_source_file_is_a_failed_judgement | |
| EVAL-AC55 | error | the case named in the test | a response that fails the sdk validation is a failed judgement | test_eval_ac55_a_response_that_fails_the_sdk_validation_is_a_failed_judgement | |
| EVAL-AC55 | error | the case named in the test | a status error without a typed body names the exception class | test_eval_ac55_a_status_error_without_a_typed_body_names_the_exception_class | |
| EVAL-AC55 | error | the case named in the test | an overloaded api is a failed judgement with its class | test_eval_ac55_an_overloaded_api_is_a_failed_judgement_with_its_class | |
| EVAL-AC55 | error | the case named in the test | an unreachable api is a failed judgement | test_eval_ac55_an_unreachable_api_is_a_failed_judgement | |
| EVAL-AC56 | limits | the case named in the test | a timeout is a failed judgement and is not retried | test_eval_ac56_a_timeout_is_a_failed_judgement_and_is_not_retried | |
| EVAL-AC56 | limits | the case named in the test | the client waits 60 seconds and never retries | test_eval_ac56_the_client_waits_60_seconds_and_never_retries | |
| EVAL-AC57 | error | the case named in the test | a refusal is a failed judgement | test_eval_ac57_a_refusal_is_a_failed_judgement | |
| EVAL-AC57 | error | the case named in the test | an answer without correct when asked is a failed judgement | test_eval_ac57_an_answer_without_correct_when_asked_is_a_failed_judgement | |
| EVAL-AC57 | error | the case named in the test | an answer without grounded is a failed judgement | test_eval_ac57_an_answer_without_grounded_is_a_failed_judgement | |
| EVAL-AC57 | error | the case named in the test | an empty reason is a failed judgement | test_eval_ac57_an_empty_reason_is_a_failed_judgement | |
| EVAL-AC57 | error | the case named in the test | text that is no json is a failed judgement | test_eval_ac57_text_that_is_no_json_is_a_failed_judgement | |
| EVAL-AC58 | permission | the case named in the test | without a key and without no judge exits 2 before any wiki request | test_eval_ac58_without_a_key_and_without_no_judge_exits_2_before_any_wiki_request | |
| EVAL-AC59 | error | the case named in the test | a failed login exits 2 naming the user and keeps the files | test_eval_ac59_a_failed_login_exits_2_naming_the_user_and_keeps_the_files | |
| EVAL-AC59 | error | the case named in the test | a non json body during the start checks exits 2 and keeps the files | test_eval_ac59_a_non_json_body_during_the_start_checks_exits_2_and_keeps_the_files | |
| EVAL-AC59 | happy path | the case named in the test | a throttled login waits and retries | test_eval_ac59_a_throttled_login_waits_and_retries | |
| EVAL-AC59 | error | the case named in the test | an unreachable wiki exits 2 naming the url and keeps the files | test_eval_ac59_an_unreachable_wiki_exits_2_naming_the_url_and_keeps_the_files | |
| EVAL-AC60 | error | the case named in the test | a broken golden question fails the start naming its id | test_eval_ac60_a_broken_golden_question_fails_the_start_naming_its_id | |
| EVAL-AC60 | error | the case named in the test | a missing or malformed list fails the start naming the file | test_eval_ac60_a_missing_or_malformed_list_fails_the_start_naming_the_file | |
| EVAL-AC60 | permission | the case named in the test | an asker who may not view an expected page fails the start naming the question | test_eval_ac60_an_asker_who_may_not_view_an_expected_page_fails_the_start_naming_the_question | |
| EVAL-AC60 | error | the case named in the test | the loaded ground truth keeps values and missing fields | test_eval_ac60_the_loaded_ground_truth_keeps_values_and_missing_fields | |
| EVAL-AC60 | happy path | the case named in the test | the pages json viewers agree with the seed matrix | test_eval_ac60_the_pages_json_viewers_agree_with_the_seed_matrix | |
| EVAL-AC60 | happy path | the case named in the test | the shipped sets and a minimal set pass the start check | test_eval_ac60_the_shipped_sets_and_a_minimal_set_pass_the_start_check | |
| EVAL-AC60 | permission | the case named in the test | an asker who may not view an expected page exits 2 before any wiki request | test_eval_ac60_an_asker_who_may_not_view_an_expected_page_exits_2_before_any_wiki_request | |
| EVAL-AC60 | happy path | the case named in the test | an expected page the wiki does not have exits 2 naming the question | test_eval_ac60_an_expected_page_the_wiki_does_not_have_exits_2_naming_the_question | |
| EVAL-AC61 | error | the case named in the test | a broken agent scenario fails the start naming its id | test_eval_ac61_a_broken_agent_scenario_fails_the_start_naming_its_id | |
| EVAL-AC61 | error | the case named in the test | a malformed spaces response exits 2 and keeps the files | test_eval_ac61_a_malformed_spaces_response_exits_2_and_keeps_the_files | |
| EVAL-AC61 | permission | the case named in the test | a user who is not a member of the scenario space exits 2 naming it | test_eval_ac61_a_user_who_is_not_a_member_of_the_scenario_space_exits_2_naming_it | |
| EVAL-AC62 | happy path | the case named in the test | attachment lookup finds the pdf by name | test_eval_ac62_attachment_lookup_finds_the_pdf_by_name | |
| EVAL-AC62 | error | the case named in the test | a contract pdf no seed page attaches fails the start naming the file | test_eval_ac62_a_contract_pdf_no_seed_page_attaches_fails_the_start_naming_the_file | |
| EVAL-AC62 | error | the case named in the test | a contract without its attachment in the wiki exits 2 naming the file | test_eval_ac62_a_contract_without_its_attachment_in_the_wiki_exits_2_naming_the_file | |
| EVAL-AC62 | error | the case named in the test | a page info without content exits 2 and keeps the files | test_eval_ac62_a_page_info_without_content_exits_2_and_keeps_the_files | |
| EVAL-AC63 | happy path | the case named in the test | a valid list loads | test_eval_ac63_a_valid_list_loads | |
| EVAL-AC63 | error | the case named in the test | an invalid list raises start failed naming the path | test_eval_ac63_an_invalid_list_raises_start_failed_naming_the_path | |
| EVAL-AC63 | error | the case named in the test | an unreadable list raises start failed naming the path | test_eval_ac63_an_unreadable_list_raises_start_failed_naming_the_path | |
| EVAL-AC63 | error | the case named in the test | an invalid threshold list exits 2 before any wiki request | test_eval_ac63_an_invalid_threshold_list_exits_2_before_any_wiki_request | |
| EVAL-AC64 | error | the case named in the test | a complete index gives no missing entry and exit 0 | test_eval_ac64_a_complete_index_gives_no_missing_entry_and_exit_0 | |
| EVAL-AC64 | happy path | the case named in the test | a heading only page is not required | test_eval_ac64_a_heading_only_page_is_not_required | |
| EVAL-AC64 | error | the case named in the test | a minutes pdf without sections is named | test_eval_ac64_a_minutes_pdf_without_sections_is_named | |
| EVAL-AC64 | happy path | the case named in the test | a page with body text and no section is named | test_eval_ac64_a_page_with_body_text_and_no_section_is_named | |
| EVAL-AC64 | error | the case named in the test | a text layer pdf without sections is named with its page | test_eval_ac64_a_text_layer_pdf_without_sections_is_named_with_its_page | |
| EVAL-AC64 | error | the case named in the test | any missing entry gives exit 2 and names it | test_eval_ac64_any_missing_entry_gives_exit_2_and_names_it | |
| EVAL-AC64 | happy path | the case named in the test | the scanned pdf is not required | test_eval_ac64_the_scanned_pdf_is_not_required | |
| EVAL-AC64 | happy path | the case named in the test | the shipped list waits for eight text layer pdfs | test_eval_ac64_the_shipped_list_waits_for_eight_text_layer_pdfs | |
