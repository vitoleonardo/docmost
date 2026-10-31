# Seed data

ID prefix: SEED

## Goal
A developer, CI and the demo video need one fictional German company in the wiki, with users, spaces, permissions, pages and PDFs whose content and access are known in advance. Every later feature (ask, leak tests, extraction, agent, evals) tests against this known data. One command builds it from nothing.

## User flow
1. The developer starts the database, Redis and file storage, applies the migrations and stops the app server.
2. The developer runs the rebuild command. It removes all wiki data and stored files, keeps the schema and the record of applied migrations, creates the seed data and prints one summary line.
3. The developer logs in as any seed user with that user's email and the demo password documented in the runbook, and sees the spaces and pages the matrices below grant.
4. If the database is not local, the command stops before changing anything and says why, unless the developer confirms explicitly. If the file storage is not local, it always stops before changing anything.
5. CI runs the same command on its fresh local service database before the tests.

### Company
Ostmooimooi Anlagenbau GmbH, a fictional German plant builder. Page and PDF content is in German.

### Users
| Key | Name | Role in the company | Workspace role | Email |
|---|---|---|---|---|
| GF | Jörg Ostmoor | Geschäftsführer | owner | `joerg.ostmoor@ostmooimooi.example.com` |
| PL | Sabine Kettler | Projektleiterin | member | `sabine.kettler@ostmooimooi.example.com` |
| VT | Tobias Renner | Vertriebler | member | `tobias.renner@ostmooimooi.example.com` |
| WS | Lukas Brehm | Werkstudent | member | `lukas.brehm@ostmooimooi.example.com` |

Groups:
- The workspace's default group holds all 4 users and is a member of no space.
- "Projektteam" holds WS.

### Space matrix
`-` means no membership. The space role decides view and edit for pages without their own restriction.

| User | Allgemein | HR | Vertrieb | Projekte | IT | Geschäftsführung |
|---|---|---|---|---|---|---|
| GF | admin | admin | admin | admin | admin | admin |
| PL | writer | reader | - | admin | reader | - |
| VT | writer | - | writer | reader | - | - |
| WS | reader | - | - | writer (via group Projektteam) | reader | - |

Visibility: Allgemein is open; all other spaces are private.

### Page matrix
Restricted pages. Only the grants listed here apply; a space role does not grant access to a restricted page, also not for space admins.

| Page | Space | Parent | Can view and edit | Can view only |
|---|---|---|---|---|
| Umstrukturierung 2027 | Allgemein | – | GF | – |
| Angebot Kalkulation Kläranlage Nordhafen | Projekte | – | GF, PL | – |
| Baustelle Nordhafen intern | Projekte | – | GF, PL | group Projektteam (WS) |
| Baustelle Nordhafen Zugangscodes | Projekte | Baustelle Nordhafen intern | inherited | inherited |

### Documents
- 6 contracts and 2 meeting minutes as PDFs with a text layer, plus 1 scanned contract without a text layer.
- Every PDF is attached to one named page in the space it belongs to. At least one contract is attached to a page in Geschäftsführung.
- Ground truth for the 7 contracts: the fields parties, term, notice period, value and renewal, each with a verbatim source quote and its PDF page number, or marked missing.

### Machine-readable lists
The seed data comes with three lists that later features read. Each refers to pages by space and title.
- Canary list: every canary string with its page and the seed users who cannot view that page.
- Issues list: deliberate contradictions and outdated pages.
- Ground truth for the contracts.

## Acceptance criteria
- **SEED-AC1**: Given an empty local database with all migrations applied, when the developer runs the rebuild command, then it exits with status 0 and the database holds exactly 1 workspace named "Ostmooimooi Anlagenbau GmbH", 4 users, 2 groups and the 6 spaces listed above, and no other users, groups or spaces.
- **SEED-AC2**: Given the seeded workspace, when each of the 4 users logs in with the email from the users table and the demo password documented in the runbook, then the login succeeds without a password-change, verification or setup step.
- **SEED-AC3**: Given the seeded workspace, when each user lists their spaces, then the list contains exactly the spaces the space matrix marks for that user, each with the role shown there.
- **SEED-AC4**: Given the seeded workspace, when the Projekte space members are listed, then WS appears only as a member of the group "Projektteam" and has no direct membership.
- **SEED-AC5**: Given the seeded workspace, when the memberships of the default group are listed, then it has no space membership.
- **SEED-AC6**: Given the seeded workspace, when each user requests to view each restricted page, then view is granted exactly to the users the page matrix names for that page, directly, through a group or by inheritance, and denied to every other user.
- **SEED-AC7**: Given the seeded workspace, when each user requests to edit each restricted page, then edit is granted exactly to the users in the page matrix's "Can view and edit" column for that page or its parent, and denied to every other user, including WS on the two Nordhafen pages.
- **SEED-AC8**: Given the seeded workspace, when the pages are counted, then there are at least 28 and at most 34 pages across the 6 spaces, and every space has at least 3 pages.
- **SEED-AC9**: Given the seeded workspace, when the page titles are listed, then every title occurs once in the workspace.
- **SEED-AC10**: Given the seeded workspace, when the pages with 2 or more headings are counted, then there are at least 10.
- **SEED-AC11**: Given the seeded workspace, when the content of each restricted page and each page in Geschäftsführung is read, then it contains exactly one canary string of the form `CANARY-` followed by 8 uppercase hexadecimal characters.
- **SEED-AC12**: Given the seed data, when every page, PDF and ground-truth record is searched for each canary string, then the canary occurs only in its own page and in PDFs attached to that page.
- **SEED-AC13**: Given the seed data, when the canary list is read, then it names every canary from SEED-AC11 with its page and exactly the seed users who cannot view that page according to the matrices.
- **SEED-AC14**: Given the seed data, when the issues list is read, then it names at least 3 contradiction pairs, each with the contested fact, the outdated value and the current value, and each value occurs verbatim in its page.
- **SEED-AC15**: Given the issues list, when its contradiction pairs are checked against the matrices, then at least one pair has both pages unrestricted in a space where one non-owner user is writer and another is reader.
- **SEED-AC16**: Given the seed data, when the issues list is read, then it names at least 2 outdated pages, each with the outdated statement, which occurs verbatim in its page.
- **SEED-AC17**: Given the seeded workspace, when a user with access opens any seeded page in the editor and reloads it, then the page shows its seeded title and first paragraph both times and the stored content is unchanged.
- **SEED-AC18**: Given the seeded workspace, when GF searches the wiki for a word that occurs in exactly one seeded page, then that page is in the results.
- **SEED-AC19**: Given the seeded workspace, when the attachments are listed, then there are exactly 9 PDFs, each attached to the page the seed data names: 6 contracts and 2 meeting minutes with a text layer, and 1 contract without a text layer.
- **SEED-AC20**: Given the seeded workspace, when the PDFs are measured, then each has at most 5 pages and at most 1 MB.
- **SEED-AC21**: Given the ground truth of the 6 text contracts, when each field's source quote is compared with the extracted text of the PDF page it names, then every quote occurs verbatim on that page.
- **SEED-AC22**: Given the ground truth, when the contract without a renewal clause is read, then its renewal field is marked missing and has no quote, and it is the only text contract with a missing field.
- **SEED-AC23**: Given the contract without a renewal clause, when its extracted text is searched, then it contains none of the strings "Verlängerung", "verlängert", "Laufzeitende".
- **SEED-AC24**: Given the ground truth, when the record of the contract without a text layer is read, then it is marked as having no text layer, and extracting text from that PDF yields no characters other than whitespace.
- **SEED-AC25**: Given unchanged ground truth, when the PDFs are generated twice, then the extracted text of each PDF is identical in both runs.
- **SEED-AC26**: Given an empty local database, when the rebuild command finishes, then its last output line is "Seeded: 1 workspace, 4 users, 2 groups, 6 spaces, <n> pages, 9 attachments" with `<n>` the page count.

## Edge cases
- **SEED-AC27**: Given a seeded workspace to which a user has added a page and changed a membership, when the rebuild command runs again, then the result matches a rebuild from an empty database: same counts, same titles in the same spaces under the same parents, same matrices, same canary strings, and the added page is gone.
- **SEED-AC28**: Given the migrations of all services applied, when the rebuild command runs, then afterwards every migration is still recorded as applied and no rows remain in the AI schema.
- **SEED-AC29**: Given a database whose host is not `localhost`, `127.0.0.1` or `::1`, when the rebuild command runs without explicit confirmation, then it exits with a non-zero status, prints "Refusing to reset non-local database <host>" and changes no data.
- **SEED-AC30**: Given file storage that is not the local disk, when the rebuild command runs without explicit confirmation, then it exits with a non-zero status, prints "Refusing to reset non-local storage" and changes no data.
- **SEED-AC31**: Given a non-local database and explicit confirmation, when the rebuild command runs, then it exits with status 0 and SEED-AC1 holds for that database.
- **SEED-AC32**: Given an unreachable database, when the rebuild command runs, then it exits with a non-zero status and prints a message naming the database host.
- **SEED-AC33**: Given a database without the migrations applied, when the rebuild command runs, then it exits with a non-zero status and prints "Apply the migrations first".
- **SEED-AC34**: Given a rebuild that is running, when a second rebuild starts, then the second exits with a non-zero status, prints "Another rebuild is running" and changes no data.
- **SEED-AC35**: Given no AI service, no model runtime and no internet access, when the rebuild command runs against an empty local database, then it exits with status 0.
- **SEED-AC36**: Given file storage that is not the local disk and explicit confirmation, when the rebuild command runs, then it exits with a non-zero status, prints "Refusing to reset non-local storage" and changes no data.

## Out of scope
- Any AI data: index, embeddings, extraction results. Later features build those from the seed.
- Golden questions and eval cases (M10); canary prompt phrasings and prompt-injection pages (M6 fixtures).
- Ground truth for the meeting minutes; the minutes schema is a Should item.
- Pages in the trash and moved pages; M3 and M6 create those in their own tests.
- Running the rebuild while the app server or collaboration server runs; the runbook says to stop them first.
- Workspace admins other than the owner.
- Comments, page history, non-PDF attachments, more than one workspace.
- The page-restriction management UI (enterprise code); restrictions are written directly.
- Rebuilding on S3 or Azure file storage; it comes later.

## Decisions
- 28.10.2026: company "Ostmooimooi Anlagenbau GmbH", because web searches and the Handelsregister (checked by the user) found no company of that name and "Rheinwerk" is taken.
- 28.10.2026: the rebuild removes all wiki data, AI-schema rows and stored files but keeps the schema and migration records, because self-hosted Docmost allows one workspace, the seed must be reproducible and CI applies all migrations before seeding.
- 28.10.2026: one shared, obviously fake demo password for all seed users, documented in the runbook, because the data is fictional and runs locally only.
- 28.10.2026: emails on `example.com`, because RFC 2606 reserves it.
- 28.10.2026: Docmost's default group stays but has no space membership, and Allgemein replaces the default space, because the default group otherwise makes every user a writer in an extra space and breaks the space matrix.
- 28.10.2026: 6 contracts, 2 minutes and 1 scanned contract; one contract lacks a renewal clause, because M7 needs a missing-field case and a refusal case.
- 28.10.2026: only Allgemein is open, because open spaces let any member join, which would undo the space matrix.
- 28.10.2026: canaries go into restricted pages and all Geschäftsführung pages, because those are the pages most users cannot view and M6 checks answers for them.
- 28.10.2026: a restricted page granted through a group with a restricted child page, because M3's filter must cover group grants and inheritance, and the other grants go only to space admins.
- 28.10.2026: pages are identified by unique titles, because database ids change on every rebuild and the lists and golden set must stay valid.
- 28.10.2026: non-local file storage is refused even with confirmation (SEED-AC36), because the S3 and Azure drivers cannot delete a folder, so a confirmed run would wipe the database and leave the old files behind.
- 28.10.2026: the user approved SEED-AC36; the rebuild supports local file storage only, S3 and Azure come later.
