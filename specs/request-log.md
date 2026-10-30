# Request log

ID prefix: REQLOG

## Goal
The person who runs the assistant wants to know, for every AI request, which task it served, which mode and model answered it, how many tokens it used, how long it took, what it cost and how it ended, without the log telling who asked or what was asked. A report sums this up per task, including the statement that local mode costs nothing beyond hardware and energy.

## User flow
There is no UI in this feature. The person who runs the assistant reads the log in the AI service's database and the report.

1. A user asks a question (ASK), starts an extraction (EXTRACT) or runs a task (AGENT). When the AI service has finished handling that request, whatever its outcome, it writes one row to the request log.
2. A request is one question streamed by the ask endpoint, one call of the extraction endpoint, or one agent run, once the AI service has accepted its token and its body; this includes an extraction refused as `too_large`. Nothing else writes a row: confirming a turn, viewing, applying or discarding a proposal, health checks, indexing jobs, and requests the AI service rejects before handling them (an invalid token or body, a second running agent run). A request still running when the AI service stops writes no row.
3. A row holds:
   - Time: when the AI service accepted the request, cut to the full hour (UTC).
   - Task: `ask`, `extraction` or `agent`.
   - Mode and model: the inference mode and the model configured for the request (`local`, `qwen3:8b` in the seed setup).
   - Prompt tokens: the sum of the prompt token counts the model reported over all of the request's model calls; 0 when the request made no model call; empty when at least one of its model calls reported no prompt count, which includes a call that failed, timed out or was aborted, and a stream stopped before the model sent its counts.
   - Completion tokens: the same for completion token counts.
   - Latency: whole milliseconds from accepting the request until the AI service sent the request's last answer, event or line, or until the client went away.
   - Cost in USD (see "Cost").
   - Status: the outcome the AI service decided for the request, as the feature defines it. Ask: `answered`, `no_source`, `stopped`, `model_failed`, `filter_failed`. Extraction: `extracted`, `too_large`, `too_many_pages`, `unreadable`, `no_text_layer`, `too_much_text`, `context_too_small`, `model_failed`. Agent: `finished`, `out_of_scope`, `cancelled`, `step_limit`, `time_limit`, `token_limit`, `context_too_small`, `model_failed`. A request that ends with an error answer instead of one of these (the attachment is not found, the wiki does not answer, an unexpected error) has status `error`. The wiki's final check of an Ask answer does not change the status.
   - User: a pseudonym, the HMAC-SHA256 of the user id keyed with the log secret, as 64 lowercase hex characters. The same user always gets the same pseudonym.
   - Workspace: the workspace id.
4. The row never holds a question, a task text, an answer, page or attachment text, a file name, a page, attachment, conversation, turn, run or proposal id, the user id, a name, an email address or a token.
5. If writing the row fails, or the database does not accept it within 5 s, the user gets the request's result as without the log, and the AI service logs one line `request log write failed` with the task and the error class, and none of the values of step 4 and no pseudonym.
6. The person who runs the assistant runs the report command. It reads the rows whose time is at most 30 × 24 hours before it runs and writes the report (see "Report").
7. The AI service deletes rows whose time is more than 30 × 24 hours old, in the same daily retention step that deletes agent runs (AGENT "Data").

### Cost
- The price table lists per model the USD per 1 million prompt tokens, the USD per 1 million completion tokens, the date from which the prices apply, the URL of the source and the date the source was read. A model can have several entries with different dates. An entry belongs to the model whose configured name equals the entry's model name exactly.
- A row in mode `local` costs 0 USD, with or without an entry for its model and with or without token counts.
- A row in another mode costs prompt tokens × prompt price / 1,000,000 + completion tokens × completion price / 1,000,000, with the prices of the model's entry with the latest date on or before the row's day (UTC), rounded half up to 6 decimal places.
- A row in another mode has an empty cost when its prompt or completion tokens are empty, or when its model has no entry on or before the row's day.
- A row's cost is fixed when the row is written; a later change of the price table does not change it.
- The price table as shipped holds an entry for each API mode model of spec section 6 (`claude-haiku-5-5`, `claude-sonnet-5-5`).

### Secret
- The log secret is a setting of the AI service of at least 32 characters that equals neither the bridge secret nor the service token. Otherwise the AI service does not start and its error names the setting, without its value.

### Report
The report command writes the Markdown file `reports/request-log.md`, replacing an earlier one:
- The header lines "# Request log", "- Date: <DD.MM.YYYY>" (the day it ran), "- Period: <DD.MM.YYYY> to <DD.MM.YYYY>" (the 30 days it covers, ending on the day it ran) and the line "Local mode costs 0 USD: hardware and energy are not counted."
- Then one table row per task, mode and model, sorted by task, mode and model, with the columns: task, mode, model, requests, failed requests, requests without token count, median latency in ms, 95th percentile latency in ms, prompt tokens, completion tokens, cost in USD and cost per 1,000 requests in USD.
- A request is failed when its status is `model_failed`, `filter_failed`, `context_too_small` or `error`. A request is without token count when its prompt or completion tokens are empty.
- The p-th percentile of a table row's latencies, sorted ascending, is at rank 1 + p × (n − 1), interpolated linearly between the two neighbouring ranks and rounded half up to whole milliseconds; all of the table row's requests count.
- Token sums leave out empty counts. The cost is the sum of the non-empty costs, and is empty when no row has a cost. Cost per 1,000 requests is that sum divided by the number of rows with a cost, times 1,000. Costs are written with up to 6 decimal places, without trailing zeros.
- Without rows in the period it holds the header lines and "No requests in the last 30 days." instead of the table.
- It holds no pseudonym and no workspace id.
- If the database cannot be read, the command exits with an error naming the database and leaves an existing report unchanged.

## Acceptance criteria

### Rows per request
- **REQLOG-AC1**: Given a user with a readable space, when the user asks a question that is answered, then the request log holds one new row with task `ask` and status `answered`.
- **REQLOG-AC2**: Given a question for which no section passes the relevance threshold, when the user asks it, then the new row has status `no_source`, prompt tokens 0 and completion tokens 0.
- **REQLOG-AC3**: Given the model fails while a question is answered, when the request ends, then the new row has task `ask` and status `model_failed`.
- **REQLOG-AC4**: Given the client stops reading the answer stream before the model has finished, when the request ends, then the new row has status `stopped`.
- **REQLOG-AC5**: Given an extraction the model answers, when it ends, then the new row has task `extraction` and status `extracted`.
- **REQLOG-AC6**: Given an attachment larger than the extraction's size limit, when the user starts an extraction, then the new row has status `too_large`, prompt tokens 0 and completion tokens 0.
- **REQLOG-AC7**: Given the model is unavailable during an extraction, when it ends, then the new row has task `extraction` and status `model_failed`.
- **REQLOG-AC8**: Given an agent run that ends with a final message, when the run ends, then the request log holds exactly one new row for it, with task `agent` and status `finished`.
- **REQLOG-AC9**: Given a running agent run, when the user cancels it, then the new row has status `cancelled`.
- **REQLOG-AC10**: Given an agent run that reaches the step limit, when it ends, then the new row has status `step_limit`.
- **REQLOG-AC11**: Given a request with an invalid user token, when the AI service rejects it, then the request log holds no new row.
- **REQLOG-AC12**: Given a user with a running agent run, when the user starts a second run and the AI service rejects it, then the request log holds no new row for the second run.
- **REQLOG-AC13**: Given an open proposal, when the user views, applies or discards it, then the request log holds no new row.

### Fields
- **REQLOG-AC14**: Given the AI service runs with mode `local` and model `qwen3:8b`, when a request writes its row, then the row has mode `local` and model `qwen3:8b`.
- **REQLOG-AC15**: Given the model reports 1,200 prompt tokens and 300 completion tokens for an answered question, when the row is written, then it has prompt tokens 1200 and completion tokens 300.
- **REQLOG-AC16**: Given an agent run with three model calls that report 1,000 and 100, 2,000 and 200, and 3,000 and 300 prompt and completion tokens, when the run ends, then its row has prompt tokens 6000 and completion tokens 600.
- **REQLOG-AC17**: Given an agent run with two model calls that report 1,000 and 100 tokens and a third call that fails, when the run ends, then its row has empty prompt tokens and empty completion tokens.
- **REQLOG-AC18**: Given a question whose stream the client stops before the model reports its counts, when the row is written, then its prompt tokens and completion tokens are empty.
- **REQLOG-AC19**: Given a request accepted at time t whose last event is sent at t + 2,500 ms, when its row is written, then the latency is 2500.
- **REQLOG-AC20**: Given a request accepted at 30.10.2026 10:42:17 UTC, when its row is written, then its time is 30.10.2026 10:00:00 UTC.
- **REQLOG-AC21**: Given a request of a user in workspace w, when its row is written, then its workspace is w.
- **REQLOG-AC47**: Given an extraction whose model reports 4,814 prompt tokens and 250 completion tokens, when it ends, then its row has prompt tokens 4814 and completion tokens 250.
- **REQLOG-AC48**: Given a model call that reports 1,200 prompt tokens and no completion count, when the request's row is written, then it has prompt tokens 1200 and empty completion tokens.

### Pseudonym and secret
- **REQLOG-AC22**: Given the log secret s and a user with id u, when a request of that user writes a row, then the row's user is the HMAC-SHA256 of u keyed with s as 64 lowercase hex characters.
- **REQLOG-AC23**: Given two requests of the same user, when both rows are written, then both have the same user value.
- **REQLOG-AC24**: Given requests of two different users, when their rows are written, then their user values differ.
- **REQLOG-AC25**: Given a question, a task or an extraction by a user, when its row is written, then no column of the row holds the user id, the question, the task text, the answer, a page, attachment, conversation, turn, run or proposal id, a file name or the user token.
- **REQLOG-AC26**: Given the log secret is not set, when the AI service starts, then it exits and its error names the log secret's setting.
- **REQLOG-AC27**: Given a log secret of 31 characters, when the AI service starts, then it exits and its error names the log secret's setting without its value.
- **REQLOG-AC49**: Given a log secret equal to the bridge secret, when the AI service starts, then it exits and its error names the log secret's setting.
- **REQLOG-AC50**: Given a log secret of 32 characters that differs from the bridge secret and the service token, when the AI service starts, then it accepts requests.

### Cost
- **REQLOG-AC28**: Given mode `local` and a model without a price entry, when a request with 1,200 prompt and 300 completion tokens writes its row, then its cost is 0.
- **REQLOG-AC51**: Given mode `local` and a request with empty tokens, when its row is written, then its cost is 0.
- **REQLOG-AC29**: Given mode `api` and a price entry for the model of 3 USD per 1 million prompt tokens and 15 USD per 1 million completion tokens from 01.10.2026, when a request on 30.10.2026 with 1,200 prompt and 300 completion tokens writes its row, then its cost is 0.0081.
- **REQLOG-AC30**: Given mode `api` and two entries for the model, 3 and 15 USD from 01.10.2026 and 1 and 5 USD from 20.10.2026, when a request on 30.10.2026 with 1,000,000 prompt tokens and 0 completion tokens writes its row, then its cost is 1.
- **REQLOG-AC31**: Given mode `api` and an entry for the model from 01.11.2026 only, when a request on 30.10.2026 writes its row, then its cost is empty.
- **REQLOG-AC32**: Given mode `api` and a model without a price entry, when a request writes its row, then its cost is empty.
- **REQLOG-AC33**: Given mode `api` and a request whose prompt tokens are empty, when its row is written, then its cost is empty.
- **REQLOG-AC34**: Given the price table as shipped, when it is read, then it has an entry for `claude-haiku-5-5` and for `claude-sonnet-5-5`, every entry has a model, a prompt and a completion price of at least 0, a date from which it applies, a source URL and the date the source was read, and no two entries share model and date.

### Failure and retention
- **REQLOG-AC35**: Given the request log cannot be written, when a user asks a question that is answered, then the user receives the same events as with a working log.
- **REQLOG-AC36**: Given the request log cannot be written, when a request ends, then the AI service logs one line holding `request log write failed`, the task and the error class, and no user id, pseudonym, question or task text.
- **REQLOG-AC52**: Given the request log cannot be written, when an agent run ends with a final message, then the user receives the run's events up to its end as with a working log.
- **REQLOG-AC53**: Given the request log's database accepts the connection but never answers, when an extraction ends, then the extraction's result is returned at most 6 s after the extraction finished and the failure line of REQLOG-AC36 is logged.
- **REQLOG-AC37**: Given rows whose time is 30 days and 1 minute old and 29 days and 23 hours old, when the worker's retention step runs, then only the row 29 days and 23 hours old remains.

### Report
- **REQLOG-AC38**: Given rows in the period, when the report command runs, then the report holds the line "Local mode costs 0 USD: hardware and energy are not counted."
- **REQLOG-AC39**: Given 3 `ask` rows in mode `local` with model `qwen3:8b` of which 1 has status `model_failed`, when the report command runs, then the report's row for `ask`, `local`, `qwen3:8b` shows 3 requests and 1 failed request.
- **REQLOG-AC40**: Given 20 rows of one task, mode and model with latencies 100, 200, …, 2,000 ms, when the report command runs, then that table row shows a median of 1050 ms and a 95th percentile of 1905 ms.
- **REQLOG-AC41**: Given 3 `agent` rows in mode `api` with costs 0.01, 0.02 and 0.03 and a fourth with empty tokens and empty cost, when the report command runs, then that table row shows a cost of 0.06 USD, a cost per 1,000 requests of 20 USD and 1 request without token count.
- **REQLOG-AC42**: Given a row 30 days and 1 minute old and none newer, when the report command runs, then the report holds "No requests in the last 30 days." and no table row.
- **REQLOG-AC43**: Given rows in the period, when the report command runs, then the report holds no pseudonym and no workspace id.

## Edge cases
- **REQLOG-AC44**: Given two requests that end at the same moment, when both write their rows, then the request log holds two rows.
- **REQLOG-AC45**: Given deleting old rows fails with an error other than a lost database connection, when the worker's retention step runs, then the worker logs one line naming the request log retention and the error class, and still deletes old agent runs and processes the next job.
- **REQLOG-AC46**: Given an extraction whose attachment the wiki reports as not found, when the AI service answers with the error, then the new row has task `extraction` and status `error`.
- **REQLOG-AC54**: Given the database cannot be read, when the report command runs, then it exits with a non-zero code naming the database and an existing report is unchanged.
- **REQLOG-AC55**: Given an extraction row with status `context_too_small`, when the report command runs, then the report counts it as a failed request.

## Out of scope
- A UI for the log: the admin page "AI usage" is a Should (spec section 8).
- Budgets and refusals by cost (Should).
- Hardware and energy cost of local mode.
- Logging indexing jobs, embeddings and the reconcile job.
- Rows per model call: an agent run is one row.
- Time to the first answer text; ASK logs it per question.
- Linking a pseudonym back to a user, and rotating the log secret.
- Prices by prompt length (Haiku 5.5 charges more for prompts over 100,000 tokens), cache prices and batch discounts.
- Committing a generated report to the repository; the eval and mode-comparison work decides which reports are published.

## Open questions

## Decisions
- 30.10.2026: one row per user request (question, extraction, agent run), not per model call, because spec section 8 asks for one row per request and an agent run is one request for the user; its calls are summed.
- 30.10.2026: the pseudonym is an HMAC-SHA256 with a secret of its own (REQLOG-AC22), as spec section 9 M9 asks. Deriving it from the bridge secret was rejected, because the wiki holds that secret too, and rotating it would change every pseudonym. The pseudonym protects against readers of the request log who do not hold the AI service's settings; whoever holds the settings can recompute it from known user ids.
- 30.10.2026: a row's time is cut to the full hour (REQLOG-AC20), because a time to the second next to a pseudonym could be joined with the agent runs' start times, which hold the user id, and with timestamped log lines. Latency is a column of its own, and cost needs only the day. A user with few requests in an hour can still be singled out by someone who holds the agent runs; this is accepted for v1, because both tables live in the same database role and are deleted after 30 days.
- 30.10.2026: token counts are empty, not partial, when any model call of the request reported no count (REQLOG-AC17), because a partial sum would look complete and under-report cost in API mode, where an aborted call is still billed. The report shows how many requests had no count.
- 30.10.2026: Ask reads token counts from the streamed answer; the local runtime's OpenAI-compatible API supports the streaming usage option (Ollama documentation, `docs/api/openai-compatibility.mdx`, read 30.10.2026). The verify run checks it against the local model.
- 30.10.2026: the shipped price table holds `claude-sonnet-5-5` (2 USD prompt, 10 USD completion per 1 million tokens) and `claude-haiku-5-5` (0.10 and 0.50 USD, the price for prompts up to 100,000 tokens), from https://platform.claude.com/docs/en/about-claude/pricing, read 30.10.2026, valid from 30.10.2026. API mode is a Should; the entries are there so the price rule is exercised with real values.
- 30.10.2026: old rows are deleted in the worker's existing daily retention step, the one that deletes agent runs, because the AI service then has one retention mechanism; between two steps a row can be up to one day older than 30 days.
- 30.10.2026: the report's latency percentiles cover all of a table row's requests, including failed ones, because the person who runs the assistant waits for those too. The percentile rule is fixed (rank 1 + p × (n − 1)), because common methods give different numbers.
- 30.10.2026: `context_too_small` counts as failed in the report for both extraction and agent, because in both the model could not take the input.
- 30.10.2026: a write that the database does not finish within 5 s is given up (REQLOG-AC53), so a slow log never holds a user's result for long.
