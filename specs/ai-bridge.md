# AI bridge

ID prefix: BRIDGE

## Goal
Every later AI feature (indexing, Ask, extraction, agent) needs a trusted channel between the wiki and the separate AI service. The bridge gives the AI service the wiki's content and permission decisions for exactly one user at a time, so that a user's assistant never sees what that user may not see, and the wiki keeps working when the AI service is down.

## User flow
1. The developer sets the bridge secret, the service token and the AI service address for the wiki, and gives the AI service the same secret and token. With any of the three missing, the assistant is switched off and the wiki shows no trace of it.
2. The developer runs the AI service's database setup command once with admin credentials. It creates the AI service's own database role and the AI schema. The AI service connects with that role only and refuses to start if the role can read the wiki's tables.
3. A logged-in user opens a page and sees a new assistant icon in the page's action row, between "Share" and the comments icon (mockup `docs/design/ai-assistant.html`, Overview). Clicking it opens the panel "Assistent" in the right sidebar.
4. The panel shows a loader while it asks the wiki for the assistant's status. The wiki checks that the AI service answers and accepts a user token issued for this user. The token itself never reaches the browser.
   - Available: the panel shows "Frag das Wiki" and "Antworten stützen sich nur auf Seiten, die du sehen darfst, und nennen ihre Quellen." (mockup state A1, heading and hint only).
   - Unavailable: the panel shows "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter." and a button "Erneut versuchen" (mockup state A4). Everything else in the wiki works as before.
5. Behind the scenes the AI service calls the bridge's internal endpoints: it checks which candidate pages a user may view, reads page content and attachments for indexing, runs read-only tools as the user, and exchanges a user token for a longer-lived task token for multi-step runs. Page, space and workspace changes the wiki puts on its AI job queue are handed to the AI service's own durable queue.

### Tokens
- User token: issued by the bridge for one logged-in user, signed with the bridge secret (not the wiki's app secret). Claims: user id (`sub`), workspace id, the ids of the spaces the user is a member of at issue time, audience `ai-service`, issue and expiry time, at most 60 s apart.
- Task token: issued by the bridge in exchange for a valid user token and a run id. Claims: user id, workspace id, run id, audience `ai-service`, token type `task`, at most 15 min between issue and expiry.
- Service token: one static secret shared by the bridge and the AI service. Every internal request in either direction carries it.

Requests between the two sides never carry a user id: the user always comes from the user token or task token. The space ids in a user token are a retrieval hint only. Every permission decision on the bridge uses the wiki's current data: the page's current space, whether it is in the trash, whether its space is marked as deleted, the user's current memberships, whether the user is active, and the page restrictions.

### Forwarded jobs
| Job | Data |
|---|---|
| `page-created`, `page-content-updated`, `page-soft-deleted`, `page-restored`, `page-deleted` | page ids, workspace id |
| `page-moved-to-space` | page ids, new space id, workspace id |
| `space-deleted` | space id, workspace id |
| `workspace-deleted` | workspace id |

Every other job on the AI job queue is removed without forwarding.

### Contract
One contract file in the repository describes every endpoint between the bridge and the AI service, the token claims, the error codes and the job format. Both sides test against it.

## Acceptance criteria
- **BRIDGE-AC1**: Given the bridge secret, the service token or the AI service address is not configured, when a logged-in user requests the assistant status, then the response is `disabled`.
- **BRIDGE-AC2**: Given the assistant status is `disabled`, when a logged-in user opens a page, then the page's action row shows no assistant icon.
- **BRIDGE-AC3**: Given the bridge is configured and the AI service accepts the user's token, when a logged-in user requests the assistant status, then the response is `available`.
- **BRIDGE-AC4**: Given any response of the assistant status, when its body and headers are read, then they contain no user token and no task token.
- **BRIDGE-AC5**: Given the status is `available`, when the user clicks the assistant icon on a page, then the panel "Assistent" opens and shows "Frag das Wiki".
- **BRIDGE-AC6**: Given the status is `unavailable`, when the user opens the panel, then it shows "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter." and a button "Erneut versuchen".
- **BRIDGE-AC7**: Given the panel shows the unavailable state and the AI service has become reachable, when the user clicks "Erneut versuchen", then the panel shows "Frag das Wiki".
- **BRIDGE-AC8**: Given the bridge is configured and the AI service is down, when a user logs in, creates a page, edits its content and reloads it, then every step succeeds and the page shows the edited content.
- **BRIDGE-AC9**: Given the bridge is configured and the AI service is down, when the wiki's health check is requested, then it reports the wiki as healthy.
- **BRIDGE-AC10**: Given a logged-in user, when the bridge issues a user token, then the token's space ids are exactly the spaces not marked as deleted that the user is a member of directly or through a group.
- **BRIDGE-AC11**: Given a logged-in user, when the bridge issues a user token, then its `sub` is the user's id, its workspace id is the user's workspace, its audience is `ai-service` and its expiry is at most 60 s after its issue time.
- **BRIDGE-AC12**: Given a user token, when its signature is checked, then it verifies with the bridge secret and fails with the wiki's app secret.
- **BRIDGE-AC13**: Given a valid service token and a valid user token, when the AI service asks the bridge to filter a list of page ids, then the response contains exactly those ids of the list that the user may view now, in the order of their first occurrence.
- **BRIDGE-AC14**: Given a page the user could view when the token was issued and that has since moved to a space the user is not a member of, when the AI service asks the bridge to filter it, then the page is not in the response.
- **BRIDGE-AC15**: Given a page in the trash, when the AI service asks the bridge to filter it for a member of its space, then the page is not in the response.
- **BRIDGE-AC16**: Given a user removed from a space after the token was issued, when the AI service asks the bridge to filter a page of that space with that token, then the page is not in the response.
- **BRIDGE-AC17**: Given the seeded restricted pages, when the AI service asks the bridge to filter each of them for each seed user, then each page is in the response exactly for the users the seed page matrix grants view, directly, through a group or by inheritance.
- **BRIDGE-AC18**: Given one unrestricted seeded page from each of the 6 seed spaces in one list, when the AI service asks the bridge to filter the list for each seed user, then each page is in the response exactly for the users the seed space matrix gives a membership in its space.
- **BRIDGE-AC19**: Given a space marked as deleted whose members still exist, when the AI service asks the bridge to filter a page of that space for a member, then the page is not in the response.
- **BRIDGE-AC20**: Given a valid service token, when the AI service requests the content of a page, then the response holds the page's id, title, space id, workspace id, last update time and the content as Markdown with the page's headings as Markdown headings.
- **BRIDGE-AC21**: Given a page with PDF and non-PDF attachments, when the AI service requests its content, then the response lists the id, file name, type and size of every PDF attachment and of no other attachment.
- **BRIDGE-AC22**: Given a restricted page or a page in the space Geschäftsführung, when the AI service requests its content with a valid service token, then the bridge returns it like any other page.
- **BRIDGE-AC23**: Given a valid service token, when the AI service requests an attachment by id, then the response body is the stored file byte for byte, with the file's content type.
- **BRIDGE-AC24**: Given a valid service token and a user token for a user who may view a page, when the AI service calls the read-page tool for that page, then the response holds the page's id, title, space id and its content as Markdown.
- **BRIDGE-AC25**: Given a valid service token and a user token, when the AI service calls the search tool with a query and a space the user is a member of, then every result is a page of that space, not in the trash, that the user may view, and the response holds at most 20 results.
- **BRIDGE-AC26**: Given a page of a readable space whose title or content contains a word, when the AI service calls the search tool with that word for that space as a user who may view the page, then the page is among the results.
- **BRIDGE-AC27**: Given a valid service token and a valid user token, when the AI service exchanges it for a task token with a run id, then the task token carries the user's id, the workspace id, the run id, type `task` and an expiry at most 15 min after its issue time.
- **BRIDGE-AC28**: Given a valid task token, when the AI service calls the filter, the read-page tool or the search tool with it instead of a user token, then the bridge answers as it does for a user token of the same user.
- **BRIDGE-AC29**: Given the bridge is configured and the AI service is reachable, when a page is created in the wiki, then within 5 s the AI service's job queue holds a job named `page-created` with that page's id and workspace id.
- **BRIDGE-AC30**: Given the bridge is configured and the AI service is reachable, when the wiki puts each job of the forwarded jobs table on its AI job queue, then the AI service's job queue receives a job with the same name and the data that table lists.
- **BRIDGE-AC31**: Given a job the AI service has accepted, when the AI service restarts, then the job is still in its queue.
- **BRIDGE-AC32**: Given the database setup command has run, when the AI service's database role creates and drops a table in the AI schema, then both succeed.
- **BRIDGE-AC33**: Given the AI service's database role, when it reads any table of the wiki's schema, then the database refuses with a permission error.
- **BRIDGE-AC34**: Given the AI service's database role, when it inserts, updates or deletes rows in a table of the wiki's schema, then the database refuses each with a permission error.
- **BRIDGE-AC35**: Given the contract file, when the bridge's internal endpoints and the AI service's endpoints are compared with it, then every endpoint, request field, response field and error code of each side is in the contract file and every entry of the contract file exists on its side.
- **BRIDGE-AC36**: Given the contract file, when the tokens the bridge issues and the jobs it forwards are compared with it, then every claim and every job field is in the contract file and every claim and job field of the contract file is present.

## Edge cases
- **BRIDGE-AC37**: Given no login session, when the assistant status is requested, then the wiki answers with status 401.
- **BRIDGE-AC38**: Given the bridge is configured and the AI service refuses connections, when a logged-in user requests the assistant status, then the response is `unavailable`.
- **BRIDGE-AC39**: Given the bridge is configured and the AI service accepts the connection but does not answer, when a logged-in user requests the assistant status, then the response is `unavailable` within 5 s.
- **BRIDGE-AC40**: Given the bridge is configured and the AI service answers with a server error, when a logged-in user requests the assistant status, then the response is `unavailable`.
- **BRIDGE-AC41**: Given the bridge is configured and the AI service rejects the user token, when a logged-in user requests the assistant status, then the response is `unavailable`.
- **BRIDGE-AC42**: Given the panel shows the unavailable state and the AI service is still down, when the user clicks "Erneut versuchen", then the panel shows the unavailable state again.
- **BRIDGE-AC43**: Given a user who is a member of no space, when the bridge issues a user token, then the token's space ids are an empty list.
- **BRIDGE-AC44**: Given the bridge secret is shorter than 32 characters, when the wiki starts, then it exits with a message naming the bridge secret's minimum length.
- **BRIDGE-AC45**: Given the assistant is switched off, when any internal endpoint of the bridge is called, then the bridge answers with status 503 and error code `assistant_disabled`.
- **BRIDGE-AC46**: Given an internal request without a service token, when it reaches the bridge, then the bridge answers with status 401 and error code `service_token_missing`.
- **BRIDGE-AC47**: Given an internal request with a wrong service token, when it reaches the bridge, then the bridge answers with status 401 and error code `service_token_invalid`.
- **BRIDGE-AC48**: Given a valid service token and a user id in the request but no user token, when the AI service calls any endpoint that needs a user token, then the bridge answers with status 401 and error code `user_token_missing`.
- **BRIDGE-AC49**: Given a valid service token, a valid user token and a user id in the request, when the AI service calls any endpoint that needs a user token, then the bridge answers with status 400 and error code `user_id_not_allowed`.
- **BRIDGE-AC50**: Given a valid service token and an expired user token or task token, when the AI service calls any endpoint that needs a user token, then the bridge answers with status 401 and error code `user_token_expired`.
- **BRIDGE-AC51**: Given a valid service token and a token that is malformed, has an audience other than `ai-service`, uses the algorithm `none`, is a wiki login token or is signed with a secret other than the bridge secret, when the AI service calls any endpoint that needs a user token, then the bridge answers with status 401 and error code `user_token_invalid` for each.
- **BRIDGE-AC52**: Given a valid user token or task token whose user has since been deactivated or deleted, when the AI service calls any endpoint that needs a user token, then the bridge answers with status 401 and error code `user_token_invalid`.
- **BRIDGE-AC53**: Given a valid service token and a task token, when the AI service asks to exchange it for another task token, then the bridge answers with status 401 and error code `user_token_invalid`.
- **BRIDGE-AC54**: Given a valid user token, when the AI service exchanges it twice with the same run id, then both answers are valid task tokens for that run.
- **BRIDGE-AC55**: Given a valid user token, when the AI service calls the filter with an empty list, then the response is an empty list.
- **BRIDGE-AC56**: Given a valid user token, when the AI service calls the filter with a list that names a page twice, then the page is in the response once.
- **BRIDGE-AC57**: Given a valid user token, when the AI service calls the filter with a well-formed id that belongs to no page, then that id is not in the response and the other ids are filtered as usual.
- **BRIDGE-AC58**: Given a valid user token, when the AI service calls the filter with an id that is not a well-formed page id, then the bridge answers with status 400 and error code `invalid_request`.
- **BRIDGE-AC59**: Given a valid user token, when the AI service calls the filter with exactly 500 ids, then the bridge answers with status 200.
- **BRIDGE-AC60**: Given a valid user token, when the AI service calls the filter with 501 ids, then the bridge answers with status 400 and error code `too_many_page_ids`.
- **BRIDGE-AC61**: Given a valid user token, when the AI service calls the read-page tool for a restricted page the user may not view, a page in a space the user is not a member of, a page in a space marked as deleted, a page in the trash or a page id that does not exist, then the bridge answers with status 404 and error code `page_not_found` for each.
- **BRIDGE-AC62**: Given a valid user token, when the AI service calls the search tool for a space the user is not a member of, a space marked as deleted or a space id that does not exist, then the bridge answers with status 404 and error code `space_not_found` for each.
- **BRIDGE-AC63**: Given a valid user token, when the AI service calls the search tool with an empty query, then the bridge answers with status 400 and error code `invalid_request`.
- **BRIDGE-AC64**: Given the seeded restricted pages, when the AI service calls the search tool as a user who may not view one of them with a word that occurs only in that page, then the results are empty.
- **BRIDGE-AC65**: Given a valid service token, when the AI service requests the content of a page in the trash or of a page id that does not exist, then the bridge answers with status 404 and error code `page_not_found`.
- **BRIDGE-AC66**: Given a page with an empty body, when the AI service requests its content, then the Markdown in the response is an empty string.
- **BRIDGE-AC67**: Given a valid service token, when the AI service requests an attachment whose page is in the trash or an attachment id that does not exist, then the bridge answers with status 404 and error code `attachment_not_found`.
- **BRIDGE-AC68**: Given the AI service refuses connections, rejects the service token or answers with a server error, when the wiki puts a forwarded job on its AI job queue, then the page change that caused it is saved and the wiki logs a warning naming the job, its page ids and the cause, without page content or tokens.
- **BRIDGE-AC69**: Given the assistant is switched off, when the wiki puts a job on its AI job queue, then the job is removed from the queue without a request to the AI service.
- **BRIDGE-AC70**: Given the bridge is configured, when the wiki puts a job that the forwarded jobs table does not list on its AI job queue, then the job is removed from the queue without a request to the AI service.
- **BRIDGE-AC71**: Given a request to the AI service's job endpoint or user-token check without a service token, when it reaches the AI service, then the AI service answers with status 401 and error code `service_token_missing`.
- **BRIDGE-AC72**: Given a request to the AI service's job endpoint or user-token check with a wrong service token, when it reaches the AI service, then the AI service answers with status 401 and error code `service_token_invalid`.
- **BRIDGE-AC73**: Given an expired user token, when the AI service checks it, then the AI service answers with status 401 and error code `user_token_expired`.
- **BRIDGE-AC74**: Given a user token that is malformed, has an audience other than `ai-service`, uses the algorithm `none` or is signed with another secret, when the AI service checks it, then the AI service answers with status 401 and error code `user_token_invalid` for each.
- **BRIDGE-AC75**: Given the AI service's default settings, when it starts, then it accepts connections on the loopback address only.
- **BRIDGE-AC76**: Given the AI service is configured with a database role that can read a table of the wiki's schema, when it starts, then it exits with a non-zero status and the message "Database role must not read wiki tables".
- **BRIDGE-AC77**: Given the AI service's database role, when it creates a table outside the AI schema, then the database refuses with a permission error.
- **BRIDGE-AC78**: Given the database setup command has run once, when it runs a second time, then it exits with status 0 and BRIDGE-AC32 to BRIDGE-AC34 still hold.

## Out of scope
- Asking questions, streaming answers, citations and the final citation check (Ask, M5). The "Fragen" and "Aufgabe" tabs, the scope selector, example questions and the page menu item "Zu dieser Seite fragen" come with Ask and the agent.
- Indexing, embeddings, chunking and the reconcile job; the AI service only stores the jobs it receives (Indexing, M4).
- Write tools, proposals and applying changes for the agent (Agent, M8). The task token's run limits come with M8.
- Extraction and its data (M7).
- A per-workspace switch and admin pages; the assistant is on for everyone when configured.
- Retrying a job the AI service did not accept; the reconcile job of M4 closes such gaps.
- Rotating the service token; the deferred security list covers it.
- Network isolation beyond the loopback default, for example Docker networks; v1 runs locally only.
- More than one workspace and public share pages.

## Decisions
- 28.10.2026: the assistant status checks that the AI service accepts a freshly issued user token, not only that it answers, because a secret mismatch between the two sides would otherwise show as available and fail on the first question. This token check is the AI service's health check for the wiki.
- 28.10.2026: M3 ships the panel with the loading, available and unavailable states only, because the question input, scope selector and example questions belong to Ask (M5) and an input without a backend would mislead.
- 28.10.2026: requests between bridge and AI service never carry a user id and one that does is rejected, because a body user id next to a token is the obvious way to read another user's view.
- 28.10.2026: the read-page tool answers 404 for missing, forbidden, trashed and deleted-space pages alike, and the search tool 404 for missing, foreign and deleted spaces, because a different answer would reveal that restricted content exists (design decision for A3).
- 28.10.2026: the filter accepts at most 500 ids per call and the search tool returns at most 20 results, because retrieval passes a few dozen candidates and an agent step reads a handful of pages; unbounded lists would let one call load the whole wiki.
- 28.10.2026: the search tool uses the wiki's own search, so a match means what the wiki's search box means (a word in the title or the content), because a second search would disagree with what the user sees.
- 28.10.2026: a task token lives at most 15 min, cannot be exchanged for another one, and the bridge keeps no state per run id (the same run id may be exchanged again while the user token is valid), because an agent run must end and must not extend its own rights; M8 sets the run limits inside that window.
- 28.10.2026: a deactivated or deleted user's tokens are rejected on every call, because a task token outlives a user token by up to 15 min.
- 28.10.2026: a space marked as deleted counts as not readable in the filter, the tools and the token's space ids, because `getUserSpaceIds` does not filter `spaces.deleted_at`. Core deletes spaces hard today, so this closes the Phase 0 open question defensively; BRIDGE-AC19 proves it.
- 28.10.2026: when the assistant is switched off, jobs on the AI job queue are removed without forwarding, and so are jobs the forwarded jobs table does not list (the embedding jobs of the enterprise AI settings), because without a consumer they pile up in Redis forever; the full index of M4 covers a later switch-on.
- 28.10.2026: the AI service's database role and the AI schema are created by an explicit setup command with admin credentials, not by a wiki migration, because creating roles needs rights the wiki's own database user should not have. The AI role owns the AI schema; the seed rebuild runs as the database owner, as in the dev and CI setup.
- 28.10.2026: the bridge secret needs at least 32 characters, the same minimum the wiki applies to its app secret, because it signs tokens that carry permissions.
