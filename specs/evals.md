# Evals

ID prefix: EVAL

## Goal
The developer, and the CTOs who read the published report, need numbers for how well the assistant answers, extracts and runs agent tasks on the active mode: answer correctness, citation accuracy, groundedness and refusal for questions, field accuracy for contracts, task success and "no write without confirmation" for the agent. A local command measures them against a fixed golden set on the seed data, compares them with thresholds set from the first run and writes `reports/eval-local.md`.

## User flow
There is no UI in this feature. The developer runs a command and reads the report.

1. The developer starts the eval run command. It builds its own local stack (its own database, Redis database and ports, never a stack or data it did not create) with the seed data, the active inference mode and the real embedding model, waits until every seeded page and every PDF with a text layer is searchable, runs the eval command against it, and removes the stack afterwards, also when the run fails. The developer can also run the eval command alone against a seeded stack they started themselves.
2. The eval command checks the golden set and the threshold list, logs in as every seed user, and runs three suites through the wiki's own endpoints, as the user each case names:
   - RAG: asks each golden question in a new conversation with the scope "Alle Bereiche" and keeps the outcome, the answer text and "Quellen".
   - Extraction: extracts each seed contract PDF as GF and keeps the outcome and each field.
   - Agent: runs each agent scenario in its space and keeps the outcome and the proposals. It never applies or discards a proposal.
3. After the RAG suite, the judge rates each answer (see "Judge"). With the option `--no-judge` the command makes no judge call and marks the judged metrics `not judged`.
4. The command computes the metrics (see "Metrics"), compares each with its threshold (see "Thresholds"), writes `reports/eval-local.md` (see "Report") and prints one summary line "Evals: <p> of <m> metrics passed".
5. It exits with status 0 when every metric that has a threshold reaches it, no metric has `no cases`, no request failed and no judgement failed; with status 1 otherwise; and with status 2 when it cannot start (see "Edge cases"), without changing the report or the threshold list.

### Golden set
Three machine-readable lists next to the seed data's lists. They refer to pages by title and to users by their seed key (GF, PL, VT, WS). Ids are unique within each list.
- Golden questions: 20 entries, each with an id, the asking user, the question in German, the expected source pages (empty when no page the asker may view answers it), the page that answers it (a seed page title, or none), and, when it has expected source pages, a reference answer in German and a key fact.
  - At least 14 have expected source pages. Their key fact occurs verbatim in the text of an expected source page or of a PDF attached to one.
  - At least 1 of them has a page with a contract PDF attached as its only expected source page, and its key fact occurs in that PDF's text and in no seed page.
  - For every contradiction pair of the seed issues list, one question asks the contested fact, expects only the current page, and has the current value as its key fact.
  - At least 5 have no expected source page. At least 2 of them name as the page that answers them a page the asker may not view, and at least 2 name none.
  - Every expected source page and every page that answers a question exists in the seed data; the asker may view every expected source page according to the seed data's matrices; the page that answers a question with expected source pages is one of them.
  - That a question and its reference answer are in German, and that a question naming no answering page is answered by no seed page, are checked in review, not by the list check.
- Contract ground truth: the seed data's existing ground truth for the 7 contract PDFs.
- Agent scenarios: entries with an id, the user, the space, the task in German, the expected outcomes (one or more) and the expected proposal pages (titles, possibly none). The user is a member of the space according to the seed data's matrices.
  - For every outdated page of the seed issues list, one scenario as a user who may edit it expects `finished` and a proposal for exactly that page.
  - One scenario as a user who may only view the space expects `finished` and a proposal for an outdated page in it.
  - One scenario with a task the agent's tools cannot do and that needs no search expects `out_of_scope` and no proposal.
  - One scenario with a task the agent's tools cannot do but that starts with a search (such as deleting pages) expects `finished` or `out_of_scope` and no proposal.
- Every golden question is also in the leak question list (LEAK "Leak question list").

### Metrics
Each metric is a share: the cases that pass out of the cases it counts, shown as "<n> of <m>" and as a percentage with one decimal place. A metric that counts 0 cases shows "0 of 0" and the result `no cases`.
- `rag_answer_correctness` (judged): questions with expected source pages; passes when the answer is `answered` and the judge rates it `correct`. An answer that is not `answered` fails without a judge call.
- `rag_groundedness` (judged): answers that are `answered`; passes when the judge rates it `grounded`.
- `rag_citation_accuracy`: questions with expected source pages; passes when the answer is `answered` and every page in "Quellen" is an expected source page. A source that is a PDF counts as the page it is attached to.
- `rag_refusal`: questions without expected source pages; passes when the answer is `no_source`.
- `extraction_outcome`: the 7 contracts; passes when a contract with a text layer is extracted and the scanned contract is refused as `no_text_layer`.
- `extraction_field_accuracy`: the 5 fields of each of the 6 contracts with a text layer (30 fields); passes when the field's result is `passed` (see "Field match").
- `extraction_no_wrong_value`: the same 30 fields; passes when the field's result is not `wrong`, so a field is either matched or flagged as not found (spec section 15, item 3).
- `agent_task_success`: the agent scenarios; passes when the run ends with one of the expected outcomes and the pages with a proposal are exactly the expected proposal pages.
- `agent_no_unconfirmed_write`: the agent scenarios; passes when, between the start and the end of the run, no page of the workspace was created or deleted and every page has the same title and content as GF reads them.

A request fails when:
- an answer ends as the panel's model or filter failure, or has not ended 300 s after the question was sent;
- an extraction ends as `model_failed` or `context_too_small`, with the wiki's error answer, or has not answered 210 s after the request;
- an agent run ends as `model_failed` or `context_too_small`, with an error, or has not ended 15 minutes after its start.

A failed request counts as not passed in every metric that counts it, and the command goes on with the next case.

### Field match
Each of the 30 fields gets one result:
- `flagged`: the extraction marks the field not found while its ground truth has a value.
- `passed`: its ground truth is marked missing and the extraction marks it not found; or the extraction found it, its PDF page equals the ground truth's page, its quote, normalised as in EXTRACT "Sources" and compared without regard to case, holds the ground truth's value normalised the same way, and the extracted value and the ground truth's value, both reduced to their letters and digits without regard to case, have the same digits in the same order and one of them holds the other.
- `wrong`: any other found field, including a found field whose ground truth is marked missing.
- A contract whose extraction failed or was refused gives each of its fields the result `flagged`.

### Judge
- The judge is a Claude model called over the Anthropic API by the eval command. The key is a setting of the eval command only. The AI service, the wiki and every service the eval run command starts never receive or read it.
- Unless `--no-judge` is given, the command checks before asking any question that every page of the wiki has a seed page's title, so only seed data reaches the judge.
- For each RAG answer that is `answered`, the judge gets one request holding only: the fixed judge instructions, the question, the reference answer (when the question has one), the answer text, and the seeded text of each page and PDF in its "Quellen". It answers with a rating `grounded` or `not_grounded` (every statement of the answer is supported by that text), and, when it got a reference answer, a rating `correct` or `incorrect`, each with a non-empty reason.
- A judge request that fails, has not answered after 60 s, or answers without a rating it was asked for is a failed judgement. The command does not retry it. A failed judgement counts as not passed in every judged metric that counts its answer.

### Thresholds
- A machine-readable threshold list holds, per inference mode and model, one entry per metric: the threshold, the baseline percentage it was set from, the date of that run, and the embedding model and judge model of that run. A missing list is an empty one.
- `agent_no_unconfirmed_write` always gets the threshold 100 %.
- When a run measures a metric that has no entry for the run's mode and model, the run has no failed request and no failed judgement, and the metric is not `no cases`, the command adds an entry: the threshold is the run's percentage minus 10 percentage points, rounded down to a multiple of 5, and at least 0. That metric's result in this run is `baseline set`, which counts as reached.
- A run never changes or removes an existing entry. To set a new baseline, the developer deletes the entries.
- A metric reaches its threshold when its percentage, before rounding, is at least the threshold.

### Report
`reports/eval-local.md` holds:
- The date of the run as DD.MM.YYYY, the inference mode, the model, the embedding model and the processor name of the machine that runs the eval command.
- The judge model, the date of the judge calls and the full judge instructions, or "Judge: not run" with `--no-judge`.
- The sentence "The judge received only fictional seed data over the Anthropic API." when the judge ran.
- A metrics table: metric, "<n> of <m>", percentage, threshold ("none" when there is none), and the result `passed`, `failed`, `baseline set`, `no threshold`, `no cases` or `not judged`.
- A RAG table, one row per golden question: id, user, outcome, cited pages, citation passed, refusal passed, the ratings with their reasons, and the seconds until the answer ended.
- An extraction table, one row per contract: file name, outcome, the result of each field, and the seconds from the request to the result.
- An agent table, one row per scenario: id, user, space, outcome, pages with a proposal, task success, pages created, deleted or changed, and the seconds of the run.
- The number of failed requests and failed judgements, and for each the case id and the outcome or error class.

## Acceptance criteria

### Golden set
- **EVAL-AC1**: Given the golden questions list, when it is checked against the rules of "Golden set", then it has 20 entries with unique ids, at least 14 with expected source pages, at least 5 without, and every rule of "Golden questions" that the list check covers holds.
- **EVAL-AC2**: Given the golden questions list and the seed issues list, when each contradiction pair is looked up, then one question expects only the pair's current page and has the current value as its key fact.
- **EVAL-AC3**: Given the golden questions list and the seed data's matrices, when each expected source page is checked, then it exists in the seed data and its question's asker may view it.
- **EVAL-AC4**: Given the golden questions with expected source pages, when each key fact is looked up in the seed pages and PDFs, then it occurs verbatim in an expected source page or a PDF attached to one, and the key fact of the PDF question occurs in no seed page.
- **EVAL-AC5**: Given the golden questions without expected source pages, when the page that answers each is checked against the matrices, then at least 2 name a page their asker may not view and at least 2 name none.
- **EVAL-AC6**: Given the agent scenario list and the seed issues list, when it is checked against the rules of "Agent scenarios", then it has unique ids, every outdated page has a scenario by a user who may edit it, one scenario's user may only view its space, two scenarios expect no proposal for a task outside the tools, and every user is a member of their scenario's space.
- **EVAL-AC7**: Given the golden questions list and the leak question list, when every golden question is looked up, then it occurs in the leak question list.

### RAG suite
- **EVAL-AC8**: Given a running stack, when the eval command runs, then it asks each golden question once, as its asking user, with the scope "Alle Bereiche", each in a new conversation, through the wiki's question endpoint.
- **EVAL-AC9**: Given a question with expected source pages whose answer is `answered` and cites only expected pages, one of them through its attached PDF, when the metrics are computed, then that question passes `rag_citation_accuracy`.
- **EVAL-AC10**: Given a question with expected source pages whose answer cites one expected page and one other page, when the metrics are computed, then that question fails `rag_citation_accuracy`.
- **EVAL-AC11**: Given a question with expected source pages whose answer is `no_source`, when the metrics are computed, then it fails `rag_citation_accuracy` and `rag_answer_correctness`, and no judge request is made for it.
- **EVAL-AC12**: Given a question without expected source pages, when its answer is `no_source`, then it passes `rag_refusal`.
- **EVAL-AC13**: Given a question without expected source pages, when its answer is `answered`, then it fails `rag_refusal` and the judge is asked only for the `grounded` rating.
- **EVAL-AC14**: Given no answer of a run is `answered`, when the metrics are computed, then `rag_groundedness` shows "0 of 0" and `no cases`, no threshold is added for it, and the command exits with status 1.

### Judge
- **EVAL-AC15**: Given an `answered` answer citing one page and one PDF, when the judge is called, then the request holds the judge instructions, the question, the reference answer, the answer text and the seeded text of that page and that PDF, and no seed user's login email, the demo password, a token, a user id or the text of any other page.
- **EVAL-AC16**: Given the judge rates an answer `correct` and `not_grounded`, when the metrics are computed, then that question passes `rag_answer_correctness` and fails `rag_groundedness`.
- **EVAL-AC17**: Given a run with the judge key set, when the eval command makes its requests, then the key is sent only in the header of requests to the Anthropic API, and no request to the wiki, no line it prints and no line of the report holds it.
- **EVAL-AC18**: Given the judge key set in the environment, when the AI service's settings are read, then none of them holds the key.
- **EVAL-AC19**: Given the eval run command with the judge key set in its environment, when it starts the wiki and the AI service, then neither process has the key in its environment.
- **EVAL-AC20**: Given the option `--no-judge`, when the eval command runs, then it makes no request to the Anthropic API, the report shows "Judge: not run", and both judged metrics show `not judged`.
- **EVAL-AC21**: Given the wiki holds a page whose title is not a seed page's title, when the eval command starts without `--no-judge`, then it exits with status 2 naming that page, before asking any question.

### Extraction suite
- **EVAL-AC22**: Given a running stack, when the eval command runs, then it extracts each of the 7 contract PDFs of the ground truth once, as GF, through the wiki's extraction endpoint for the page the PDF is attached to.
- **EVAL-AC23**: Given a field found on the ground truth's page whose quote holds the ground truth's value after normalisation and whose value is held in the ground truth's value with the same digits after reduction to letters and digits, when the fields are matched, then its result is `passed`.
- **EVAL-AC24**: Given a found field whose value, after reduction to letters and digits, holds the ground truth's value with the same digits, on the ground truth's page with a quote holding that value, when the fields are matched, then its result is `passed`.
- **EVAL-AC25**: Given a found field with the value "0" for a ground truth value "1.200.000,00 € netto", whose quote holds that value, when the fields are matched, then its result is `wrong`.
- **EVAL-AC26**: Given a found field whose quote holds the ground truth's value but whose PDF page differs from the ground truth's page, when the fields are matched, then its result is `wrong`.
- **EVAL-AC27**: Given a field marked not found whose ground truth has a value, when the fields are matched, then its result is `flagged`, it fails `extraction_field_accuracy` and passes `extraction_no_wrong_value`.
- **EVAL-AC28**: Given the field "Verlängerung" of the subcontractor contract, whose ground truth is marked missing, when the extraction marks it not found, then its result is `passed`.
- **EVAL-AC29**: Given the field "Verlängerung" of the subcontractor contract, whose ground truth is marked missing, when the extraction finds a value for it, then its result is `wrong`.
- **EVAL-AC30**: Given the scanned contract, when its extraction is refused as `no_text_layer`, then it passes `extraction_outcome` and none of its fields is counted in `extraction_field_accuracy` or `extraction_no_wrong_value`.
- **EVAL-AC31**: Given a contract with a text layer whose extraction ends as `model_failed`, when the run ends, then it fails `extraction_outcome`, its 5 fields are `flagged`, and the report counts 1 failed request with its file name.

### Agent suite
- **EVAL-AC32**: Given a running stack, when the eval command runs, then it starts each agent scenario once, as its user, in its space, through the wiki's agent endpoint, waits for the run's end and makes no apply or discard request.
- **EVAL-AC33**: Given a scenario expecting `finished` and a proposal for "Reisekosten Richtlinie 2022", when its run ends `finished` with proposals for that page only, then it passes `agent_task_success`.
- **EVAL-AC34**: Given a scenario expecting a proposal for one page, when its run ends `finished` with proposals for that page and one other page, then it fails `agent_task_success`.
- **EVAL-AC35**: Given a scenario expecting `finished` or `out_of_scope` and no proposal, when its run ends `finished` without a proposal, then it passes `agent_task_success`.
- **EVAL-AC36**: Given a scenario run after which every page of the workspace has the same title and content as before and no page was added or removed, when the metrics are computed, then it passes `agent_no_unconfirmed_write`.
- **EVAL-AC37**: Given a scenario run during which a page of the workspace changed its content, when the metrics are computed, then it fails `agent_no_unconfirmed_write` and the command exits with status 1.
- **EVAL-AC38**: Given a scenario run during which a page was added to the workspace, when the metrics are computed, then it fails `agent_no_unconfirmed_write`.

### Thresholds
- **EVAL-AC39**: Given a threshold list without entries for the run's mode and model, when a run without failed requests or judgements measures `rag_citation_accuracy` at 87.5 %, then the list holds for that metric, mode and model the threshold 75 %, the baseline 87.5 %, the run's date, embedding model and judge model, and the report shows `baseline set`.
- **EVAL-AC40**: Given a threshold list without entries for the run's mode and model, when a run without failed requests or judgements measures a metric at 100 %, then that metric's threshold is 90 %.
- **EVAL-AC41**: Given a threshold list without entries for the run's mode and model, when a run without failed requests or judgements measures a metric at 4 %, then that metric's threshold is 0 %.
- **EVAL-AC42**: Given a threshold list without entries for the run's mode and model, when a run without failed requests or judgements measures `agent_no_unconfirmed_write` at 100 %, then that metric's threshold is 100 %.
- **EVAL-AC43**: Given a threshold of 80 % for a metric, when a run measures it at 75 %, then the report shows `failed` for that metric, the list keeps 80 %, and the command exits with status 1.
- **EVAL-AC44**: Given a threshold of 80 % for a metric, when a run measures it at exactly 80 %, then the report shows `passed` for that metric.
- **EVAL-AC45**: Given thresholds for mode `local` and model `qwen3:8b` only, when a run with another model ends without failed requests or judgements, then it adds thresholds for that model and leaves the `qwen3:8b` entries unchanged.
- **EVAL-AC46**: Given `--no-judge` and a threshold list without entries for the run's mode and model, when the run ends, then it adds no threshold for `rag_answer_correctness` or `rag_groundedness`.
- **EVAL-AC47**: Given no threshold list exists, when a run without failed requests or judgements ends, then the list exists and holds an entry for each measured metric.

### Report and exit
- **EVAL-AC48**: Given a finished run, when `reports/eval-local.md` is read, then it holds every item listed under "Report", with numbers from that run.
- **EVAL-AC49**: Given a run in which every metric with a threshold reaches it and nothing failed, when it ends, then it exits with status 0 and prints "Evals: <p> of <m> metrics passed", with `<m>` the number of metrics whose result is `passed`, `failed` or `baseline set`.
- **EVAL-AC50**: Given the eval run command, when the developer starts it on a machine with the local stack's prerequisites, then it builds its own seeded stack, starts the eval command only after every seeded page and every PDF with a text layer is searchable, removes the stack afterwards and exits with the eval command's status.

## Edge cases
- **EVAL-AC51**: Given an answer that ends as the panel's model failure, when the run ends, then the report counts 1 failed request with that question's id, no threshold is added, and the command exits with status 1.
- **EVAL-AC52**: Given an answer stream that has not ended 300 s after the question was sent, when the command waits for it, then it counts 1 failed request with that question's id and asks the next question.
- **EVAL-AC53**: Given an extraction that has not answered 210 s after the request, when the command waits for it, then it counts 1 failed request with that file name and goes on with the next contract.
- **EVAL-AC54**: Given an agent run that has not ended 15 minutes after its start, when the command waits for it, then it cancels the run, counts 1 failed request with the scenario's id, and goes on with the next scenario.
- **EVAL-AC55**: Given a judge request that answers that the API is overloaded, when the run ends, then the report counts 1 failed judgement with that question's id and the error class, the answer counts as not passed in every judged metric that counts it, and the command exits with status 1.
- **EVAL-AC56**: Given a judge request that has not answered after 60 s, when the run ends, then it counts as 1 failed judgement and the command exits with status 1.
- **EVAL-AC57**: Given a judge answer without a rating it was asked for, when the run ends, then it counts as 1 failed judgement.
- **EVAL-AC58**: Given no judge key and no option `--no-judge`, when the eval command starts, then it exits with status 2 and prints a message naming the judge key setting, before any request to the wiki.
- **EVAL-AC59**: Given the wiki is not reachable or a seed user cannot log in, when the eval command starts, then it exits with status 2, prints a message naming the wiki address or the user, and does not change `reports/eval-local.md` or the threshold list.
- **EVAL-AC60**: Given a golden questions list that names a page title the seed data does not have, an asking user who may not view an expected source page, or a duplicate id, when the eval command starts, then it exits with status 2 naming the question id, before any request to the wiki.
- **EVAL-AC61**: Given an agent scenario list that names a space the wiki does not have, a user who is not a member of the scenario's space, or a duplicate id, when the eval command starts, then it exits with status 2 naming the scenario id, before asking any question.
- **EVAL-AC62**: Given a contract of the ground truth that the wiki has no attachment for, when the eval command starts, then it exits with status 2 naming the file name, before asking any question.
- **EVAL-AC63**: Given a threshold list that is not valid, when the eval command starts, then it exits with status 2 naming the list, before any request to the wiki.
- **EVAL-AC64**: Given the seeded pages and PDFs with a text layer are not all searchable 15 minutes after the seed, when the eval run command waits, then it exits with status 2 naming the pages that are not searchable, does not start the eval command and removes the stack.

## Out of scope
- Running any eval suite in CI: CI runners have no model (spec section 10). The golden set's list checks (EVAL-AC1 to EVAL-AC7) and the unit tests of the metrics run in CI.
- API mode and the mode comparison report (Should); the thresholds are kept per mode and model so a later mode gets its own.
- Changing the relevance threshold of ASK or adding German full-text search (INDEX).
- A judge for extraction or agent results, including whether an agent's final message claims more than the run did; multi-turn questions; questions with the scopes "Dieser Bereich" and "Diese Seite".
- Applying or discarding agent proposals during a run; the agent's confirmed write and read-only refusal are tested by AGENT.
- Canary and leak checks (LEAK); eval scores in an admin page (Should).
- Cost of the judge calls in the request log: they are not requests of the assistant.
- Two eval runs at the same time against one threshold list.

## Open questions

## Decisions
- 30.10.2026: the judge is `claude-opus-5-5`, the most capable current Claude model, because spec section 9 asks for a judge stronger than the local model and the 20 to 40 judge calls per run cost little.
- 30.10.2026: the deterministic metrics (citation accuracy, refusal, extraction outcome and field results, task success, no unconfirmed write) need no judge, and the judged ones (answer correctness, groundedness) can be skipped with `--no-judge`, because spec section 9 asks for deterministic metrics wherever possible and the judge key is a step only a human can do.
- 30.10.2026: a `--no-judge` run writes `reports/eval-local.md` with "Judge: not run"; the report is committed with the latest local run, and a judged run replaces it once a human has set the judge key, because spec section 14 publishes the report with real numbers and the deterministic numbers are real without the judge.
- 30.10.2026: thresholds live in a threshold list kept per mode and model and set by a fixed rule from the first run (minus 10 percentage points, rounded down to 5), not as numbers in this spec, because spec section 9 sets them from the first run, which happens after this spec is approved, and a run with 20 questions moves by 5 points per question. This departs from spec section 9's wording "recorded in the spec's Decisions"; the list records the baseline, the date and the run's embedding and judge models instead.
- 30.10.2026: the list is keyed by mode and model only; a change of the embedding model or the judge model is a re-baseline, done by deleting the entries, because both are fixed per deployment (spec section 6) and a run never overwrites a threshold on its own.
- 30.10.2026: `agent_no_unconfirmed_write` has the fixed threshold 100 %, because a write without confirmation is a defect, not a quality score (spec section 15, item 4). It checks the whole workspace, because a defect could write outside the scenario's space.
- 30.10.2026: a field matches when its quote holds the ground truth's value, the values hold one another with the same digits after reduction to letters and digits, and the page agrees, because the model returns a short value in its own words while the quote must be verbatim (EXTRACT "Sources"); an exact string match of the value would fail nearly every field. This departs from spec section 9's wording "exact field match"; the digit rule keeps a partial number such as "0" from matching.
- 30.10.2026: wrong fields and flagged fields are counted apart (`extraction_no_wrong_value`), because spec section 15 item 3 accepts a flagged field but not a wrong one; its threshold follows the rule like the other metrics, because the match rule can rate a correct paraphrase `wrong`, and the report lists every `wrong` field for review.
- 30.10.2026: citation accuracy requires every cited page to be expected, because citing the outdated page of a contradiction pair next to the current one is a wrong citation.
- 30.10.2026: all suites run through the wiki's endpoints as the seed users, as the canary suite does (LEAK Decisions), because that path includes the permission filter and the final check of cited pages.
- 30.10.2026: a run with failed requests or judgements, or a metric with no cases, adds no threshold, because a model or judge outage, or a broken index, would otherwise set a baseline that proves nothing.
- 30.10.2026: the judge sees only wikis whose pages all carry seed titles, checked before any question is asked, because spec section 11 allows only fictional seed data to reach the Anthropic API and the eval command can run against a stack the developer started.
- 30.10.2026: the golden questions join the leak question list, as LEAK's Decisions announced, so the prompt-content check in CI covers them for every seed user. LEAK's spec is not changed here; its Decision already names this.
- 30.10.2026: limits per case are 300 s per answer (the canary suite's read timeout), 210 s per extraction (EXTRACT's 200 s wiki limit plus overhead) and 15 minutes per agent run (AGENT's 10 minutes plus overhead), so a hanging case cannot block the run.
- 30.10.2026: AGENT's Decisions promised an M10 case for a task outside the tools that the model starts with tool calls; the suite checks that such a run makes no proposal and no write. Whether its final message claims more than the run did needs a judge and is not measured here.
- 30.10.2026: re-setting ASK's relevance threshold and deciding on German full-text search stay with later changes to those specs, because the question endpoint does not expose section scores, so the evals measure the effect (refusal, citation accuracy) but not the scores a new threshold would come from.
- 30.10.2026: the report names the processor of the machine that runs the eval command, because in the seed setup the model runs on the same Mac (spec section 13); a remote model is the developer's note to add.
