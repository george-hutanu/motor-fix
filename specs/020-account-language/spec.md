# Feature Specification: Keep my language on my account for messages

**Feature Branch**: `020-account-language`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "Notion story ST-20 'Keep my language on my account for messages' (https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117): As a driver, I want my language saved on my account, so that e-mails and other messages from MotorFix reach me in that language. API: authenticated PATCH of the account language (ro|en), persisted, returned by /me. Web: switching language while signed in saves it to the account; signed out stays local."

**Sources**: Notion story ST-20 (https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117), read 2026-10-04 with its discussions (none open); its Build brief wins over the criteria above it. Epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Already on `main`: the account's `language` column with default `ro` and `MeDto.language` (ST-79, `libs/domain/prisma/schema/auth.prisma:45`, `libs/contracts/src/me.dto.ts:16`), the RO/EN switch and the `/ro` and `/en` addresses (ST-17, ST-21, `libs/i18n/src/switch.ts`, `apps/web/src/app/addresses.ts`), and the account's language applied when the session loads (`apps/web/src/app/dashboard/session.ts:21`). Sign-in (ST-82, PR #45) is not merged: until it is, nobody is signed in in the web app outside tests.

## Clarifications

### Session 2026-10-04

- Q: Is "the language already in use" the interface's or the account's? → A: the account's saved language; a tap is sent whenever it differs from it, which is what makes the retry after a failed save reachable.
- Q: Must the web app serialize saves, and does a stale answer replace the session? → A: one save at a time; the latest choice is sent after the answer; an answer that arrives after a sign-out or another sign-in is ignored.
- Q: What counts as "signed in" in the web app, and may the switch load the session? → A: the session holds an account (`Session.current()`); the switch never loads one.
- Q: Which field does a validation error name? → A: the offending one, through the API's existing validation (the detail names it): `language` for a bad value, the unknown field's name for an extra field.
- Q: What is the audit entry's shape? → A: the existing writer's update entry on the account: field `language`, old value, new value, no separate label.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switching language while signed in saves it on my account (Priority: P1)

Andrei is signed in. He taps "EN" in the language switch. The interface turns English at once, as it does today, and his account now says English, so every message MotorFix sends him later can use it. Tapping "RO" later changes the saved language back.

**Why this priority**: it is the story. Without it the language lives only on the device, and messages sent when Andrei is not looking have nothing to go by.

**Independent Test**: sign in (a stubbed account in the web tests, a real token against the API), tap "EN", and read the account back through "who am I".

**Acceptance Scenarios**:

1. **Given** Andrei is signed in with Romanian, **When** he taps "EN", **Then** the interface is English and his account's language becomes `en`.
2. **Given** Andrei's account says `en`, **When** he taps "RO", **Then** his account's language becomes `ro`.
3. **Given** Andrei is signed in, **When** he taps the language his account already has, **Then** nothing is sent.
4. **Given** saving fails (offline, the server answers an error), **When** Andrei taps "EN", **Then** the interface still switches to English, no error is shown, and his next tap on the switch sends the choice again (tapping "EN" again included, since the account still says `ro`).

---

### User Story 2 - The account's language can be read and changed through the API (Priority: P1)

Any signed-in account, in any role, can change its own language through the API and read it back from "who am I". Only Romanian and English are accepted. Every change is written to the audit history.

**Why this priority**: the web switch and every later message read this one value; the rule that it is `ro` or `en` and belongs to its own account is enforced on the server.

**Independent Test**: call the change with and without a token, with `ro`, `en` and invalid values, then read "who am I" and the audit history.

**Acceptance Scenarios**:

1. **Given** a signed-in driver, garage owner, receptionist, mechanic or admin, **When** they change their language to `en`, **Then** the answer is their "who am I" with `language: "en"`, and a later "who am I" says `en` too.
2. **Given** no token, an invalid token or an expired one, **When** the change is called, **Then** it is refused as "sign in required" and nothing changes.
3. **Given** a signed-in account, **When** the change is called with `fr`, `RO`, an empty value, a number, or no language, **Then** it is refused as a validation error whose detail names `language`; **When** it carries an extra field beside a valid language, **Then** it is refused as a validation error whose detail names that field; in every case the saved language is unchanged.
4. **Given** an account changes its language from `ro` to `en`, **Then** the audit history has one entry on that account, an update of the field `language` from `ro` to `en`, by that account in the role it is using.
5. **Given** an account sets the language it already has, **Then** the answer is its "who am I" and no audit entry is added.
6. **Given** a suspended account, **When** it calls the change, **Then** it is refused as suspended and nothing changes.

---

### User Story 3 - A signed-out visitor's choice stays on the device (Priority: P2)

A visitor who is not signed in taps "EN". The interface turns English and the device remembers it, exactly as today. Nothing is sent to the server.

**Why this priority**: it guards the existing behaviour against the new save; a signed-out switch that called the API would fail on every public page.

**Independent Test**: with nobody signed in, tap "EN" and check that no request to the account was made and the device remembers `en`.

**Acceptance Scenarios**:

1. **Given** nobody is signed in, **When** the visitor taps "EN", **Then** the interface is English, the device remembers `en`, and no change is sent.
2. **Given** a visitor chose "EN" while signed out, **When** they then sign in to an account whose language is `ro`, **Then** the interface turns Romanian (the account wins) and the account is not changed.

### Edge Cases

- The language changes because the address changed (`/ro/…` to `/en/…`), because another tab chose it, or because the session loaded the account's language: none of these is a choice made with the switch, so none of them saves.
- Two quick taps (EN then RO): one save is on its way at a time; the last language tapped is sent after the first answer, and the account and the session both end on it.
- The person signs out while a save is on its way: the answer is ignored and the interface stays as it is.
- A save answers after the account was replaced by another sign-in: the answer is ignored.
- The switch's elements, texts and styles are unchanged by this story (only what a tap calls changes); Romanian and English both work on phones of 320 and 390 px.
- A signed-in person opens an `/en/…` address while the account says `ro`: the address sets the interface language and nothing is saved (FR-008); the account's language is applied when the session loads, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API MUST let a signed-in account change its own language with `PATCH /api/v1/me` and a body `{ "language": "ro" | "en" }`, in every role, and answer with that account's "who am I", the same shape `GET /api/v1/me` returns.
- **FR-002**: The change MUST be refused with 401 `sign_in_required` without a valid token, and with 403 `account_suspended` for a suspended account, leaving the account unchanged.
- **FR-003**: The change MUST accept only `ro` or `en`: any other value, a missing language or an extra field is refused with 400 `validation_failed` whose detail names the offending field, and nothing is saved.
- **FR-004**: The saved language MUST be the one `GET /api/v1/me` returns afterwards; an account that never chose has `ro`.
- **FR-005**: A change to a different language MUST add one audit entry on the account (an update of the field `language`, old value to new value), by the account in the role it is using, saved in the same transaction as the change; setting the same language MUST add none.
- **FR-006**: In the web app, choosing a language with the RO/EN switch while signed in (the session holds an account) MUST switch the interface at once and, when it differs from the account's language, save it on the account; one save is on its way at a time, the latest choice is sent last, and the session then holds the saved account. An answer that arrives after a sign-out or another sign-in is ignored.
- **FR-007**: In the web app, choosing a language while signed out (the session holds no account; the switch never loads one) MUST stay on the device only and send nothing.
- **FR-008**: A language that changes without the switch (the address, another tab, the account applied when the session loads) MUST NOT be saved.
- **FR-009**: A failed save MUST leave the interface in the chosen language, show no error, and be retried at the next change made with the switch.

### Key Entities

- **Account**: the signed-in person's account; its `language` (`ro` or `en`, default `ro`) is what every message to them uses.
- **Audit entry**: one line of the account's history: who changed the language, from what, to what, and when.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a signed-in switch, the account's language read back through "who am I" equals the last language tapped, in 100% of the tested roles (five).
- **SC-002**: A signed-out switch sends no request to the account, in every test that switches signed out.
- **SC-003**: Every invalid change listed in User Story 2, scenario 3, is refused and leaves the saved language unchanged.

## Assumptions

- The messages themselves (e-mail, push, SMS, WhatsApp, the bell list) and the password-reset e-mail the brief's end-to-end test uses do not exist yet; they read `ACCOUNT.language` when they are built (ST-20's "Out of scope" and the templates story). This story delivers the saved value they read. (autonomous default)
- A new account taking the interface language (brief scenario 2) is already supported by account creation (`libs/domain/src/auth/accounts.service.ts:40`, tested in `accounts.service.integration.spec.ts`); the sign-up screens that pass it belong to the sign-up stories. (autonomous default)
- At sign-in the account's language wins over the device's (brief scenario 3, proposed) — already built in the session; a save that failed earlier is therefore not retried at sign-in, only at the next change (brief "States and errors" says "next change or sign-in"; the two proposals conflict and the account-wins rule is kept). (autonomous default)
- The brief says "Emits: none", so no domain event is recorded. (from the brief)
- Other devices pick up the new language at their next sign-in; there are no live updates. (from the brief, proposed)
- Until ST-82 merges there is no real session in the web app, so the web side is tested with a stubbed "who am I". (from the task)

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005

### Capability: `i18n`

- **Adds**: FR-006, FR-007, FR-008, FR-009
