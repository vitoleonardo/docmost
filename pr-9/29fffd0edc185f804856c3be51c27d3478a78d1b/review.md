# Review (round 2, base m8-agent)

Reviewer: `reviewer` agent on opus, head `009e51b1` (before the round 2 fixes in `b8c2a8f9`).

## Verdict
No high findings. Ready for PR once findings 1 and 2 (medium) are fixed or accepted; both were fixed in `b8c2a8f9`.

## Criteria
All REQLOG-AC1 to AC55 pass. AC25, AC37, AC44 and AC54 are integration tests the reviewer could not run (guard); the main session ran them (176 passed). AC53 passed for the connect phase only at review time; `b8c2a8f9` adds the client-side write deadline and a test for a write the database never answers.

## Findings and resolution
1. medium: write bound per phase, a stall after the handshake held the writer → fixed: `WriteDeadline` shuts the socket after the overall 5 s deadline (`b8c2a8f9`).
2. medium: `UTC_NOW` copied `worker.utc_now` → fixed: one `utc_now` in `request_log.py`.
3. low: only `ModelUnavailable`/`ModelCallCancelled` emptied the counts → fixed: any model-call exception.
4. low: `flush` racing `close` waited its full timeout → fixed: returns False once `close` started.
5. low: AC53 test had 1 s slack → fixed: injectable connect timeout of 2 s in the test.
6. low: test labels and repeated URL literal → fixed.
7. low: diff size over the limit → accepted: one PR per milestone is the user's decision (session instructions, logged under Decisions to review).

## Round 1 (head `307db102`)
One high (blocking log write on the event loop at client disconnect) and five mediums; all fixed in `009e51b1` (background writer thread, single INSERT, agent `prepare` error row, extraction log line order, shared retention helper, mutation proofs for AC12, AC13, AC52).

## Checks at review
ai-service: pyright 0 errors, ruff clean, 981 unit tests passed. TypeScript apps unchanged by this branch; their failures are in `.claude/baseline.tsv`.
