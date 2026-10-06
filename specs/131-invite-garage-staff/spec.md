# Feature Specification: Invite a mechanic or receptionist to the garage

**Feature Branch**: `131-invite-garage-staff`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ST-131 Invite a mechanic or receptionist to an account in my garage — Notion https://app.notion.com/p/3ee607bff0d281f3aa26ca1f287f6138"

**Sources**: Notion story ST-131 (https://app.notion.com/p/3ee607bff0d281f3aa26ca1f287f6138), read 2026-10-06; its Build brief (current as of 2026-10-03) wins over the criteria and notes above it. Epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). No screens are designed (Build brief › Screens: the mock has no invitation step; the mechanic dashboard is reached in the mock with the demo button "Vezi ca"). Repo: `libs/domain/prisma/schema/garages.prisma` (Garage, GarageMember, Mechanic, GarageFeature), `.specify/capabilities/accounts.md` (roles, capabilities, "who am I"), `libs/domain/src/notifications/catalogue.ts` (STAFF_INVITE, STAFF_JOINED).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The owner invites a mechanic by e-mail (Priority: P1)

Mihai owns Atelier Dinamo. From the garage dashboard he opens "Invită în echipă", types Elena's name and e-mail, keeps her as a mechanic with the three permission ticks unticked, and sends. Elena receives an e-mail with a link to join.

**Why this priority**: Without the invite nothing else in the story exists; it is the only way a mechanic account ever belongs to a garage.

**Independent Test**: Sign in as a garage owner, send an invite through the dialog, and check the stored invite and the queued e-mail.

**Acceptance Scenarios**:

1. **Given** Mihai owns Atelier Dinamo, **When** he invites "Elena Stan" at elena@example.ro as a mechanic and leaves the three ticks as they are, **Then** an invite is stored for that garage with kind `mechanic`, name, e-mail, all three permissions false, status `sent`, an expiry 7 days ahead, and a STAFF_INVITE e-mail is sent to elena@example.ro in the language of Mihai's interface.
2. **Given** Mihai ticks "can answer quote requests" before sending, **When** the invite is stored, **Then** only that permission is true.
3. **Given** Atelier Dinamo already holds an invite in status `sent` for elena@example.ro, **When** Mihai sends another to the same address, **Then** it is refused with a message saying an invitation is already open, and he is offered "Trimite din nou" instead.
4. **Given** the e-mail provider refuses the message, **When** the send fails, **Then** the invite stays `sent`, the dialog shows "Nu am putut trimite invitația" with "Copiază linkul", and the copied link works.
5. **Given** a receptionist or a mechanic of Atelier Dinamo calls the invite endpoint, **Then** the answer is 403; **Given** the owner of another garage calls it for Atelier Dinamo, **Then** the answer is 404.
6. **Given** Mihai sends an invite, **Then** the audit history holds "invite sent" with the kind and the permissions chosen, and `invite.sent` is emitted in the same transaction.

---

### User Story 2 - The invitee accepts and gets the role (Priority: P1)

Elena opens the link. The acceptance screen names the garage and the role; she creates an account or signs in, accepts, and lands on the garage dashboard as a mechanic of Atelier Dinamo. Mihai is told she joined.

**Why this priority**: Acceptance is what turns an invitation into an account that belongs to the garage, the story's user value.

**Independent Test**: Open a valid link signed out and signed in; accept; check the account's roles, the mechanic row, the invite status and the owner's notification.

**Acceptance Scenarios**:

1. **Given** Elena opens the link and has no account, **Then** she sees "Atelier Dinamo te invită să te alături echipei ca mecanic." and a line that accepting means appearing on the garage's public profile, which she can hide later; **When** she creates her account (name, e-mail, password, with the terms tick), **Then** she accepts in the same flow and lands on the garage dashboard, where "who am I" answers role in use `mechanic` and Atelier Dinamo's garage id.
2. **Given** Elena already has a MotorFix account as a driver, **When** she signs in from the link and accepts, **Then** the `mechanic` role is added to that same account, a mechanic row is created for Atelier Dinamo with on_profile true and the invite's permissions, and she can switch between driver and mechanic.
3. **Given** Elena accepts, **Then** the invite becomes `accepted`, "invite accepted" is written to the audit history, `invite.accepted` is emitted, Mihai gets STAFF_JOINED, and `garage:{garageId}` carries a live update.
4. **Given** the invite is for a receptionist, **When** the invitee accepts, **Then** the `receptionist` role is added and a garage membership with role `receptionist` is created instead of a mechanic row; no permissions are involved.
5. **Given** Elena is signed in to an account whose e-mail differs from the invited address, **When** she accepts, **Then** the role is granted to the account she is signed in to (the link is the proof, not the address).
6. **Given** Elena is already a mechanic of Service Dinamo, **When** she accepts Atelier Nord's invite, **Then** her mechanic row moves at once to Atelier Nord with the new invite's permissions and on_profile true, `mechanic.updated` is emitted, and both garages' `garage:{garageId}` channels carry a live update.

---

### User Story 3 - The owner resends or revokes, and stale links stop working (Priority: P2)

An invite that was not answered can be sent again with a fresh link, or withdrawn. Old, used and revoked links show a clear message.

**Why this priority**: Needed for the invite to be safe and recoverable, but only after sending and accepting work.

**Independent Test**: Resend and revoke invites through the API and open each old link.

**Acceptance Scenarios**:

1. **Given** an invite in status `sent`, **When** Mihai resends it, **Then** a new link is e-mailed, the old link answers `invite_invalid`, the expiry restarts at 7 days, and "invite resent" is written to the audit history.
2. **Given** an invite in status `sent`, **When** Mihai revokes it, **Then** its status is `revoked`, `invite.revoked` is emitted, "invite revoked" is audited, and the link shows "Invitația nu mai este valabilă. Cere service-ului una nouă."
3. **Given** a link older than 7 days, **When** it is opened, **Then** the invite reads as `expired`, the API answers `invite_expired`, and the same message shows.
4. **Given** a link already used to accept, **When** it is opened again, **Then** the API answers `invite_invalid` and the same message shows.
5. **Given** an invite that is `accepted`, `revoked` or `expired`, **When** Mihai resends or revokes it, **Then** the answer is 409 `invite_invalid`.

---

### User Story 4 - A garage that switched off its team cannot invite mechanics (Priority: P2)

A garage that turned off "team and mechanics" is not offered mechanic invites; receptionist invites still work.

**Why this priority**: Keeps the feature switch honest, after the main flows.

**Independent Test**: Set `team_mechanics` off for a garage and call the invite endpoint with each kind.

**Acceptance Scenarios**:

1. **Given** Atelier Dinamo has `team_mechanics` off, **When** Mihai sends a mechanic invite, **Then** the API answers 404 `feature_off`, and the dialog does not offer the mechanic kind.
2. **Given** the same garage, **When** Mihai sends a receptionist invite, **Then** it is stored and sent as usual.
3. **Given** `team_mechanics` was switched off after a mechanic invite was sent, **When** the invitee accepts, **Then** the API answers 404 `feature_off` and the invite stays `sent`.

---

### Edge Cases

- Elena opens the link signed in as the owner of Atelier Dinamo himself: accepting is refused with `invite_invalid` (an owner is not invited to his own garage).
- The invitee already holds the invited role at this garage (a receptionist invited again as receptionist): accepting marks the invite `accepted` and changes nothing else.
- A receptionist of another garage accepts a receptionist invite: refused with `invite_invalid` (an account is receptionist at at most one garage, accounts capability 079-FR-005); the owner is not told.
- An account that is `suspended` or `deleted` cannot accept (the session rules already refuse it); the invite stays `sent`.
- The e-mail is typed with capitals or spaces: it is trimmed and compared lower-case, like sign-up.
- An invite for an e-mail that already belongs to a mechanic of this same garage: refused with a message saying the person is already in the team.
- The link is opened in a language other than the owner's: the acceptance screen shows in the link's language; the e-mail was in the owner's.
- The token in the address is malformed or unknown: `invite_invalid`, same message, no hint whether an invite exists.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST store a staff invite with garage, kind (`mechanic` or `receptionist`), invitee name, e-mail (trimmed, lower-case), the three permissions (`can_move_bookings`, `can_answer_quotes`, `can_record_final_price`, all false by default and only meaningful for kind `mechanic`), the hash of a single-use token of 32 random bytes, status (`sent`, `accepted`, `revoked`; `expired` is never written: a `sent` invite past its expiry reads as `expired`), expiry (7 days from sending or resending) and creation time.
- **FR-002**: Only the owner of that garage MUST be able to send, resend or revoke its invites: a receptionist or a mechanic of the garage gets 403; the owner of another garage, or any other actor, gets 404.
- **FR-003**: Sending MUST refuse a second open invite (status `sent` and not past its expiry) for the same garage and e-mail (409), a mechanic invite for a garage whose `team_mechanics` feature is off (404 `feature_off`), an e-mail whose account already holds the invited kind at that garage (409), and the owner's own e-mail (409).
- **FR-004**: Sending and resending MUST send a STAFF_INVITE e-mail to the invited address, whether or not an account holds it, with the link `/{lang}/invite/:token` in the language of the owner's interface; the send happens within the request, and the answer says whether the e-mail went out; when it could not be sent the invite MUST stay `sent` and the answer MUST carry the link so the owner can copy it (the link is returned only then).
- **FR-005**: Resending MUST issue a new token, void the old one, and restart the expiry, for a `sent` invite whether or not it is past its expiry; revoking MUST set `revoked`. Both MUST answer 409 `invite_invalid` for an `accepted` or `revoked` invite.
- **FR-006**: Opening a link MUST answer, without a session, the garage name, the kind and the invitee name for a valid `sent` invite; `invite_expired` past the expiry; 404 `feature_off` for a mechanic invite while the garage's `team_mechanics` is off; `invite_invalid` for a revoked, used, voided, unknown or malformed token, without revealing which.
- **FR-007**: Accepting MUST require a session and a valid `sent` invite, and MUST in one transaction: grant the invite's role to the signed-in account if not held; for a mechanic, create the mechanic row (garage, account, on_profile true, the invite's permissions) or move the account's existing mechanic row to this garage with these permissions; for a receptionist, create the garage membership with role `receptionist`; set the invite `accepted`; write the audit entry; emit `invite.accepted` and, on a move, `mechanic.updated`. The answer MUST switch the session to the invited role (a new access token, as the role switch does), so the garage dashboard opens in that role.
- **FR-008**: Accepting MUST be refused with `invite_invalid` when the signed-in account owns this garage, is receptionist at another garage (receptionist invite), or when the invite's `team_mechanics` feature is off (404 `feature_off`); an account already holding the invited role at this garage completes with no change beyond the invite status.
- **FR-009**: After acceptance the system MUST notify the garage owner with STAFF_JOINED (its catalogue channels; it can be muted) and publish a live update on `garage:{garageId}` for the new garage and, on a move, the old one.
- **FR-010**: Every invite sent, resent, revoked and accepted MUST be written to the audit history with the actor and the permissions chosen, and `invite.sent`, `invite.revoked`, `invite.accepted` MUST be emitted in the same transaction as the change.
- **FR-011**: The garage dashboard frame MUST offer "Invită în echipă" to the owner only, opening a dialog with name, e-mail, kind (mechanic, offered only when `team_mechanics` is on; receptionist), the three permission ticks shown only for mechanic and unticked by default, and a send button; it MUST show the field problems before sending and the API's message after, including "Nu am putut trimite invitația" with "Copiază linkul".
- **FR-012**: The public acceptance screen at `/{lang}/invite/:token` MUST show "{garage} te invită să te alături echipei ca {rol}." and, for a mechanic, the line about appearing on the garage's public profile; signed out, it MUST offer sign-in and account creation (the existing dialogs, with the invited name and e-mail filled in) and, when the account is created from the link, accept in the same flow; signed in (including after signing in from the link), it MUST accept only on an explicit "Acceptă"; after acceptance it MUST open the garage dashboard in the account's language; an invalid or expired link MUST show "Invitația nu mai este valabilă. Cere service-ului una nouă."
- **FR-013**: Every new text MUST exist in Romanian and English, and text typed by a person (names, e-mails, garage names) MUST never be shown back as markup.
- **FR-014**: The invite endpoints MUST be REST with OpenAPI and DTOs in the contracts library, validated at the edge; the web app MUST call them through the generated client.

### Key Entities

- **Staff invite**: one garage's invitation of one person by e-mail to one role, with its permissions, token hash, status and expiry; one open (`sent`) invite per garage and e-mail.
- **Mechanic** (existing): an account's link to the one garage it works at, with its three permissions and on_profile; created or moved by acceptance.
- **Garage membership** (existing): an account's `owner` or `receptionist` row at a garage; created by acceptance of a receptionist invite.
- **Account role** (existing): `mechanic` or `receptionist` added to the accepting account.

## Clarifications

### Session 2026-10-06

- Q: The Build brief asks how long a pending move waits when the old garage's owner never reassigns the bookings. → A: No time limit (the brief's proposal), to apply when the pending move is built; the pending move is deferred from this story because no booking exists yet (see Out of scope). Autonomous default.
- Q: Does the invitee have to accept with an account holding the invited e-mail? → A: No. The link is the credential; the role goes to the account the invitee is signed in to, as Build brief scenario 4 allows an existing account of any kind. Autonomous default.
- Q: How does the invite e-mail reach a person who has no account, when notifications are addressed to accounts? → A: It is sent to the invited address directly, like the e-mail check and password reset sends; the kind stays STAFF_INVITE (e-mail, transactional, cannot be turned off). Autonomous default.

- Q: Is `expired` written to the row, and may an expired invite be resent? → A: Derived from the expiry, never written (no sweep job, Principle I); a `sent` invite past its expiry can be resent and does not block a new invite to that address; only `accepted` and `revoked` answer `invite_invalid`. Recommended by the spec challenger. Autonomous default.
- Q: Is the STAFF_INVITE e-mail sent within the request, and when is the link returned? → A: Within the request, like the e-mail check send, so a refusal can be reported; the answer carries `emailSent` and the link only when the e-mail was not sent. Autonomous default.
- Q: Does accepting switch the session to the invited role? → A: Yes, the answer carries a new access token for the invited role, as the role switch does (an existing driver would otherwise land as a driver). Autonomous default.
- Q: Does acceptance fire automatically after signing in from the link? → A: Only after creating the account from the link (scenario 3, "same flow"); after a sign-in, the person presses "Acceptă", so a role never lands on an existing account without a click. Autonomous default.
- Q: Does "already in the team" refuse any role or only the invited kind, and is the owner's own e-mail refused at send? → A: Only the invited kind (a receptionist can be invited as a mechanic), and the owner's own e-mail is refused at send with the same 409. Autonomous default.
- Q: Keep `invite_expired` distinct from `invite_invalid`? → A: Keep it (the owner can resend an expired invite); unknown and malformed tokens stay indistinguishable from revoked and used ones. Autonomous default.
- Q: Does opening a mechanic link answer `feature_off` while `team_mechanics` is off? → A: Yes, opening and accepting answer the same, shown as the invalid-link message. Autonomous default.

## Out of scope / deferred

- Invite by phone and WhatsApp (Build brief scenarios 2 and 9, the `whatsapp` feature switch, phone in E.164): there is no sign-up by phone code yet and notifications are sent only to accounts (`libs/domain/src/notifications/notifications.service.ts`, `NotifyInput.recipients` are account ids). Deferred to the story that adds WhatsApp invites; the owner can always copy the link.
- The pending move (`move_pending`, STAFF_LEAVING, `mechanic.move_pending`, bookings flagged "de realocat", Build brief scenarios 11–12): there is no booking model in `libs/domain/prisma/schema/`, so a mechanic never has future bookings and every move completes at once (scenario 10). Deferred to the first story with bookings, with the rule: a pending move waits with no time limit and the new garage's owner can revoke it.
- The Team page, mechanic cards, the invite button there, the live team list, changing permissions later, what a receptionist may do, hiding oneself from the profile and the mechanic's public page (Build brief › Out of scope).
- The limited garage dashboard for mechanics (ST-423): an accepted invitee lands on the existing garage dashboard frame.
- Sign-up by Google, Apple or phone code on the acceptance screen: the app's sign-up dialog offers e-mail and password only today (accounts capability 080-FR-009); the screen offers what the app has.

## Spec Delta

### Capability: `garage-team`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner's invite from the dialog reaches the invited address: the stored invite has the chosen kind and permissions and one STAFF_INVITE e-mail is sent to that address (API test and end-to-end test).
- **SC-002**: A person with no account goes from the link to the garage dashboard as a mechanic in one flow, and the owner's dashboard receives the live update (end-to-end test).
- **SC-003**: Every "may not" is refused: receptionist and mechanic of the garage (403), another garage's owner (404), a second open invite (409), a mechanic invite with `team_mechanics` off (404), a used, revoked, voided, expired or malformed link (`invite_invalid` / `invite_expired`), with an unknown or malformed token indistinguishable from a revoked or used one (API tests, every case).
- **SC-004**: Resend voids the old link and the new one works; revoke stops the link; a link older than 7 days reads as expired (API tests).
- **SC-005**: An existing account of any role gains the invited role and keeps its others; a mechanic of another garage moves at once with the new permissions (API tests).
- **SC-006**: Every invite sent, resent, revoked and accepted appears in the audit history with its permissions, and the matching event is in the outbox of the same transaction (API tests).
- **SC-007**: The dialog and the acceptance screen pass the review sweep at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll.

## Assumptions

- Invites go by e-mail only; invite by phone/WhatsApp is deferred: no sign-up by phone code exists and notifications are sent only to accounts (`NotifyInput.recipients` are account ids). When the e-mail is refused the invite stays `sent` and the owner gets "Nu am putut trimite invitația" with "Copiază linkul" (Build brief › States and errors). (autonomous default)
- The pending move is deferred: no booking model exists, so a move to another garage always completes at once; the brief's open question (how long a pending move waits) is answered "no time limit", applying when the pending move is built. (autonomous default)
- The invite carries no mechanic id: a mechanic row always has an account (`garages.prisma`, `accountId` required and unique), so accepting creates the row or moves the existing one. (autonomous default)
- The Team page and the live team list are out of scope (Build brief › Out of scope); accepting still publishes the live update on `garage:{garageId}` so an open dashboard refreshes. (autonomous default)
- An accepted invitee lands on the existing garage dashboard frame (ST-79's frame, `apps/web/src/app/dashboard/`), as the brief proposes until ST-423 exists. (autonomous default)
- Link validity is 7 days (Build brief, *proposed*); resend issues a new token and voids the old; one open invite per garage and e-mail; error codes `invite_invalid`, `invite_expired`, `feature_off`; `team_mechanics` off refuses mechanic invites with 404 and leaves receptionist invites unaffected. (autonomous default)
- Permissions: only the garage's owner may send, resend or revoke (403 for its receptionist or mechanic, 404 for another garage's owner, Build brief › Who can do it); accept: any signed-in person holding a valid link, an existing account gaining the role. (autonomous default)
- The invite dialog lives on the garage dashboard frame and the acceptance screen is a public page over Home, as the brief proposes; neither is designed in the mock, so they use the shared dialog and public-page shapes the app already has. (Build brief › Screens, *proposed*)
- The invite message uses the language of the owner's interface (Build brief, *proposed*); the acceptance screen follows the address's language like every public page. (autonomous default)
- STAFF_JOINED goes to the owner through the notifications service with its catalogue channels (e-mail, push, WhatsApp); only e-mail is delivered today, the others wait for their stories. (notifications capability)
- Real garages exist only after the listing form (EP-2); tests seed one with its owner, receptionist and mechanic. (Build brief › Depends on)
- Accepting keeps accounts rule 079-FR-009 intact: the role granted comes from the server's invite row, passed by server code to the account use case, never from the request body; no endpoint takes a role as input. (autonomous default)
- The three permission ticks start unticked and exist only for kind `mechanic`; a receptionist's rights come with the role. (Notion decision 2026-10-03)
