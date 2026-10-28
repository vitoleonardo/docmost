# Indexing

ID prefix: INDEX

## Goal
Ask (M5) and the agent (M8) answer from the wiki's pages and PDF attachments. Indexing keeps a searchable copy of that content in the AI service, split into sections that remember their headings, so answers can cite page and section, stay current after edits, and drop content that was deleted or moved away.

## User flow
1. The developer runs the AI service's database setup once (BRIDGE user flow step 2), then the AI service's migration command, which creates the index storage in the AI schema. The developer sets the wiki's address for the AI service and starts the AI service and its indexing worker.
2. On start, the worker runs the reconcile: it compares the wiki's page list with the index and indexes every page that is missing or out of date. On an empty index this is the initial full index. When it is done, the worker logs "Reconcile finished" with the number of pages indexed and removed.
3. While it runs, the worker takes the jobs the bridge forwards (BRIDGE forwarded jobs table) one at a time in the order they arrived and updates the index: new and edited pages are indexed again, pages in the trash or deleted are removed, moved pages get their new space, deleted spaces and workspaces lose all their entries. A job that names a parent page names its child pages too.
4. Every 10 minutes, and when the developer runs the reconcile command, the reconcile runs again and fixes every difference, so a lost job (BRIDGE out of scope: no retry) is made good. A job and a reconcile never change the index at the same time, and only one reconcile runs at a time.
5. After the seed rebuild (which empties the AI schema and gives pages new ids), the developer runs the migration command and the reconcile command.
6. Ask and the agent search the index with a question, the space ids of the user's token and a result limit. The search returns the best-matching sections. The permission check of each result is Ask's job (M5); the index search only narrows by space.
7. The developer reads in the worker's log which job was processed, which page was indexed or removed, why a PDF was skipped and why a job is being retried. The log never holds page titles, page text, PDF text or tokens.

### What the index holds
- Per page (an entry): page id, title, space id, workspace id, the page's last update time in the wiki, the embedding model and the time it was indexed.
- Per section of a page: the page id, the heading path (the titles of the headings above the section, outermost first; empty for text before the first heading), the section's text and its embedding. A heading with no text below it before the next heading gives no section of its own.
- Per section of a PDF attached to the page: the page id, the attachment id, the file name, the PDF page number (from 1), the text and its embedding. A section never spans two PDF pages; a PDF page without text gives no section.
- A section holds at most 1,500 characters. A longer section is split into several sections with the same heading path.
- The page title and the heading path count as part of each section for search, so a word of the title finds the page's sections.

### Search
- Input: a question, a list of space ids and a limit from 1 to 50 (default 10).
- Output: sections ordered by score, best first. The score is the similarity of question and section from -1 to 1; higher is better. One page may appear with several sections.
- Each result holds the page id, the page title, the space id, the heading path, the text and the score, and for a PDF section the attachment id, file name and PDF page number.
- Only sections of pages indexed with the active embedding model are searched.

### Limits
- A PDF larger than 20 MiB (20,971,520 bytes) or with more than 300 pages is not indexed.
- A PDF without a text layer is not indexed (no OCR in v1).
- Every request of the worker to the bridge gives up after 30 s.

### Failures while processing a job
- The bridge refuses the connection, does not answer within 30 s, answers with a server error, answers 503 `assistant_disabled` or rejects the service token, or the AI database is unreachable: the job is retried every 10 s until it succeeds. Each failed attempt logs a warning naming the job and the cause.
- Any other error while indexing a page: the job is tried 3 times, then skipped with a warning naming the job and the cause. The next reconcile tries the page again.

### New bridge endpoint
The page list: for a valid service token, the id, space id and last update time of every page that is not in the trash and whose space is not marked as deleted, in pages of at most 500 entries with a cursor for the next one. The last update time is the same value the page-content endpoint returns. The contract file lists the endpoint.

The page-content endpoint answers `page_not_found` for a page whose space is marked as deleted, as the page list leaves such pages out.

## Acceptance criteria

### Setup and initial index
- **INDEX-AC1**: Given the database setup has run, when the AI service's migration command runs as the AI role, then it exits with status 0 and the index storage exists in the AI schema.
- **INDEX-AC2**: Given the seeded wiki and an empty index, when the worker has logged "Reconcile finished" after its start, then the index lists exactly the pages of the page list, each with the title, space id and last update time the wiki reports.
- **INDEX-AC3**: Given the seeded wiki and an empty index, when the worker has logged "Reconcile finished" after its start, then every seeded page whose body has text has at least one section in the index.
- **INDEX-AC4**: Given the seeded wiki and an empty index, when the worker has logged "Reconcile finished" after its start, then every seeded PDF with a text layer has at least one section in the index with its attachment id, file name and PDF page number.

### Sections
- **INDEX-AC5**: Given a page with a level-1 heading "A", below it a level-2 heading "B" and below that a paragraph, when the page is indexed, then the paragraph's section has the heading path ["A", "B"].
- **INDEX-AC6**: Given a page with headings "A" (level 1), "B" (level 2), a paragraph, "C" (level 2) and a second paragraph, when the page is indexed, then the second paragraph's section has the heading path ["A", "C"].
- **INDEX-AC7**: Given a page with a level-1 heading "A" followed directly by a level-3 heading "D" and a paragraph, when the page is indexed, then the paragraph's section has the heading path ["A", "D"].
- **INDEX-AC8**: Given a page that starts with a paragraph before its first heading, when the page is indexed, then that paragraph's section has an empty heading path.
- **INDEX-AC9**: Given a page with a section of 4,000 characters, when the page is indexed, then it is split into sections of at most 1,500 characters each, all with the same heading path, whose texts hold every word of the original section in its original order.
- **INDEX-AC10**: Given a PDF with text on 3 pages, when its page is indexed, then each of its sections carries the number of the PDF page its text comes from, and every number from 1 to 3 occurs.
- **INDEX-AC11**: Given a PDF with text on pages 1 and 3 and no text on page 2, when its page is indexed, then its sections carry the PDF page numbers 1 and 3 only.
- **INDEX-AC12**: Given any indexed section, when its text is embedded again with the model recorded for its page, then the result equals the stored embedding within 1e-5 per component.

### Search
- **INDEX-AC13**: Given the indexed seed data, when the index is searched with a sentence that occurs verbatim in exactly one seeded page and a space id list that holds that page's space, then a section of that page is the first result.
- **INDEX-AC14**: Given the indexed seed data, when the index is searched with a sentence that occurs verbatim in exactly one seeded PDF and a space id list that holds the space of its page, then a section of that PDF is among the first 5 results.
- **INDEX-AC15**: Given an indexed page whose title holds a word that occurs nowhere else in the wiki, when the index is searched with that word for its space, then a section of that page is among the first 5 results.
- **INDEX-AC16**: Given the indexed seed data, when the index is searched with a space id list, then every result belongs to a page whose indexed space id is in that list.
- **INDEX-AC17**: Given any search, when its results are read, then each holds the fields the search output lists and the results are ordered by score from highest to lowest.
- **INDEX-AC18**: Given an index with more than 50 sections in one space, when the index is searched for that space with the limit 50, then it returns 50 results.
- **INDEX-AC19**: Given an index with more than 10 sections in one space, when the index is searched for that space without a limit, then it returns 10 results.
- **INDEX-AC20**: Given pages indexed with a model other than the active one, when the index is searched, then no section of those pages is returned.

### Incremental updates
- **INDEX-AC21**: Given the worker is running, when a `page-created` job for a new page is processed, then the index lists the page and a search with a sentence of its content returns a section of it among the first 5 results.
- **INDEX-AC22**: Given an indexed page whose content holds a sentence X, when X is replaced by a sentence Y and the `page-content-updated` job is processed, then no section of the page contains X and a search for Y returns a section of the page among the first 5 results.
- **INDEX-AC23**: Given the full stack runs locally with the real embedding model and no other job waiting, when a page's content is changed in the wiki, then the time from the page's new last update time to the first search for a sentence of the new content that returns the page among its first 5 results is at most 60 s.
- **INDEX-AC24**: Given an indexed page with an indexed child page, when the parent is moved to the trash and the `page-soft-deleted` job is processed, then the index holds no entry and no section of either page.
- **INDEX-AC25**: Given a page in the trash that is not in the index, when it is restored and the `page-restored` job is processed, then the index lists the page and holds its sections.
- **INDEX-AC26**: Given an indexed page, when it is deleted permanently and the `page-deleted` job is processed, then the index holds no entry and no section of that page.
- **INDEX-AC27**: Given an indexed page with an indexed child page, when the parent is moved to another space and the `page-moved-to-space` job is processed, then the index lists both pages with the new space id, and a search with a sentence of either page and only the old space id does not return it.
- **INDEX-AC28**: Given indexed pages of a space, when the `space-deleted` job for it is processed, then the index holds no entry with that space id and no section of those pages, including PDF sections.
- **INDEX-AC29**: Given indexed pages of a workspace, when the `workspace-deleted` job for it is processed, then the index holds no entry with that workspace id and no section of those pages, including PDF sections.
- **INDEX-AC30**: Given a job that names several page ids, when it is processed, then the index reflects the job for every one of them.
- **INDEX-AC31**: Given an indexed page with an indexed PDF, when only the page's text is changed and the `page-content-updated` job is processed, then the PDF is not requested from the bridge again and its sections stay in the index.
- **INDEX-AC32**: Given an indexed page with an indexed PDF, when the PDF is removed from the page and the `page-content-updated` job is processed, then the index holds no section of that PDF.

### Reconcile
- **INDEX-AC33**: Given a page whose last update time in the wiki differs from the one in the index, when the reconcile runs, then the page is indexed again with its current title, content and last update time.
- **INDEX-AC34**: Given a page that is in the page list but not in the index, when the reconcile runs, then the page is indexed.
- **INDEX-AC35**: Given an indexed page that is no longer in the page list, when the reconcile runs, then the index holds no entry and no section of that page.
- **INDEX-AC36**: Given an indexed page whose space id in the index differs from the page list's, when the reconcile runs, then the index lists the page with the page list's space id.
- **INDEX-AC37**: Given an indexed page whose recorded embedding model is not the active one, when the reconcile runs, then the page is indexed again with the active model.
- **INDEX-AC38**: Given an index that matches the page list, when the reconcile runs, then no page content is requested from the bridge and no section is embedded.
- **INDEX-AC39**: Given the worker is running, when 10 minutes have passed since its last reconcile finished, then it runs the reconcile.
- **INDEX-AC40**: Given the index differs from the page list, when the developer runs the reconcile command, then it fixes the difference and exits with status 0.
- **INDEX-AC41**: Given a page created after a running reconcile read the page list, when that reconcile and the page's `page-created` job have both finished, then the index lists the page and holds its sections.
- **INDEX-AC42**: Given a page moved to another space after a running reconcile read the page list, when that reconcile and the page's `page-moved-to-space` job have both finished, then the index lists the page with the new space id.

### Page list endpoint
- **INDEX-AC43**: Given a valid service token, when the AI service requests the page list until no cursor is returned, then the responses together hold every page that is not in the trash and not in a space marked as deleted exactly once, each with its id, space id and last update time.
- **INDEX-AC44**: Given a wiki with 501 pages, when the AI service requests the first part of the page list, then the response holds 500 entries and a cursor.
- **INDEX-AC45**: Given a page, when its last update time is read from the page list and from the page-content endpoint, then both values are equal.

## Edge cases
- **INDEX-AC46**: Given a page in the trash or in a space marked as deleted, when the AI service requests the page list, then that page is not in it.
- **INDEX-AC47**: Given a page in a space marked as deleted, when the AI service requests its content with a valid service token, then the bridge answers with status 404 and error code `page_not_found`.
- **INDEX-AC48**: Given a cursor that the page list did not return, when the AI service requests the page list with it, then the bridge answers with status 400 and error code `invalid_request`.
- **INDEX-AC49**: Given the assistant is switched off, when the page list is requested, then the bridge answers with status 503 and error code `assistant_disabled`.
- **INDEX-AC50**: Given a request for the page list without a service token, when it reaches the bridge, then the bridge answers with status 401 and error code `service_token_missing`.
- **INDEX-AC51**: Given a request for the page list with a wrong service token, when it reaches the bridge, then the bridge answers with status 401 and error code `service_token_invalid`.
- **INDEX-AC52**: Given a request for the page list with a user id in its body, when it reaches the bridge, then the bridge answers with status 400 and error code `user_id_not_allowed`.
- **INDEX-AC53**: Given a `page-created` or `page-content-updated` job for a page that is in the index and that the bridge now answers with `page_not_found`, when the job is processed, then the index holds no entry of that page and the next job is processed.
- **INDEX-AC54**: Given a job with a name the worker does not know or with data missing a field the forwarded jobs table lists, when it is processed, then the index is unchanged, the worker logs a warning naming the job, and the next job is processed.
- **INDEX-AC55**: Given the bridge refuses connections, when the worker processes a job, then the job stays unprocessed and the worker logs a warning naming the job and the cause.
- **INDEX-AC56**: Given a job left unprocessed because the bridge refused connections, when the bridge answers again, then the job is processed within 15 s.
- **INDEX-AC57**: Given the bridge does not answer within 30 s, answers with a server error, answers `assistant_disabled` or rejects the service token, when the worker processes a job, then the job stays unprocessed and is retried every 10 s.
- **INDEX-AC58**: Given indexing a page fails with an error not listed for retries every time, when its job is processed, then the job is tried 3 times, the worker logs a warning naming the job and the cause, and the next job is processed.
- **INDEX-AC59**: Given the worker stops after taking a job and before finishing it, when the worker starts again, then the job is processed.
- **INDEX-AC60**: Given an indexed page, when a `page-created`, `page-content-updated` or `page-restored` job for it is processed twice, then the index lists the page once and holds each of its sections once.
- **INDEX-AC61**: Given a page indexed with last update time T2, when content with an earlier last update time T1 is indexed for it, then the index keeps T2 and the sections of T2.
- **INDEX-AC62**: Given a page with an empty body, a body of whitespace only or a body of headings only, and no PDF, when it is indexed, then the index lists the page with no section.
- **INDEX-AC63**: Given a page with a PDF without a text layer, when it is indexed, then the index holds no section of that PDF, holds the page's other sections, and the worker logs a warning naming the attachment id and "no text layer".
- **INDEX-AC64**: Given a page with a PDF of more than 20,971,520 bytes, when it is indexed, then the PDF is not requested from the bridge, the index holds no section of it, and the worker logs a warning naming the attachment id and the size limit.
- **INDEX-AC65**: Given a page with a PDF of exactly 20,971,520 bytes with a text layer, when it is indexed, then the index holds sections of it.
- **INDEX-AC66**: Given a page with a PDF of 301 pages, when it is indexed, then the index holds no section of it and the worker logs a warning naming the attachment id and the page limit.
- **INDEX-AC67**: Given a page with a PDF of exactly 300 pages with a text layer, when it is indexed, then the index holds sections of it.
- **INDEX-AC68**: Given a PDF that cannot be parsed, when its page is indexed, then the index holds the page's other sections and the worker logs a warning naming the attachment id.
- **INDEX-AC69**: Given the bridge answers `attachment_not_found` for a listed PDF, when its page is indexed, then the index holds the page's other sections and no section of that PDF.
- **INDEX-AC70**: Given the index is searched with an empty space id list, when it returns, then the result list is empty.
- **INDEX-AC71**: Given the index is searched with an empty or whitespace-only question, when it returns, then the result list is empty.
- **INDEX-AC72**: Given the index is searched with a limit of 0 or 51, when it is called, then it refuses with an error naming the allowed limit range.
- **INDEX-AC73**: Given any job the worker processes, when its log lines are read, then they contain no page title, page text, PDF text or token.
- **INDEX-AC74**: Given the AI schema has no index storage, when the worker starts, then it exits with a non-zero status and a message naming the migration command.
- **INDEX-AC75**: Given the migration command has run once, when it runs a second time, then it exits with status 0 and the index is unchanged.
- **INDEX-AC76**: Given the wiki's address is not configured for the AI service, when the worker starts, then it exits with a non-zero status and a message naming the missing setting.
- **INDEX-AC77**: Given the embedding model cannot be loaded, when the worker starts, then it exits with a non-zero status and a message naming the model.
- **INDEX-AC78**: Given a reconcile reads the page list and one of its requests fails, when the reconcile ends, then the index is unchanged and the worker logs a warning naming the cause.
- **INDEX-AC79**: Given the bridge is unreachable, when the developer runs the reconcile command, then it exits with a non-zero status and a message naming the bridge address.
- **INDEX-AC80**: Given a reconcile is running, when another reconcile is due or the reconcile command is started, then the second one starts only after the first has finished.

## Out of scope
- The permission filter of search results and the final citation check (Ask, M5, spec section 7 items 3 and 4); the index search narrows by space only.
- An HTTP search endpoint on the AI service; Ask adds the endpoint it needs.
- German full-text search next to the vectors; the evals (M10) decide whether it helps.
- Comments, page history, attachments other than PDF, OCR.
- A re-index button or admin page; the reconcile command covers manual re-indexing.
- Changing the embedding model at runtime; a new model is a configuration change followed by the reconcile.
- More than one workspace; entries still carry the workspace id.

## Open questions

## Decisions
- 28.10.2026: one reconcile mechanism does the initial full index, the 10-minute gap check and the manual re-index, because an empty index is just the largest difference and a second path would drift from the first.
- 28.10.2026: the reconcile also compares the space id and the embedding model, not only the last update time, because a lost move job does not change the update time (spec section 7 item 7) and a model change must re-index (spec section 6).
- 28.10.2026: a job and a reconcile never change the index at the same time and only one reconcile runs at a time, also when the reconcile command runs next to the worker, because a reconcile working from a page list read before a job would undo that job (INDEX-AC41, INDEX-AC42).
- 28.10.2026: a reconcile whose page list could not be read completely changes nothing, because a partial list looks like deleted pages and would empty the index.
- 28.10.2026: a page title change without a content change reaches the index through the reconcile only, because the wiki puts title changes on its search queue, not on the AI job queue; a title change does update the page's last update time, which the reconcile compares.
- 28.10.2026: jobs are processed one at a time in arrival order, and failures of the bridge or the AI database are retried every 10 s without limit, because a later job for the same page must not overtake an earlier one and skipping jobs during an outage would only move the work to the reconcile. Other errors give up after 3 attempts, because an error that repeats for one page must not stop the queue.
- 28.10.2026: the freshness ceiling of INDEX-AC23 is 60 s from the page's new last update time in the wiki, derived from the parts (forwarding within 5 s, BRIDGE-AC29, plus embedding one page on CPU in about a second), instead of waiting for a first measurement as spec section 9 says, because a criterion needs a number before the build. The editor's own save delay of 10 to 45 s comes before the update time and is not counted. INDEX-AC23 runs locally only (it needs the full stack and the real model); the first measurement on the M3 Pro is recorded here when it is made.
- 28.10.2026: the search narrows by space ids only and returns sections of restricted pages inside readable spaces, because the permission decision belongs to the bridge's filter (BRIDGE-AC13), which Ask calls on every candidate before any text reaches the model.
- 28.10.2026: a page removed from the wiki leaves the index when its job is processed or, if the job is lost, with the next reconcile within about 10 minutes; "a soft-deleted page is never retrieved" (spec section 7 item 7) is guaranteed by Ask's filter on every candidate, which M6's stale-index cases test.
- 28.10.2026: pages indexed with another embedding model are left out of the search until the reconcile has indexed them again, because scores across two models are not comparable.
- 28.10.2026: the page list may miss or repeat a page created, moved or deleted while it is being read; the job for that change or the next reconcile corrects the index.
- 28.10.2026: a PDF's sections are kept as long as the same attachment id is listed on its page, because an attachment's file does not change under its id (a new upload is a new attachment).
- 28.10.2026: sections are at most 1,500 characters and the search returns at most 50 results, because retrieval passes a few dozen candidates to the filter (at most 500 ids, BRIDGE-AC59) and a section must fit several times into a local model's context.
- 28.10.2026: PDFs over 20 MiB or 300 pages are skipped with a warning, because parsing and embedding them on CPU would block the queue for minutes; the seed PDFs are far below both.
- 28.10.2026: CI runs the index criteria with a deterministic test embedder; INDEX-AC13 to INDEX-AC15 also run locally with the real embedding model, because CI runners do not download the model (spec section 10).
- 28.10.2026: German full-text search is not built in M4, because spec section 9 makes it conditional on the evals, which come with M10.
- 28.10.2026: the page-content endpoint answers `page_not_found` for a page in a space marked as deleted, because otherwise a job would index a page that the page list leaves out and the next reconcile removes again. Core deletes spaces hard today, so this only closes a defensive gap, as in BRIDGE-AC19.
