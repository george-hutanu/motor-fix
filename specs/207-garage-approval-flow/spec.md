# Feature Specification: Keep garages hidden until approved, with a status flow

**Feature Branch**: `207-garage-approval-flow`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "ST-207 Keep garages hidden until approved, with a status flow — Notion https://app.notion.com/p/3ee607bff0d2818b8b02f41b122c27f6"

**Sources**: Notion story ST-207 (https://app.notion.com/p/3ee607bff0d2818b8b02f41b122c27f6, Task, Highest, 5 points, Labels backend + data, Role System), read 2026-10-07; its Build brief (current as of 2026-10-03) wins over the criteria and notes above it, and its two decisions dated 2026-10-03 (X18: the last approved details stay public while a change or a reopened file waits; a mobile mechanic's registered seat stands in for the workshop address) are applied. Epic Garage onboarding and verification (EP-2, https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf). No screens of its own (Build brief › Screens). Repo: `libs/domain/prisma/schema/garages.prisma` (Garage with `status` text, default `draft`, and a unique `slug`; no verification file and no listing draft exist yet), `audit.prisma` and `.specify/capabilities/audit.md` (the audit writer), `events.prisma` and `.specify/capabilities/live-updates.md` (the outbox and its audiences), `.specify/capabilities/accounts.md` (roles, capabilities, 404 policy), `.specify/capabilities/platform.md` (`APP_ENV`, problem details with a stable `code`).

## Clarifications

### Session 2026-10-07

- Q: Does the public slug of a `suspended` garage answer 404 like a hidden one, or 410 as Architecture decision A34 says? → A: 410 `gone` for `suspended` (A34, 2026-10-04, the latest Notion source); 404 `not_found` for never-approved and unknown slugs.
- Q: When a second admin opens a file that is already `in_review`, is the open refused with 409? → A: No. The open succeeds without changing the file and answers who opened it first, so the caller can warn (MF-30 Final rules 15); 409 stays for a second decision.
- Q: In which environments may `skip_manual_approval` take effect? → A: Only `APP_ENV=test` (A33: the switches "exist only in test environments"); development, staging and production ignore it.
- Q: Which stories do the spec's story references mean? → A: The Notion IDs: ST-116 submits (creates the file); ST-206 is uploads and declaration, ST-208 the re-send after "more requested", ST-209 the e-mail at each status change; the change that needs a new approval is the change-flow stories, not ST-208/ST-209.
- Q: When a reopened file of an approved garage ends `rejected` or `more_requested`, does the garage stay public? → A: Yes. It stays `approved` and public; the file carries the decision and the garage is told the result (X18); hiding an approved garage is suspension (MF-59). Flagged for the owner.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A driver never meets a garage MotorFix has not approved (Priority: P1)

Atelier Dinamo has sent its listing; an admin has not yet decided. Ana, a driver, looks for a garage for her Dacia near Dinamo's address, opens the link the owner shared, and would send a quote request. She finds nothing: the garage is not in any result, its page answers "not found", and no request can reach it. The day an admin approves the file, the garage is on the map.

**Why this priority**: It is the story's reason to exist: nothing unverified reaches drivers. Every later read path (search, map, profile, routing, mechanic pages, sitemap, assistant tools) is built on this one rule.

**Independent Test**: Create a garage in each non-approved state and one approved; read them through the public scope and the public profile endpoint; only the approved one is returned, the others answer 404 (a `suspended` one 410).

**Acceptance Scenarios**:

1. **Given** a garage whose verification file is `submitted`, `in_review`, `more_requested` or `rejected`, **When** any public read asks for garages (the shared public scope) or for that garage's slug, **Then** the garage is not returned and the slug answers 404 `not_found`.
2. **Given** a garage with status `draft` and no verification file, **When** the same reads run, **Then** the garage is likewise absent and its slug answers 404; **given** a garage with status `suspended`, the garage is absent from the scope and its slug answers 410 `gone` (A34).
3. **Given** an admin's approval of a `submitted` or `in_review` file, **When** the transaction commits, **Then** the garage's status is `approved`, its `approved_at` is set, and the next public read returns it.
4. **Given** a public read, **When** it is asked whether a garage is visible, **Then** the answer comes from the database alone, never from a cached copy.

---

### User Story 2 - The garage sees where its file stands (Priority: P2)

Mihai, the owner, opens his listing's preview after sending it. He reads "Trimis · nepublicat", then "În verificare · nepublicat" once an admin opened the file, "Cerute completări" when the admin asked for more, "Respins" with the reason, or "Aprobat, pe hartă" the day it is approved. The label is the same wherever it is shown.

**Why this priority**: The owner needs to know the state of his file without asking; the stories that build the listing screens, the dashboard and the admin queue all show this one label.

**Independent Test**: Derive the status label for a garage in each state and compare with the table in Rules; no label is stored.

**Acceptance Scenarios**:

1. **Given** a garage and its latest verification file, **When** the status shown to the garage is derived, **Then** it is exactly one of: Ciornă (draft), Trimis (sent), În verificare (under review), Cerute completări (more details requested), Respins (rejected), Aprobat, pe hartă (approved, on the map), Suspendat (suspended), chosen by the rule in FR-006.
2. **Given** a `rejected` file, **When** the label is derived, **Then** it carries the rejection's reason code and note.
3. **Given** an approved garage whose newest file is `in_review` (reopened) or whose change waits for a new approval, **When** the label is derived, **Then** it is "Aprobat, pe hartă": the garage stays public with its last approved details until the new decision.

---

### User Story 3 - The file moves only along its allowed path (Priority: P2)

Two admins open the same file; the second one's decision after the first's answers "already decided by Ioana". A garage whose file was rejected corrects its listing and sends again: a new file is created, linked to the rejected one, and the garage stays hidden until that file is approved. Every move is written to the history and announced to the people who watch it.

**Why this priority**: The stories that trigger the transitions (submit, open, decide, ask for more, reopen, re-send) each call this one state machine; a wrong or silent move here spreads to all of them.

**Independent Test**: Drive the state machine through every allowed transition and every refused one against a real database; check the status, the history entries and the outbox rows after each.

**Acceptance Scenarios**:

1. **Given** a `submitted` file, **When** the first admin opens it, **Then** it becomes `in_review` with `opened_by` and `opened_at` set, and `verification.opened` is emitted; **when** a second admin then opens the `in_review` file, the open succeeds without changing the file, writing history or emitting, and answers the first admin's `opened_by` and `opened_at` so the caller can warn.
2. **Given** a `submitted` or `in_review` file, **When** an admin decides, **Then** it becomes `approved`, `more_requested` or `rejected` with `decided_by`, `decided_at` and, for `more_requested` and `rejected`, a reason code and note, and `verification.decided` is emitted; on `approved` the garage becomes `approved`.
3. **Given** a `more_requested` file, **When** the garage sends it again, **Then** it becomes `submitted` again and `verification.submitted` is emitted.
4. **Given** an `approved`, `rejected` or `more_requested` file, **When** an admin reopens it, **Then** it becomes `in_review` with `reopened_by` and `reopened_at` set, `verification.reopened` is emitted, and an approved garage stays `approved`.
5. **Given** a file already decided, **When** a second decision arrives, **Then** it is refused with 409 `verification_transition_refused`, naming the current status and who set it.
6. **Given** a `rejected` file, **When** the garage sends its listing again, **Then** a new file is created `submitted` with `previous_file_id` pointing at the rejected one, and the garage is still not public.
7. **Given** any transition, **When** it commits, **Then** one audit entry on the file (actor, role, old and new status, reason code and note when there is one), plus on an approval one audit entry on the garage's status, and one outbox row are written in the same transaction; when the transaction fails, none of them exists.

---

### User Story 4 - A test environment approves at once (Priority: P3)

In a test environment (`APP_ENV=test`) the switch `skip_manual_approval` is on. When a listing is submitted its file is approved by the system in the same transaction, so end-to-end tests and demos do not wait for an admin. In development, staging and production the switch is ignored whatever it says.

**Why this priority**: It unblocks the automated tests of every story that needs an approved garage, and the production guard keeps the shortcut out of the real flow.

**Independent Test**: Submit with the switch on under `APP_ENV=test` and see `approved` with actor `system`; submit with it on under `APP_ENV=production` and see `submitted`.

**Acceptance Scenarios**:

1. **Given** `APP_ENV` is `test` and `skip_manual_approval` is on, **When** a file is submitted, **Then** it is `submitted` then `approved` in the same transaction, decided by `system` ("MotorFix" in the history), and the garage is `approved`.
2. **Given** `APP_ENV` is `production`, `staging` or `development` and the switch is set anyway, **When** a file is submitted, **Then** it stays `submitted` and the switch is ignored.

---

### Edge Cases

- Two admins open the same `submitted` file at the same moment: exactly one moves it to `in_review`; the other finds `in_review` and its open succeeds without a change, answering the first admin so the screen can warn (MF-30 Final rules 15). Both can still work; only the second decision is refused.
- Two decisions on the same file at the same moment: exactly one commits; the other answers 409 "already decided by …".
- An approval for a garage that is already `approved` (a reopened file): the garage keeps `approved`, `approved_at` moves to this decision, and it stays public throughout.
- A rejection or "more requested" on a reopened file of an approved garage: the file carries the decision and the garage stays `approved` and public (hiding an approved garage is suspension, which belongs to MF-59); the result reaches the garage through the live channel and the notification story.
- A file reopened twice: each reopening overwrites `reopened_by` and `reopened_at`; the history keeps every one.
- A re-send while a `submitted` or `in_review` file already exists: refused with 409; only `more_requested` accepts a re-send, and only `rejected` (or no file at all) leads to a new file: a submit while the newest file is `more_requested` or `approved` is refused with 409.
- A slug that exists for a never-approved garage and a slug that exists for nobody answer the same 404, so a hidden garage cannot be told from an absent one; a `suspended` garage's slug answers 410 `gone`, because it was public and is gone (A34).
- The live event cannot be relayed: the status change has already committed; the next public read shows the right visibility because it reads the database.
- `skip_manual_approval` set to a value that is not `1` or `true`: read as off.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST store a verification file per submission with garage, status (`submitted`, `in_review`, `approved`, `more_requested`, `rejected`), `opened_by`, `opened_at`, `decided_by`, `decided_at`, `reopened_by`, `reopened_at`, `previous_file_id` (the rejected file a re-submission follows), reason code and note of the last `more_requested` or `rejected` decision, and creation time; every timestamp is stored in UTC. A garage's status MUST be one of `draft`, `approved`, `suspended`, with `approved_at` set at each approval.
- **FR-002**: The system MUST allow exactly these file transitions and refuse every other with 409 `verification_transition_refused`, whose detail names the current status and who set it ("already decided by {first name}"): `submitted` → `in_review` (an admin opens; sets `opened_by`, `opened_at`; an open of a file already `in_review` is not a transition: it succeeds unchanged, writes no history and no outbox row, and returns the current `opened_by` and `opened_at`); `submitted` or `in_review` → `approved`, `more_requested` or `rejected` (an admin decides; sets `decided_by`, `decided_at`, and the reason code and note, required for `more_requested` and `rejected`); `more_requested` → `submitted` (the garage sends again); `approved`, `rejected` or `more_requested` → `in_review` (an admin reopens the garage's newest file only; an older file, or any file while another file of the garage is `submitted`, `in_review` or `approved`, is refused with the same 409, so the one-live-file rule of FR-004 holds; sets `reopened_by`, `reopened_at`). Two concurrent transitions on one file MUST end with exactly one committed.
- **FR-003**: The garage's status MUST move `draft` → `approved` only through a file approval, in the same transaction; an approval of a reopened file keeps `approved` and resets `approved_at`; no other transition of this story changes the garage's status (`approved` ↔ `suspended` belongs to MF-59). A rejection, a "more requested" or a reopening of an approved garage's file MUST leave the garage `approved`.
- **FR-004**: Submitting MUST create a file `submitted` for a garage that has no `submitted`, `in_review` or `approved` file; when the garage's newest file is `rejected`, the new file's `previous_file_id` MUST point to it; when it is `submitted`, `in_review`, `more_requested` (the garage re-sends that file instead) or `approved` (a change goes through the change-flow stories), submitting MUST be refused with 409. This story exposes the submit transition for the submission story to call; it ships no submit endpoint.
- **FR-005**: One query scope, `publicGarages()`, MUST define public as garage status = `approved` and nothing else, reading the database and never a cache; every public read of garages (search, map, profile, request routing, mechanic public pages, the sitemap and the assistant's tools, as each is built) MUST go through it, and a test MUST fail, naming the method, when a public garage read in the domain library bypasses it. The one public read this story ships, `GET /api/v1/garages/{slug}` (marked public, joining the public-routes list), MUST answer the garage's id, name and slug through the scope; 410 `gone` for a `suspended` garage (A34); and 404 `not_found` otherwise, the same body for a never-approved and an unknown slug.
- **FR-006**: The status shown to the garage MUST be derived, never stored, as one of: Ciornă (draft) when the garage is `draft` and has no file; Trimis (sent) when the newest file is `submitted`; În verificare (under review) when it is `in_review`; Cerute completări (more details requested) when it is `more_requested`; Respins (rejected), with the reason code and note, when it is `rejected`; Aprobat, pe hartă (approved, on the map) when the garage is `approved`, whatever its newest file; Suspendat (suspended) when the garage is `suspended`. The seven labels MUST exist in Romanian and English in the shared status labels, in the forms the mock uses: "Trimis", "În verificare", "Cerute completări", "Respins", "Aprobat, pe hartă" and, for the unpublished states, the suffix "· nepublicat" (English "· not published").
- **FR-007**: The system MUST expose the list of fields whose change needs a new approval: `cui`, `address` or `seat_address` (a mobile mechanic's registered seat stands in for the workshop address), `business_kind`, and the kinds of work (the job types offered). A change of any of them on an approved garage MUST NOT change the garage's status or hide it: public reads keep showing the last approved values until an admin decides (the flow itself belongs to the change-flow stories, not to this one).
- **FR-008**: Every transition MUST write, in its own transaction, one audit entry on subject `verification_file` (or `garage` for the garage's status) with actor, actor role, old and new status, and reason code and note when there is one, and one outbox row: `verification.submitted`, `verification.opened`, `verification.decided` (with the decision), `verification.reopened`, each carrying the garage id and file id and the audiences `admin`, `garage:{garageId}`; `verification.decided` on an approval also carries `public:garage:{garageId}` and `public:search:{brandId}` for each brand the garage serves (none until a brands story exists). A failed audit or outbox write MUST fail the transition.
- **FR-009**: When `skip_manual_approval` is on (`SKIP_MANUAL_APPROVAL` read as `1` or `true`) and `APP_ENV` is `test`, submitting MUST approve the new file at once in the same transaction with actor `system` ("MotorFix"), writing the audit entries and outbox rows of both transitions; under any other `APP_ENV` (`development`, `staging`, `production`) the switch MUST be ignored and it MUST NOT be a required variable (A33).
- **FR-010**: Nobody acts on the state machine directly: this story ships no endpoint beyond FR-005's public read. Each transition is a domain use case that takes the actor (id, role, first name) from server code, for the submitting (ST-116) and re-sending (ST-208), deciding (ST-302 to ST-305) and suspending (MF-59) stories to call; the opening, deciding and reopening use cases MUST refuse an actor whose role is not `admin` or `system` with 404, as the capabilities policy does.
- **FR-011**: The DTOs of the public read and the shared status labels MUST live in the contracts library, the endpoint MUST be REST with OpenAPI, and the generated client MUST be regenerated.

### Key Entities

- **Garage**: the existing garage (id, name, unique slug, status `draft` | `approved` | `suspended`, created time) gains `approved_at`. Public when and only when `approved`.
- **Verification file**: one examination of a garage's listing by MotorFix: garage, status, who opened, decided and reopened it and when, the previous file it follows after a rejection, the reason code and note of the last negative decision. A garage has at most one file that is `submitted`, `in_review` or `approved` at a time.
- **Status label**: a derived value (FR-006) shown to the garage in Romanian or English; not stored.
- **Re-approval field list**: the names of the garage fields whose change needs a new approval (FR-007); a constant shared with the change-flow stories.

## Spec Delta

### Capability: `garage-verification` (new)

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a garage in each of the six non-public states (`draft` without a file; file `submitted`, `in_review`, `more_requested`, `rejected`; garage `suspended`) the public scope returns nothing and the slug answers 404 (410 `gone` for `suspended`); for an approved garage, both return it (API test on a real database).
- **SC-002**: Every one of the 11 allowed transitions succeeds (`submitted` → `in_review`; `submitted` or `in_review` → `approved`, `more_requested`, `rejected`; `more_requested` → `submitted`; `approved`, `rejected`, `more_requested` → `in_review`); of the other 14 ordered pairs of the five file statuses (self-pairs included), the open of an `in_review` file succeeds unchanged (FR-002) and the remaining 13 are refused with 409 naming the current status and its author (API tests on a real database).
- **SC-003**: After each committed transition exactly one audit entry on the file (plus one on the garage's status for an approval) and one outbox row exist for it; after a failed one, zero of each (API test).
- **SC-004**: An approval is visible to the next public read within the same request cycle: the read after the commit returns the garage, with no cache to expire (API test).
- **SC-005**: With `skip_manual_approval` on, a submission under `APP_ENV=test` ends `approved` by `system`, and under `APP_ENV` `production`, `staging` and `development` ends `submitted` (unit test).
- **SC-006**: The seven status labels exist in both languages and each state maps to exactly one of them (unit test over every state).

## Assumptions

- The Build brief is the scope; nothing of ST-116 (submitting, duplicate CUI), ST-206 (uploads and declaration), ST-208 (re-send after "more requested"), ST-209 (e-mail at each status change), ST-302 to ST-305 (the admin queue and decisions), ST-413 (the "another admin has it open" warning), MF-59 (suspension, monthly re-check) or the change-flow stories (the change that needs a new approval) is built here. The Playwright scenario the brief names (submit, not found, approve, found in results for its brand) needs those stories' screens and the brands search; this story covers it with API tests on a real database and the end-to-end run lands with the search story (autonomous default).
- No verification file and no listing draft exist in the repo: this story creates the verification file; the listing draft belongs to the submission story, so Ciornă (draft) is derived from a `draft` garage with no file until that story adds the draft's own status (autonomous default).
- The invite check (`POST /api/v1/invites/check`) is public and reads the inviting garage's name whatever its status: it answers a person holding the invite's secret token, not a listing, so the bypass test names it as its one exemption (autonomous default; an owner invites staff before approval).
- The one read path that exists for the rule is the new public `GET /api/v1/garages/{slug}` (id, name, slug); the profile story extends its body. Search, map, routing, mechanic pages, sitemap and assistant tools do not exist yet; the bypass test (FR-005) covers them as they arrive (autonomous default).
- `previous_file_id` is kept, as the brief proposes; the 404 for everyone else on a non-public garage is kept, as proposed (autonomous default).
- `skip_manual_approval` is read from the environment as `SKIP_MANUAL_APPROVAL` until the test-only switches story (ST-?, "the test-only switches themselves") gives it a home; it is optional and never required (autonomous default).
- 079-FR-005 (`accounts`) stores a garage "status" without naming its values, so it stays as it is; FR-001 fixes the values (`draft`, `approved`, `suspended`) in this capability (autonomous default).
- `approved_at` is reset at each approval, including one of a reopened file (autonomous default).
- A rejection or "more requested" on a reopened file leaves an approved garage approved and public: the brief gives no transition out of `approved` other than suspension; the result still reaches the garage (X18). Confirmed in Clarifications; flagged for the owner in the finish comment.
- The 409 code is `verification_transition_refused`; its detail is the human sentence from the brief ("already decided by …") built from the actor's first name as the audit writer stores it (autonomous default).
- Audience `public:search:{brandId}` is emitted only once a garage serves brands; today the payload carries an empty list (autonomous default).
- Every timestamp is stored in UTC and shown in Europe/Bucharest by the screens that show it (platform rule; no screen here).
- The reason codes of a `more_requested` or `rejected` decision come from the admin decision stories (ST-302 to ST-305); this story stores the code as given, required and non-empty, and fixes no list (autonomous default).
