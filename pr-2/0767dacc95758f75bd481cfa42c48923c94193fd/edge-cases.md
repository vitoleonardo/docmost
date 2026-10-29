# Edge-case matrix

Head 0767dacc, base ai-v1. The matrix script reads only the unit-test JUnit reports (`tests.tsv`). Cases proven only by `apps/server/test/seed-data.e2e-spec.ts` say `n/a: e2e only` with the e2e title; the e2e data run (`data-runs.md`) is their proof.

| Criterion | Case | Input | Expected | Test | Result |
|-----------|------|-------|----------|------|--------|
| SEED-AC1 | happy path | empty migrated DB | 1 workspace, 4 users, 2 groups, 6 spaces | SEED-AC1: creates the owner workspace, 4 users, 2 groups and 6 spaces from the definition | |
| SEED-AC1 | no extra rows | seeded DB | exact counts, no other groups or spaces | n/a: e2e only, "SEED-AC1: seeds exactly 1 workspace, 4 users, 2 groups and the 6 spaces" | |
| SEED-AC1 | default space | initialSetup's General | renamed Allgemein, open | SEED-AC1: renames the default space to Allgemein and keeps it open | |
| SEED-AC1 | space created open | new space open by default | made private | SEED-AC1: makes new spaces private when they are created open | |
| SEED-AC1 | error path signup | signup throws | error propagates | SEED-AC1: propagates a failing signup | |
| SEED-AC1 | error path repo | repo call throws | error propagates, no result | SEED-AC1: propagates a failing repo call and does not report a result | |
| SEED-AC2 | login per user | 4 emails, demo password | auth cookie, no extra step | n/a: e2e only, "SEED-AC2: %s logs in with the demo password and gets an auth cookie" | |
| SEED-AC2 | wrong password | wrong password | login fails, no cookie | n/a: e2e only, "SEED-AC2: a wrong password fails without an auth cookie" | |
| SEED-AC3 | matrix written | space matrix | every membership row | SEED-AC3: writes the space memberships of the matrix | |
| SEED-AC3 | duplicate membership same role | existing row | skipped | SEED-AC3: skips a membership that already exists with the same role | |
| SEED-AC3 | duplicate membership other role | existing row, other role | fails | SEED-AC3: fails on a membership that exists with a different role | |
| SEED-AC3 | per user | 4 users | exact spaces and roles | n/a: e2e only, "SEED-AC3: %s has exactly the spaces and roles of the space matrix" | |
| SEED-AC4 | WS only through group | Projekte members | no direct WS row | SEED-AC4: gives WS no direct Projekte membership, only the group one | |
| SEED-AC5 | default group membership removed | Everyone in General | removed | SEED-AC5: removes the default group from the default space | |
| SEED-AC5 | empty data | no membership to remove | nothing removed | SEED-AC5: does not remove anything when the default group has no space membership | |
| SEED-AC6 | grants written | page matrix | restrictions and grants | SEED-AC6: restricts the listed pages and grants the defined users and groups | |
| SEED-AC6 | inherited child | child page | no own access row | SEED-AC6: a restricted page without grants gets no page access of its own | |
| SEED-AC6 | manifest matches definition | manifest | same restricted pages | SEED-AC6: manifest restricted pages equal the definition and no other page sits below one | |
| SEED-AC6 | view matrix 4 x 4 | each user, each restricted page | view only for granted | n/a: e2e only, "SEED-AC6: only the granted users can view" | |
| SEED-AC6 | missing permission, admin | space admin, no grant | denied | SEED-AC13: a space admin gets no bypass on a restricted page | |
| SEED-AC7 | group reader | Projektteam on Nordhafen intern | reader only | SEED-AC7: grants a group reader access on the internal construction page | |
| SEED-AC7 | edit matrix 4 x 4 | each user, each restricted page | edit only for writers | n/a: e2e only, "SEED-AC7: only the users with view and edit can edit" | |
| SEED-AC7 | grant rows | page matrix | one row per grant, child none | n/a: e2e only, "SEED-AC7: every grant of the page matrix is a row and the child has none" | |
| SEED-AC8 | limits | page manifest | 28 to 34, at least 3 per space | SEED-AC8: has 28 to 34 pages and at least 3 per space | |
| SEED-AC9 | unique titles | page manifest | each title once | SEED-AC9: every title occurs once | |
| SEED-AC9 | duplicates | duplicated title | reported | SEED-AC9: findDuplicateTitles reports a duplicated title | |
| SEED-AC10 | headings | page markdown | at least 10 with 2+ headings | SEED-AC10: at least 10 pages have 2 or more headings | |
| SEED-AC11 | one canary per page | restricted and GF pages | exactly one, others none | SEED-AC11: restricted and Geschäftsführung pages hold exactly one canary, others none | |
| SEED-AC12 | canary in one page | all pages | exactly one page each | SEED-AC12: every canary occurs in exactly one page | |
| SEED-AC12 | canary in PDFs | PDFs and ground truth | only GF canary in GF contract | SEED-AC12: the GF canary occurs once in the GF contract and no other canary occurs in any PDF or ground-truth record | |
| SEED-AC13 | GF pages | unrestricted GF page | PL, VT, WS denied | SEED-AC13: denies PL, VT and WS on an unrestricted Geschäftsführung page | |
| SEED-AC13 | restricted page | Umstrukturierung 2027 | PL, VT, WS denied | SEED-AC13: denies PL, VT and WS on Umstrukturierung 2027 | |
| SEED-AC13 | group grant | WS via Projektteam | counts as view | SEED-AC13: a group grant counts as view for WS | |
| SEED-AC13 | inheritance | child page | parent's denied users | SEED-AC13: the child page inherits the denied users of its parent | |
| SEED-AC13 | no space role | user outside the space | denied | SEED-AC13: denies users without a space role on an unrestricted page | |
| SEED-AC13 | committed list | canaries.json | equals generator output | SEED-AC13 (list): canaries.json matches the generator | |
| SEED-AC13 | against PageAccessService | each canary page | deniedUsers equal actual denials | n/a: e2e only, "SEED-AC13: the users denied" by PageAccessService | |
| SEED-AC14 | contradictions | issues list | 3 pairs, verbatim values | SEED-AC14: has 3 contradiction pairs with verbatim values on existing pages | |
| SEED-AC15 | writer and reader | issues list and matrices | one unrestricted pair | SEED-AC15: a pair has both pages unrestricted in a space with a writer and a reader | |
| SEED-AC16 | outdated pages | issues list | 2 pages, verbatim | SEED-AC16: has 2 outdated pages with verbatim statements | |
| SEED-AC17 | content derivation | page markdown | content, text, ydoc | SEED-AC17: derives content, text content and ydoc from the page markdown | |
| SEED-AC17 | empty text | every page | text content, distinct slug | SEED-AC17: every page has text content and a distinct slug id | |
| SEED-AC17 | first paragraph | markdown bodies | paragraph first, no H1 | SEED-AC17: bodies start with a paragraph and have no H1 | |
| SEED-AC17 | error path insert | page insert throws | error propagates | SEED-AC17: propagates a failing page insert | |
| SEED-AC17 | error path storage | upload throws | fails, nothing attached | SEED-AC17: fails and attaches nothing when the storage upload fails | |
| SEED-AC17 | reload twice | every page via onLoadDocument | title and first paragraph, unchanged | n/a: e2e only, "SEED-AC17: every page loads twice with its title and first paragraph and stays unchanged" | |
| SEED-AC18 | unique word search | 3 unique words as GF | page in results | n/a: e2e only, "SEED-AC18: GF finds the one page containing" | |
| SEED-AC19 | 9 PDFs generated | manifest | 9 files | SEED-AC19: generates exactly the 9 PDFs named in the page manifest | |
| SEED-AC19 | duplicates | attachments | 9 unique on existing pages | SEED-AC19: 9 unique PDFs are attached to existing pages | |
| SEED-AC19 | kinds | documents section | 6 contracts, 2 minutes, 1 scan | SEED-AC19: PDF kinds and placement match the documents section | |
| SEED-AC19 | stored and attached | seeding | stored, application/pdf | SEED-AC19: stores each PDF and attaches it to its named page as application/pdf | |
| SEED-AC19 | node in content | seeding | attachment node | SEED-AC19: embeds an attachment node for the PDF in the page content | |
| SEED-AC19 | in DB and storage | seeded DB | 9 rows, files with size | n/a: e2e only, "SEED-AC19: exactly 9 PDFs hang on their named pages and are stored with their size" | |
| SEED-AC20 | limits | 9 PDFs | at most 5 pages, 1 MB | SEED-AC20: every PDF has at most 5 pages and at most 1 MB | |
| SEED-AC21 | quotes verbatim | ground truth | quote on stated page | SEED-AC21: every field quote occurs verbatim on its PDF page | |
| SEED-AC22 | missing field | ground truth | only renewal of one contract | SEED-AC22: only the renewal-less contract has a missing field, and it is renewal | |
| SEED-AC23 | forbidden terms | renewal-less contract | none of the three terms | SEED-AC23: the renewal-less contract contains none of the renewal terms | |
| SEED-AC24 | empty text layer | scanned PDF | whitespace only | SEED-AC24: the scanned contract has no text layer and yields only whitespace | |
| SEED-AC25 | determinism | two generations | identical text | SEED-AC25: generating twice yields identical extracted text per PDF | |
| SEED-AC25 | drift | committed outputs | equal fresh generation | SEED-AC25: the committed ground truth, canary list and PDF text equal a fresh generation | |
| SEED-AC26 | summary format | counts | exact line | SEED-AC26: prints the one-line summary | |
| SEED-AC26 | built command | empty DB, `seed-main.js` | last line is the summary | n/a: e2e only, "SEED-AC26: the built rebuild command ends with the summary line" | |
| SEED-AC27 | parents and order | manifest | children nested, siblings ordered | SEED-AC27: nests child pages under their parent and orders siblings by position | |
| SEED-AC27 | rebuild over changes | added page, changed membership | equals fresh seed | n/a: e2e only, "SEED-AC27: a rebuild removes an added page and a changed membership and equals a fresh seed" | |
| SEED-AC28 | migrations kept, ai emptied | migrated DB with ai rows | records kept, schemas empty | n/a: e2e only, "SEED-AC28: the reset keeps the migration records in public and ai and empties both schemas" | |
| SEED-AC28 | only own storage folders | other folders in storage | only workspace folders removed | n/a: e2e only, "SEED-AC28: the reset removes only the stored folders of existing workspaces" | |
| SEED-AC28 | error path storage delete | delete fails | DB and workspace ids kept | n/a: e2e only, "SEED-AC28: a failed storage delete leaves the database and the workspace ids for the next run" | |
| SEED-AC29 | local hosts | localhost, 127.0.0.1, ::1 | local | SEED-AC29: treats 127.0.0.1 as a local database host | |
| SEED-AC29 | non-local host | db.internal | refused | SEED-AC29: refuses the non-local database host db.internal | |
| SEED-AC29 | non-local IP | 10.0.0.5 | refused | SEED-AC29: refuses the non-local database host 10.0.0.5 | |
| SEED-AC29 | before connecting | non-local URL | no connection | SEED-AC29: refuses a non-local database before connecting | |
| SEED-AC29 | invalid input | URL without host | "DATABASE_URL has no host" | SEED-AC29: a DATABASE_URL without a host fails with "DATABASE_URL has no host" | |
| SEED-AC29 | command level | 0.0.0.0 without flag | exit 1, no data changed | n/a: e2e only, "SEED-AC29: the command refuses the non-local host 0.0.0.0 without the flag and changes no data" | |
| SEED-AC30 | s3 and azure | STORAGE_DRIVER s3, azure | refused | SEED-AC30: refuses the storage driver azure | |
| SEED-AC30 | empty driver | STORAGE_DRIVER "" | local | SEED-AC30: treats storage driver "" as local | |
| SEED-AC30 | command level | s3 without flag | exit 1, no data changed | n/a: e2e only, "SEED-AC30: the command refuses non-local storage without the flag and changes no data" | |
| SEED-AC31 | flag allows host | non-local DB with flag | passes | SEED-AC31: the confirmation flag lets a non-local database pass | |
| SEED-AC31 | flag parsing | argv and env | flag and env read | SEED-AC31: reads the confirmation flag and the environment | |
| SEED-AC31 | invalid input with flag | empty URL with flag | still refused | SEED-AC31: the confirmation flag does not skip the check of DATABASE_URL "" | |
| SEED-AC31 | seeds non-local host | 0.0.0.0 with flag | exit 0, AC1 holds | n/a: e2e only, "SEED-AC31: the command seeds the non-local host 0.0.0.0 with --confirm-non-local" | |
| SEED-AC31 | pnpm seed passes flag | `pnpm seed --confirm-non-local` | flag reaches entry | n/a: e2e only, "SEED-AC31: pnpm seed passes --confirm-non-local through to the rebuild entry" | |
| SEED-AC32 | host in message | unreachable DB | message names host | SEED-AC32: rejects with a message naming the database host | |
| SEED-AC32 | no secret in message | URL with password | password not printed | SEED-AC32: does not print the database password | |
| SEED-AC32 | command level | localhost:1 | exit 1, host named | n/a: e2e only, "SEED-AC32: the command names the host of an unreachable database" | |
| SEED-AC33 | pending migrations | DB without migrations | "Apply the migrations first" | n/a: e2e only, "SEED-AC33: the command refuses a database without migrations" | |
| SEED-AC34 | concurrent run | lock held | "Another rebuild is running", nothing changed | n/a: e2e only, "SEED-AC34: a held lock fails with \"Another rebuild is running\" and changes nothing" | |
| SEED-AC34 | lock release | after release | lock free | n/a: e2e only, "SEED-AC34: the lock is held until release and free afterwards" | |
| SEED-AC35 | offline | no AI settings | exit 0, loopback only | n/a: e2e only, "SEED-AC35: the rebuild runs without AI settings and connects only to loopback hosts" | |
| SEED-AC36 | confirmed s3 and azure | non-local storage with flag | refused | SEED-AC36: a confirmed run with the storage driver azure fails because its files cannot be removed | |
| SEED-AC36 | before connecting | confirmed non-local storage | no connection | SEED-AC36: a confirmed run with non-local storage fails before connecting | |
| SEED-AC36 | command level | s3 with flag | exit 1, no data changed | n/a: e2e only, "SEED-AC36: the command refuses non-local storage with the flag, because its files cannot be removed" | |
