# Feature Specification: Account model, roles and their rights

**Feature Branch**: `079-account-model`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-79 Set up the account model, the four roles and their rights (Notion story ST-79, epic Foundations EP-1). Build what the story's Build brief says, per the epic's Build plan: one account with several roles (decision ST-78: driver + garage on one account, role used last opens), roles driver, garage owner, mechanic, optional receptionist per garage, admin. Call an AuditPort interface (no-op for now) that ST-390 will implement."

**Sources**: Notion story ST-79 (https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f), read 2026-10-04 with discussions (none open); its Build brief wins over the criteria above it. Epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), Build plan slice 1. Sibling ST-82 (sign-in, https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908) read for the boundary: it issues the tokens this story checks.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One account, several roles, stored once (Priority: P1)

Every later feature needs to know who a person is. An account holds name, e-mail, phone, city, language, status, the role used last and the time it was last active; it holds one or more roles (driver, garage, receptionist, mechanic, admin) and one or more sign-in identities. A garage owner and a receptionist are linked to their garage; a mechanic belongs to one garage with three permissions that start switched off.

**Why this priority**: sign-in, sign-up, invites, the audit history and every dashboard read these records; nothing else in the Accounts feature can start without them.

**Independent Test**: create an account through the account use case and read back the account, its roles and its identity; the audit port and the event port were each called once inside the same transaction.

**Acceptance Scenarios**:

1. **Given** a person signs up, **When** the account is stored, **Then** the account holds name, e-mail, language `ro` or `en`, status `active`, last role `driver`, and there is exactly one role row `driver`.
2. **Given** an account is created, **When** the transaction commits, **Then** the `account.created` event (account id, roles, sign-in method) and an audit entry for the role added were handed to their ports inside that same transaction; **When** either port fails, **Then** no account row remains.
3. **Given** an account already owns a garage, **When** a second owner link is made for it, **Then** the store refuses it.
4. **Given** a mechanic link, **When** it is created without permissions, **Then** `can_move_bookings`, `can_answer_quotes` and `can_record_final_price` are all false.

---

### User Story 2 - Every call runs as an actor, and the rights decide (Priority: P1)

Each API call that needs an account carries an actor: the account id, the role in use, the garage id for the garage roles and the mechanic's permissions. One policy, driven by one capabilities table, decides what the actor may do and whether the resource is theirs. What an actor may not see does not exist for them: a missing right or another owner's resource answers 404, never 403. Only a suspended account is told so (403), and that check comes before any right is checked.

**Why this priority**: trust is enforced on the server (constitution V); every later endpoint relies on this check.

**Independent Test**: call a protected endpoint without a token, with a token of each role, and with another owner's resource id; read the status and the problem `code`.

**Acceptance Scenarios**:

1. **Given** no token, **When** a protected call is made, **Then** the answer is 401 with code `sign_in_required`.
2. **Given** an account with status `suspended`, **When** it calls with a valid token, **Then** it is refused with code `account_suspended`.
3. **Given** driver Andrei, **When** he asks for driver Elena's resource by its id, **Then** the answer is 404, not 403.
4. **Given** a driver, **When** they call any garage or admin capability, **Then** the answer is 404.
5. **Given** a receptionist of Atelier Dinamo, **When** they call settings, prices or team, **Then** the answer is 404.
6. **Given** a mechanic of Atelier Dinamo, **When** they call team, settings, prices or feature switches, **Then** the answer is 404; what their permissions allow is open to them only when the permission is on.
7. **Given** a mechanic, **When** a response describes a customer, **Then** it carries the first name and the car and never a phone field; the plate only on their own jobs. A receptionist gets the phone and the plate.
8. **Given** Mihai holds `driver` and `garage` and used the garage role last, **When** he asks who he is, **Then** the role in use is `garage` and his landing is `/app/garage`.

---

### User Story 3 - Each role lands on the empty frame of its own dashboard (Priority: P2)

A signed-in person opens the frame of their dashboard: header, menu and "Ieși din cont" (Sign out) at the bottom of the menu. The frame shows a plain empty state until its epic fills it. A person cannot reach another role's area by typing its address.

**Why this priority**: the frames are what ST-82 lands people on; the guards keep each area closed before its code downloads.

**Independent Test**: with the "who am I" answer of each role, open each dashboard address and read where the browser ends and what the frame shows.

**Acceptance Scenarios**:

1. **Given** a driver, **When** they type `/app/garage` or `/app/admin`, **Then** they end on `/app/driver` and the other area's code is not downloaded.
2. **Given** a mechanic or a receptionist, **When** they open the app, **Then** `/app/garage` opens; a receptionist's menu shows no settings, prices or team, and a mechanic's menu shows only their own jobs.
3. **Given** an admin, **When** they open the app, **Then** `/app/admin` opens.
4. **Given** any dashboard, **When** it renders, **Then** there are no "Vezi ca" buttons, and "Ieși din cont" is at the bottom of the menu.
5. **Given** nobody is signed in, **When** a dashboard address is typed, **Then** the person ends on Home.

---

### Edge Cases

- An account holding no role at all cannot exist: creating one without a role is refused.
- `last_role` names a role the account no longer holds: the role in use falls back to the first held role in the order admin, garage, receptionist, mechanic, driver.
- A token signed with another key, malformed, or expired: 401 `sign_in_required`, the same as no token.
- A token for an account that was deleted (status `deleted`) or no longer exists: 401 `sign_in_required`.
- An e-mail differing only by letter case or surrounding spaces is the same e-mail: stored trimmed and lower-case, unique.
- A role granted twice: the second grant changes nothing and writes no audit entry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST store an account with id, e-mail (unique, trimmed, lower-case, optional), e-mail verified time, phone (unique, optional), phone verified time, name, city (optional), language (`ro` default, or `en`), status (`active` default, `suspended`, `deleted`), last role, last active time and creation time.
- **FR-002**: The system MUST store an account's roles as rows of (account, role) with role ∈ `driver`, `garage`, `receptionist`, `mechanic`, `admin`, one row per pair.
- **FR-003**: The system MUST store an account's sign-in identities as (account, method ∈ `password`, `google`, `apple`, `whatsapp_phone`, subject, an argon2id password hash for `password`, written by the sign-up and sign-in stories), unique per (method, subject).
- **FR-004**: The system MUST store refresh tokens as (account, token hash, family id, expiry, used time) for the sign-in story to issue and rotate.
- **FR-005**: The system MUST store a minimal garage (id, name, unique slug, status), a garage membership (garage, account, role ∈ `owner`, `receptionist`, joined time) unique per (account, membership role) — so an account owns at most one garage and is receptionist at at most one — and a mechanic link (garage, account unique, and the three permissions defaulting to false).
- **FR-006**: Creating an account MUST write the account, its roles and its identity, hand `account.created` (account id, roles, method) to the event port and one audit entry per role added (actor = the new account itself) to the audit port, all inside one transaction that rolls back whole if any step fails; an account with no role is refused.
- **FR-007**: Granting a role to an existing account MUST add the role row and hand an audit entry (actor, account, role, old and new value) to the audit port in the caller's transaction; granting a held role changes nothing.
- **FR-008**: The audit port and the event port MUST each be an interface that takes the open transaction, with a no-op implementation bound by default, so the audit history writer and the outbox replace the binding without touching the account code.
- **FR-009**: No public endpoint MUST be able to create an account with, or grant, `admin`, `garage`, `mechanic` or `receptionist`. This story ships one endpoint ("who am I", FR-016); the rule is enforced by the account use cases, whose callers pass the role from server code, and tested against the use cases and the API's route list.
- **FR-010**: The capabilities of each role MUST be one table on the server, with a test for every "may not" (every role × capability not granted). It holds the capabilities this epic's frames and scenarios name, read from the Security page's "Capabilities by role": driver — `driver.requests`, `driver.cars`, `driver.reviews`, `driver.saved_garages`, `driver.settings`; garage side — `garage.requests` (owner, receptionist; mechanic with `can_answer_quotes`), `garage.schedule` (owner, receptionist; mechanic with `can_move_bookings`), `garage.final_price` (owner, receptionist; mechanic with `can_record_final_price`), `garage.own_jobs` (owner, receptionist, mechanic), `garage.reviews`, `garage.team`, `garage.prices`, `garage.profile`, `garage.feature_switches` (owner only); admin — `admin.garages`, `admin.users`, `admin.reviews`, `admin.catalogue`, `admin.settings`. Later epics add rows. The web app gets the actor's capabilities through "who am I", never a copy of the table.
- **FR-011**: Every protected call MUST resolve an actor (account id, role in use, garage id for garage-side roles, mechanic permissions) from a bearer access token; without a valid token it MUST answer 401 `sign_in_required`; for a suspended account it MUST answer 403 `account_suspended`, before any right is checked. The garage id comes from the membership (or mechanic link) matching the role in use; when none exists it is empty and every garage capability answers 404.
- **FR-012**: The role in use MUST be the role the access token carries when the account still holds it (the token is issued for the last role at sign-in, and for the new role at a role switch), otherwise the account's last role when held, otherwise the first held role in the order admin, garage, receptionist, mechanic, driver; the fallback is computed per call, never written back.
- **FR-013**: The policy MUST answer 404 when the actor's role lacks the capability or the resource belongs to another account or garage; it MUST be callable from use cases, not only from controllers.
- **FR-014**: A mechanic capability that depends on a permission (`can_move_bookings`, `can_answer_quotes`, `can_record_final_price`) MUST be allowed only when that permission is on.
- **FR-015**: A customer described to a mechanic MUST carry the first name and the car, the plate only on the mechanic's own jobs, and never a phone field; described to a receptionist or owner it MAY carry the phone and the plate (the conditions "quote accepted" and "car in the workshop" are applied by the epics that own quotes and jobs). No job exists yet, so this is one function that takes "is it the mechanic's own job" as an input; the first epic with jobs supplies it.
- **FR-016**: The API MUST answer "who am I" for the actor: account id, name, e-mail, language, roles, role in use, garage id, the capabilities of the role in use, and the landing address (`/app/driver`, `/app/garage` for garage, receptionist and mechanic, `/app/admin`).
- **FR-017**: The web app MUST route `/app/driver`, `/app/garage` and `/app/admin` to the empty frame of that dashboard (header, menu, "Ieși din cont" at the bottom of the menu, a plain empty state), with a guard that sends a person to their own landing before another area's code downloads, and to Home (`/`) when nobody is signed in.
- **FR-018**: The frame's menu MUST show only the entries the role in use may open according to the capabilities table; there MUST be no "Vezi ca" demo buttons.

### Key Entities

- **Account**: one person; holds contact data, language, status, the role used last.
- **Account role**: one role an account holds.
- **Account identity**: one way an account signs in.
- **Refresh token**: one rotating session credential; issued by the sign-in story.
- **Garage**: minimal row so accounts can be linked; extended by the garages module in EP-2.
- **Garage member**: an account's owner or receptionist link to a garage.
- **Mechanic**: an account's link to the one garage they work at, with three permissions.
- **Actor**: who is calling: account, role in use, garage, permissions.
- **Capability**: a named right; the table maps each role to the capabilities it has.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every "may not" in the capabilities table for driver, garage, receptionist, mechanic and admin has a passing test (count of tests ≥ count of "may not" cells).
- **SC-002**: 0 protected calls answer 403 for another owner's resource or a missing right; all answer 404 (checked by the API tests). 403 is reserved for `account_suspended`.
- **SC-003**: A person of each of the five roles lands on their own frame in 1 step from opening the app, and a driver typing another area's address ends on their own frame in 5 of 5 tries (end-to-end).
- **SC-004**: An account write whose audit or event step fails leaves 0 rows behind (API test).

## Clarifications

### Session 2026-10-04

- Q: Which capabilities does the table hold now, and what is a "may not"? → A: The capabilities the frames and scenarios name (FR-010), from the Security page's matrix; a "may not" is every role × capability not granted, each with a test. (autonomous, recommended by spec-challenger; context.md Constraints)
- Q: Is `account_suspended` a 403, and does "never 403" cover only missing rights and other owners' resources? → A: Yes; the suspension check runs first, so a suspended owner gets 403, not 404. (autonomous, recommended)
- Q: Is a garage membership unique per (account, membership role), and what garage does the actor carry without one? → A: Unique per (account, role); no matching membership leaves the garage empty and every garage capability answers 404. (autonomous, recommended; Principle I)
- Q: Which HTTP endpoints does this story ship, and where is "no public endpoint grants a role" tested? → A: Only "who am I"; the rule is tested against the use cases and the API's route list; sign-up is ST-80's. (autonomous, recommended)
- Q: How is the mechanic's "plate only on own jobs" testable with no jobs yet? → A: One customer-view function takes "own job" as an input; the first epic with jobs supplies it. (autonomous, recommended)
- Resolved from context.md without a question: the token carries the role in use (ST-394, "the token after a switch carries the new role") — FR-012; owner/receptionist phone and plate conditions belong to the quote and job epics — FR-015; the table lives in the existing `domain` lib, not a new `libs/auth` (AGENTS.md: a lib is created only when needed; Principle I); A34's 403 for out-of-scope calls inside one garage concerns endpoints of later stories (another mechanic's job), while the calls this story names answer 404 as its newer Build brief says.

## Assumptions

- Sign-in, sessions, sign-up, invites and the role switch are other stories (ST-82, ST-80, invites, ST-394). This story checks a bearer access token but does not issue one to people; the token format (HS256-signed, `sub` = account id, `role` = role in use, `exp`; Notion names no library or algorithm, context.md Gaps) and its signing function are defined here so ST-82 issues exactly what the guard checks. (autonomous default; ST-82 brief: 15-minute access token in memory)
- The token key is a new variable `AUTH_TOKEN_SECRET`, required by the API. (autonomous default)
- The outbox and its relay are a later story of this epic (Build plan slice 4), so `account.created` goes through an event port with a no-op binding, the same shape as the audit port. (autonomous default; constitution VI requires the event in the account's transaction)
- Garage feature switches (GARAGE_FEATURE) arrive with EP-2; until then every feature counts as on, so no check is built now. (Build brief)
- The AI assistant context (EP-16) is not modelled now; the policy is role-based, so the assistant later gets exactly its account's capabilities. (autonomous default, Principle I)
- The protected command-line script that creates admins is part of the admin account story; account creation here accepts the `admin` role from server code only. (autonomous default)
- The end-to-end test answers "who am I" with a stubbed response per role, because real sign-in arrives with ST-82; ST-82's end-to-end test signs in for real. (autonomous default)
- The audit and event port payloads follow the field names ST-390 (`record(tx, …)`: actor, actor role, action, subject type and id, field, old and new value) and ST-257 (`record(tx, …)`: kind, subject id, payload) propose, so binding the real writers changes no account code. (autonomous default; context.md Prior Art)
- Column types: ids are UUIDs, times are UTC timestamps, as the Data model's conventions show; the exact ER types could not be fetched (context.md Gaps). An e-mail is unique among accounts; account deletion (ST-129) clears personal fields, which frees the address. (autonomous default)
- The assistant context (`via_assistant`, `assistant_grant_id`) is added to the actor by EP-16 when an assistant can call the API; nothing reads it before then. (autonomous default, Principle I)
- Dashboard texts are Romanian literals until the translation story (ST-16) extracts them. (autonomous default)
