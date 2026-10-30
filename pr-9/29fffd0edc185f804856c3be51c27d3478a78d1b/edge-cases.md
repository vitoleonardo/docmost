# Edge cases

ai-service only; no UI, so no browser rows. Integration-only rows (n/a) need the dev Postgres and ran in the local integration run of verify step 3 (see data-runs notes in the state file). The Ollama streamed-usage check against the live model is a data-run item.

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| REQLOG-AC1 | happy path | the case named in the test | an answered question finishes one ask row with status answered | test_reqlog_ac1_an_answered_question_finishes_one_ask_row_with_status_answered | |
| REQLOG-AC1 | error | the case named in the test | an exception that escapes finishes with status error | test_reqlog_ac1_an_exception_that_escapes_finishes_with_status_error | |
| REQLOG-AC2 | empty data | the case named in the test | a no source answer finishes with zero tokens and no model call | test_reqlog_ac2_a_no_source_answer_finishes_with_zero_tokens_and_no_model_call | |
| REQLOG-AC2 | empty data | the case named in the test | a no source decided after the model ran keeps its token counts | test_reqlog_ac2_a_no_source_decided_after_the_model_ran_keeps_its_token_counts | |
| REQLOG-AC3 | empty data | the case named in the test | a failing model finishes with status model failed and empty tokens | test_reqlog_ac3_a_failing_model_finishes_with_status_model_failed_and_empty_tokens | |
| REQLOG-AC4 | error | the case named in the test | a client disconnect does not wait for a database that never answers | test_reqlog_ac4_a_client_disconnect_does_not_wait_for_a_database_that_never_answers | |
| REQLOG-AC4 | empty data | the case named in the test | closing the stream after a delta finishes stopped with empty tokens | test_reqlog_ac4_ac18_closing_the_stream_after_a_delta_finishes_stopped_with_empty_tokens | |
| REQLOG-AC5 | happy path | the case named in the test | an extracted result writes one extraction record | test_reqlog_ac5_an_extracted_result_writes_one_extraction_record | |
| REQLOG-AC5 | happy path | the case named in the test | the extraction log line leaves out the request log | test_reqlog_ac5_the_extraction_log_line_leaves_out_the_request_log | |
| REQLOG-AC5 | happy path | the case named in the test | the user and workspace from the token reach the record | test_reqlog_ac5_the_user_and_workspace_from_the_token_reach_the_record | |
| REQLOG-AC6 | limits | the case named in the test | a file over the size limit is logged as too large without tokens | test_reqlog_ac6_a_file_over_the_size_limit_is_logged_as_too_large_without_tokens | |
| REQLOG-AC6 | empty data | the case named in the test | a refusal before the model logs its reason without tokens | test_reqlog_ac6_a_refusal_before_the_model_logs_its_reason_without_tokens | |
| REQLOG-AC6 | happy path | the case named in the test | a too small context is logged with the models counts | test_reqlog_ac6_a_too_small_context_is_logged_with_the_models_counts | |
| REQLOG-AC7 | error | the case named in the test | an unavailable model is logged as model failed with unknown tokens | test_reqlog_ac7_an_unavailable_model_is_logged_as_model_failed_with_unknown_tokens | |
| REQLOG-AC8 | error | the case named in the test | a failing create run writes one error record and reraises | test_reqlog_ac8_a_failing_create_run_writes_one_error_record_and_reraises | |
| REQLOG-AC8 | happy path | the case named in the test | a run ending with a final message writes one finished record | test_reqlog_ac8_a_run_ending_with_a_final_message_writes_one_finished_record | |
| REQLOG-AC8 | empty data | the case named in the test | a wiki failure at the task token writes one error record without tokens | test_reqlog_ac8_a_wiki_failure_at_the_task_token_writes_one_error_record_without_tokens | |
| REQLOG-AC8 | error | the case named in the test | a wiki failure before the stream is 503 with one error record | test_reqlog_ac8_a_wiki_failure_before_the_stream_is_503_with_one_error_record | |
| REQLOG-AC8 | error | the case named in the test | an unexpected exception writes one error record | test_reqlog_ac8_an_unexpected_exception_writes_one_error_record | |
| REQLOG-AC8 | happy path | the case named in the test | the record is written after the end event | test_reqlog_ac8_the_record_is_written_after_the_end_event | |
| REQLOG-AC8 | limits | the case named in the test | the token limit keeps summing prompt and completion | test_reqlog_ac8_the_token_limit_keeps_summing_prompt_and_completion | |
| REQLOG-AC9 | error | the case named in the test | a cancelled run writes one cancelled record | test_reqlog_ac9_a_cancelled_run_writes_one_cancelled_record | |
| REQLOG-AC9 | error | the case named in the test | closing the event stream writes one cancelled record | test_reqlog_ac9_closing_the_event_stream_writes_one_cancelled_record | |
| REQLOG-AC10 | limits | the case named in the test | the step limit writes one step limit record | test_reqlog_ac10_the_step_limit_writes_one_step_limit_record | |
| REQLOG-AC11 | missing permission / rejected request | the case named in the test | a request with an invalid user token starts no record | test_reqlog_ac11_a_request_with_an_invalid_user_token_starts_no_record | |
| REQLOG-AC11 | missing permission / rejected request | the case named in the test | an invalid user token never starts an extraction record | test_reqlog_ac11_an_invalid_user_token_never_starts_an_extraction_record | |
| REQLOG-AC12 | missing permission / rejected request | the case named in the test | a run in progress is refused before the runner is prepared | test_reqlog_ac12_a_run_in_progress_is_refused_before_the_runner_is_prepared | |
| REQLOG-AC12 | missing permission / rejected request | the case named in the test | a second run while one is running is 409 and starts no record | test_reqlog_ac12_a_second_run_while_one_is_running_is_409_and_starts_no_record | |
| REQLOG-AC13 | missing permission / rejected request | the case named in the test | viewing applying or discarding a proposal starts no record | test_reqlog_ac13_viewing_applying_or_discarding_a_proposal_starts_no_record | |
| REQLOG-AC14 | happy path | the case named in the test | api mode cost uses the price of the accepted day | test_reqlog_ac14_api_mode_cost_uses_the_price_of_the_accepted_day | |
| REQLOG-AC14 | empty data | the case named in the test | api mode with an empty count has no cost | test_reqlog_ac14_api_mode_with_an_empty_count_has_no_cost | |
| REQLOG-AC14 | duplicates / concurrency | the case named in the test | each record has its own id | test_reqlog_ac14_each_record_has_its_own_id | |
| REQLOG-AC14 | happy path | the case named in the test | finish writes one row with mode and model | n/a: integration test test_reqlog_ac14_finish_writes_one_row_with_mode_and_model (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC14 | empty data | the case named in the test | local mode costs zero | test_reqlog_ac14_local_mode_costs_zero | |
| REQLOG-AC14 | happy path | the case named in the test | record holds the task mode model status and workspace | test_reqlog_ac14_record_holds_the_task_mode_model_status_and_workspace | |
| REQLOG-AC15 | empty data | the case named in the test | a chunk without choices and without usage is still malformed | test_reqlog_ac15_a_chunk_without_choices_and_without_usage_is_still_malformed | |
| REQLOG-AC15 | happy path | the case named in the test | a final usage chunk fills both counts and adds no text | test_reqlog_ac15_a_final_usage_chunk_fills_both_counts_and_adds_no_text | |
| REQLOG-AC15 | empty data | the case named in the test | a model that reports no counts gives unknown tokens | test_reqlog_ac15_a_model_that_reports_no_counts_gives_unknown_tokens | |
| REQLOG-AC15 | empty data | the case named in the test | a non integer count stays none | test_reqlog_ac15_a_non_integer_count_stays_none | |
| REQLOG-AC15 | empty data | the case named in the test | a stream without a usage object still works | test_reqlog_ac15_a_stream_without_a_usage_object_still_works | |
| REQLOG-AC15 | happy path | the case named in the test | the counts the model reports are recorded | test_reqlog_ac15_the_counts_the_model_reports_are_recorded | |
| REQLOG-AC15 | happy path | the case named in the test | the stream request asks for a usage chunk | test_reqlog_ac15_the_stream_request_asks_for_a_usage_chunk | |
| REQLOG-AC15 | happy path | the case named in the test | usage on the last chunk that still has choices is read | test_reqlog_ac15_usage_on_the_last_chunk_that_still_has_choices_is_read | |
| REQLOG-AC16 | happy path | the case named in the test | three model calls are summed per run | test_reqlog_ac16_three_model_calls_are_summed_per_run | |
| REQLOG-AC17 | empty data | the case named in the test | a failing third call leaves both counts empty | test_reqlog_ac17_a_failing_third_call_leaves_both_counts_empty | |
| REQLOG-AC17 | error | the case named in the test | an unexpected model error is logged as error with unknown tokens | test_reqlog_ac17_an_unexpected_model_error_is_logged_as_error_with_unknown_tokens | |
| REQLOG-AC18 | empty data | the case named in the test | a consumer that stops early leaves both counts none | test_reqlog_ac18_a_consumer_that_stops_early_leaves_both_counts_none | |
| REQLOG-AC18 | empty data | the case named in the test | a stream without a usage chunk leaves both counts none | test_reqlog_ac18_a_stream_without_a_usage_chunk_leaves_both_counts_none | |
| REQLOG-AC19 | happy path | the case named in the test | latency is measured from the start to the end of the request | test_reqlog_ac19_latency_is_measured_from_the_start_to_the_end_of_the_request | |
| REQLOG-AC19 | happy path | the case named in the test | the latency of a run includes the task token exchange | test_reqlog_ac19_the_latency_of_a_run_includes_the_task_token_exchange | |
| REQLOG-AC20 | happy path | the case named in the test | latency ends when finish is called not when the row is written | test_reqlog_ac20_latency_ends_when_finish_is_called_not_when_the_row_is_written | |
| REQLOG-AC20 | happy path | the case named in the test | latency is whole milliseconds from start to finish | test_reqlog_ac20_latency_is_whole_milliseconds_from_start_to_finish | |
| REQLOG-AC20 | happy path | the case named in the test | time is cut in utc | test_reqlog_ac20_time_is_cut_in_utc | |
| REQLOG-AC20 | happy path | the case named in the test | time is the accepted time cut to the hour | test_reqlog_ac20_time_is_the_accepted_time_cut_to_the_hour | |
| REQLOG-AC21 | happy path | the case named in the test | the workspace of the session is recorded | test_reqlog_ac21_the_workspace_of_the_session_is_recorded | |
| REQLOG-AC21 | happy path | the case named in the test | the workspace of the user token reaches the record | test_reqlog_ac21_the_workspace_of_the_user_token_reaches_the_record | |
| REQLOG-AC22 | happy path | the case named in the test | pseudonym is the hmac of the user id keyed with the secret | test_reqlog_ac22_pseudonym_is_the_hmac_of_the_user_id_keyed_with_the_secret | |
| REQLOG-AC22 | happy path | the case named in the test | pseudonym matches the rfc4231 hmac sha256 vector | test_reqlog_ac22_pseudonym_matches_the_rfc4231_hmac_sha256_vector | |
| REQLOG-AC22 | happy path | the case named in the test | record carries the pseudonym not the user id | test_reqlog_ac22_record_carries_the_pseudonym_not_the_user_id | |
| REQLOG-AC23 | happy path | the case named in the test | same user gets the same pseudonym | test_reqlog_ac23_same_user_gets_the_same_pseudonym | |
| REQLOG-AC24 | happy path | the case named in the test | different secrets give different pseudonyms | test_reqlog_ac24_different_secrets_give_different_pseudonyms | |
| REQLOG-AC24 | happy path | the case named in the test | different users get different pseudonyms | test_reqlog_ac24_different_users_get_different_pseudonyms | |
| REQLOG-AC25 | happy path | the case named in the test | downgrade drops the request log and upgrade restores it | n/a: integration test test_reqlog_ac25_downgrade_drops_the_request_log_and_upgrade_restores_it (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC25 | happy path | the case named in the test | record fields are the table columns | test_reqlog_ac25_record_fields_are_the_table_columns | |
| REQLOG-AC25 | happy path | the case named in the test | row holds no user id | n/a: integration test test_reqlog_ac25_row_holds_no_user_id (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC25 | happy path | the case named in the test | table holds exactly the planned columns | n/a: integration test test_reqlog_ac25_table_holds_exactly_the_planned_columns (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC25 | happy path | the case named in the test | table refuses values outside its checks | n/a: integration test test_reqlog_ac25_table_refuses_values_outside_its_checks (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC26 | empty data | the case named in the test | start without the log secret exits naming it | test_reqlog_ac26_start_without_the_log_secret_exits_naming_it | |
| REQLOG-AC27 | limits | the case named in the test | log secret of 31 characters exits naming it without its value | test_reqlog_ac27_log_secret_of_31_characters_exits_naming_it_without_its_value | |
| REQLOG-AC28 | happy path | the case named in the test | local mode value is the settings default | test_reqlog_ac28_local_mode_value_is_the_settings_default | |
| REQLOG-AC28 | empty data | the case named in the test | local mode with entry costs zero | test_reqlog_ac28_local_mode_with_entry_costs_zero | |
| REQLOG-AC28 | empty data | the case named in the test | local mode without entry costs zero | test_reqlog_ac28_local_mode_without_entry_costs_zero | |
| REQLOG-AC29 | happy path | the case named in the test | api mode costs tokens times price | test_reqlog_ac29_api_mode_costs_tokens_times_price | |
| REQLOG-AC29 | happy path | the case named in the test | cost has six decimal places | test_reqlog_ac29_cost_has_six_decimal_places | |
| REQLOG-AC29 | happy path | the case named in the test | entry valid from the same day applies | test_reqlog_ac29_entry_valid_from_the_same_day_applies | |
| REQLOG-AC29 | happy path | the case named in the test | rounds down below half at the sixth place | test_reqlog_ac29_rounds_down_below_half_at_the_sixth_place | |
| REQLOG-AC29 | happy path | the case named in the test | rounds half up at the sixth place | test_reqlog_ac29_rounds_half_up_at_the_sixth_place | |
| REQLOG-AC30 | happy path | the case named in the test | entry after the day is ignored | test_reqlog_ac30_entry_after_the_day_is_ignored | |
| REQLOG-AC30 | happy path | the case named in the test | latest entry on or before the day wins | test_reqlog_ac30_latest_entry_on_or_before_the_day_wins | |
| REQLOG-AC31 | empty data | the case named in the test | entry only after the day gives no cost | test_reqlog_ac31_entry_only_after_the_day_gives_no_cost | |
| REQLOG-AC32 | empty data | the case named in the test | empty price table gives no cost | test_reqlog_ac32_empty_price_table_gives_no_cost | |
| REQLOG-AC32 | happy path | the case named in the test | model name must match exactly | test_reqlog_ac32_model_name_must_match_exactly | |
| REQLOG-AC32 | empty data | the case named in the test | model without entry gives no cost | test_reqlog_ac32_model_without_entry_gives_no_cost | |
| REQLOG-AC33 | empty data | the case named in the test | empty completion tokens give no cost | test_reqlog_ac33_empty_completion_tokens_give_no_cost | |
| REQLOG-AC33 | empty data | the case named in the test | empty prompt tokens give no cost | test_reqlog_ac33_empty_prompt_tokens_give_no_cost | |
| REQLOG-AC33 | empty data | the case named in the test | zero tokens cost zero | test_reqlog_ac33_zero_tokens_cost_zero | |
| REQLOG-AC34 | duplicates / concurrency | the case named in the test | shipped entries are unique per model and date | test_reqlog_ac34_shipped_entries_are_unique_per_model_and_date | |
| REQLOG-AC34 | happy path | the case named in the test | shipped entries have every field | test_reqlog_ac34_shipped_entries_have_every_field | |
| REQLOG-AC34 | happy path | the case named in the test | shipped prices match the decision | test_reqlog_ac34_shipped_prices_match_the_decision | |
| REQLOG-AC34 | happy path | the case named in the test | shipped sonnet price applies on the read day | test_reqlog_ac34_shipped_sonnet_price_applies_on_the_read_day | |
| REQLOG-AC34 | happy path | the case named in the test | shipped table has both api models | test_reqlog_ac34_shipped_table_has_both_api_models | |
| REQLOG-AC35 | error | the case named in the test | an unreachable log database changes nothing the client receives | test_reqlog_ac35_an_unreachable_log_database_changes_nothing_the_client_receives | |
| REQLOG-AC35 | happy path | the case named in the test | finish hands the row to the writer and returns at once | test_reqlog_ac35_finish_hands_the_row_to_the_writer_and_returns_at_once | |
| REQLOG-AC35 | happy path | the case named in the test | the api writes the queued rows before it exits | test_reqlog_ac35_the_api_writes_the_queued_rows_before_it_exits | |
| REQLOG-AC36 | error | the case named in the test | a failing write logs one line and the writer goes on | test_reqlog_ac36_a_failing_write_logs_one_line_and_the_writer_goes_on | |
| REQLOG-AC36 | limits | the case named in the test | a full queue drops the row with one failure line without blocking | test_reqlog_ac36_a_full_queue_drops_the_row_with_one_failure_line_without_blocking | |
| REQLOG-AC36 | error | the case named in the test | a row after close is dropped with one failure line | test_reqlog_ac36_a_row_after_close_is_dropped_with_one_failure_line | |
| REQLOG-AC36 | empty data | the case named in the test | close and flush without any row return at once | test_reqlog_ac36_close_and_flush_without_any_row_return_at_once | |
| REQLOG-AC36 | limits | the case named in the test | close gives up on a hanging write within its timeout | test_reqlog_ac36_close_gives_up_on_a_hanging_write_within_its_timeout | |
| REQLOG-AC36 | happy path | the case named in the test | flush after close has started returns false at once | test_reqlog_ac36_flush_after_close_has_started_returns_false_at_once | |
| REQLOG-AC36 | limits | the case named in the test | the queue holds 1000 rows | test_reqlog_ac36_the_queue_holds_1000_rows | |
| REQLOG-AC36 | empty data | the case named in the test | write failure logs one line without user or pseudonym | n/a: integration test test_reqlog_ac36_write_failure_logs_one_line_without_user_or_pseudonym (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC37 | limits | the case named in the test | delete older than removes only older rows | n/a: integration test test_reqlog_ac37_delete_older_than_removes_only_older_rows (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC37 | limits | the case named in the test | retention deletes only rows older than 30 days | n/a: integration test test_reqlog_ac37_retention_deletes_only_rows_older_than_30_days (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC37 | limits | the case named in the test | retention is thirty days | test_reqlog_ac37_retention_is_thirty_days | |
| REQLOG-AC38 | happy path | the case named in the test | header lines use german dates and a thirty day period | test_reqlog_ac38_header_lines_use_german_dates_and_a_thirty_day_period | |
| REQLOG-AC38 | happy path | the case named in the test | report holds the local mode sentence | test_reqlog_ac38_report_holds_the_local_mode_sentence | |
| REQLOG-AC38 | happy path | the case named in the test | table has the twelve columns in the spec order | test_reqlog_ac38_table_has_the_twelve_columns_in_the_spec_order | |
| REQLOG-AC39 | error | the case named in the test | counts requests and failed requests per task mode and model | test_reqlog_ac39_counts_requests_and_failed_requests_per_task_mode_and_model | |
| REQLOG-AC39 | error | the case named in the test | every failed status counts as failed | test_reqlog_ac39_every_failed_status_counts_as_failed | |
| REQLOG-AC39 | error | the case named in the test | other statuses do not count as failed | test_reqlog_ac39_other_statuses_do_not_count_as_failed | |
| REQLOG-AC39 | happy path | the case named in the test | rows are sorted by task mode and model | test_reqlog_ac39_rows_are_sorted_by_task_mode_and_model | |
| REQLOG-AC40 | error | the case named in the test | failed requests count in the percentiles | test_reqlog_ac40_failed_requests_count_in_the_percentiles | |
| REQLOG-AC40 | happy path | the case named in the test | median and 95th percentile interpolate between ranks | test_reqlog_ac40_median_and_95th_percentile_interpolate_between_ranks | |
| REQLOG-AC40 | empty data | the case named in the test | percentile of a single request is its latency | test_reqlog_ac40_percentile_of_a_single_request_is_its_latency | |
| REQLOG-AC40 | happy path | the case named in the test | percentile rounds half up to whole milliseconds | test_reqlog_ac40_percentile_rounds_half_up_to_whole_milliseconds | |
| REQLOG-AC41 | empty data | the case named in the test | cost is an empty cell when no row has a cost | test_reqlog_ac41_cost_is_an_empty_cell_when_no_row_has_a_cost | |
| REQLOG-AC41 | empty data | the case named in the test | cost sum cost per thousand and requests without token count | test_reqlog_ac41_cost_sum_cost_per_thousand_and_requests_without_token_count | |
| REQLOG-AC41 | empty data | the case named in the test | costs have up to six decimals without trailing zeros | test_reqlog_ac41_costs_have_up_to_six_decimals_without_trailing_zeros | |
| REQLOG-AC41 | empty data | the case named in the test | token sums leave out empty counts | test_reqlog_ac41_token_sums_leave_out_empty_counts | |
| REQLOG-AC41 | empty data | the case named in the test | zero cost is written as zero | test_reqlog_ac41_zero_cost_is_written_as_zero | |
| REQLOG-AC42 | limits | the case named in the test | main writes the report and leaves out rows older than thirty days | n/a: integration test test_reqlog_ac42_main_writes_the_report_and_leaves_out_rows_older_than_thirty_days (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC42 | empty data | the case named in the test | no rows gives the empty line and no table | test_reqlog_ac42_no_rows_gives_the_empty_line_and_no_table | |
| REQLOG-AC43 | happy path | the case named in the test | report holds no pseudonym and no workspace id | test_reqlog_ac43_report_holds_no_pseudonym_and_no_workspace_id | |
| REQLOG-AC44 | happy path | the case named in the test | close writes the queued rows and stops the writer | test_reqlog_ac44_close_writes_the_queued_rows_and_stops_the_writer | |
| REQLOG-AC44 | duplicates / concurrency | the case named in the test | two requests ending at the same moment write two rows | n/a: integration test test_reqlog_ac44_two_requests_ending_at_the_same_moment_write_two_rows (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC45 | error | the case named in the test | a failing agent run retention still deletes request log rows | test_reqlog_ac45_a_failing_agent_run_retention_still_deletes_request_log_rows | |
| REQLOG-AC45 | error | the case named in the test | a failing request log retention is logged once and the rest goes on | test_reqlog_ac45_a_failing_request_log_retention_is_logged_once_and_the_rest_goes_on | |
| REQLOG-AC46 | empty data | the case named in the test | a missing attachment keeps its answer and writes an error record | test_reqlog_ac46_a_missing_attachment_keeps_its_answer_and_writes_an_error_record | |
| REQLOG-AC46 | error | the case named in the test | an escaping error is logged as error and reraised | test_reqlog_ac46_an_escaping_error_is_logged_as_error_and_reraised | |
| REQLOG-AC46 | error | the case named in the test | an unexpected error is logged as error and reraised | test_reqlog_ac46_an_unexpected_error_is_logged_as_error_and_reraised | |
| REQLOG-AC47 | happy path | the case named in the test | complete json returns prompt and completion tokens | test_reqlog_ac47_complete_json_returns_prompt_and_completion_tokens | |
| REQLOG-AC47 | happy path | the case named in the test | the record holds the token counts the model reported | test_reqlog_ac47_the_record_holds_the_token_counts_the_model_reported | |
| REQLOG-AC48 | empty data | the case named in the test | a call without completion count leaves completion empty | test_reqlog_ac48_a_call_without_completion_count_leaves_completion_empty | |
| REQLOG-AC48 | empty data | the case named in the test | a negative count in a completion counts as missing | test_reqlog_ac48_a_negative_count_in_a_completion_counts_as_missing | |
| REQLOG-AC48 | empty data | the case named in the test | a negative count in the stream counts as missing | test_reqlog_ac48_a_negative_count_in_the_stream_counts_as_missing | |
| REQLOG-AC48 | empty data | the case named in the test | a zero count is kept | test_reqlog_ac48_a_zero_count_is_kept | |
| REQLOG-AC48 | empty data | the case named in the test | complete json with only a prompt count gives completion none | test_reqlog_ac48_complete_json_with_only_a_prompt_count_gives_completion_none | |
| REQLOG-AC48 | error | the case named in the test | failed call empties both counts | test_reqlog_ac48_failed_call_empties_both_counts | |
| REQLOG-AC48 | empty data | the case named in the test | finish writes empty counts and empty cost | n/a: integration test test_reqlog_ac48_finish_writes_empty_counts_and_empty_cost (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC48 | empty data | the case named in the test | missing completion count empties only that count | test_reqlog_ac48_missing_completion_count_empties_only_that_count | |
| REQLOG-AC48 | empty data | the case named in the test | missing prompt count stays empty after later calls | test_reqlog_ac48_missing_prompt_count_stays_empty_after_later_calls | |
| REQLOG-AC48 | happy path | the case named in the test | tally sums the calls | test_reqlog_ac48_tally_sums_the_calls | |
| REQLOG-AC48 | empty data | the case named in the test | tally without calls counts zero | test_reqlog_ac48_tally_without_calls_counts_zero | |
| REQLOG-AC49 | empty data | the case named in the test | log secret equal to another secret exits naming it without its value | test_reqlog_ac49_log_secret_equal_to_another_secret_exits_naming_it_without_its_value | |
| REQLOG-AC49 | error | the case named in the test | log secret equal to another secret is rejected | test_reqlog_ac49_log_secret_equal_to_another_secret_is_rejected | |
| REQLOG-AC50 | happy path | the case named in the test | distinct log secret of 32 characters is kept | test_reqlog_ac50_distinct_log_secret_of_32_characters_is_kept | |
| REQLOG-AC50 | happy path | the case named in the test | distinct log secret of 32 characters starts the api | test_reqlog_ac50_distinct_log_secret_of_32_characters_starts_the_api | |
| REQLOG-AC51 | empty data | the case named in the test | local mode with empty tokens costs zero | test_reqlog_ac51_local_mode_with_empty_tokens_costs_zero | |
| REQLOG-AC52 | error | the case named in the test | an unreachable log database changes nothing the client receives | test_reqlog_ac52_an_unreachable_log_database_changes_nothing_the_client_receives | |
| REQLOG-AC53 | limits | the case named in the test | a write the database never answers is aborted by the client deadline | n/a: integration test test_reqlog_ac53_a_write_the_database_never_answers_is_aborted_by_the_client_deadline (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC53 | limits | the case named in the test | silent database holds no request and is given up within six seconds | n/a: integration test test_reqlog_ac53_silent_database_holds_no_request_and_is_given_up_within_six_seconds (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC54 | error | the case named in the test | unreachable database exits naming it and keeps the report | n/a: integration test test_reqlog_ac54_unreachable_database_exits_naming_it_and_keeps_the_report (needs Postgres), ran in the local integration run of verify step 3 | |
| REQLOG-AC55 | error | the case named in the test | context too small extraction counts as failed | test_reqlog_ac55_context_too_small_extraction_counts_as_failed | |
