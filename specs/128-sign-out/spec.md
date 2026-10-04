# Feature Specification: Sign out, on this device or on all devices

**Feature Branch**: `128-sign-out`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-128 Sign out, on this device or on all devices (Notion story https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7, epic EP-1 Foundations). \"Ieși din cont\" at the bottom of every dashboard menu ends the session on this device; \"Ieși de pe toate dispozitivele\" ends every session of the account; open tabs of that account sign out at once."

**Sources**: Notion story ST-128 (https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7), read 2026-10-04 (last edited 2026-10-04 19:23, this run's own status write); its Build brief (current as of 2026-10-03) wins over the criteria above it. Blockers on the Foundations build timeline, both Merged: ST-82 "Sign in with e-mail and password" (sessions, refresh-token families, `POST /api/v1/auth/sign-out`, "Ieși din cont" in the frame) and ST-253 "Set up the real-time connection to open dashboards" (the `account:{id}` live channel). Epic: https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707.

**Already built by ST-82** (`.specify/capabilities/accounts.md`): 082-FR-010 (`POST /api/v1/auth/sign-out` revokes the presented family, clears the cookie, answers 204 even with no or an unknown token) and 082-FR-020 ("Ieși din cont" calls it, forgets the session even when the call fails, opens Home). This story keeps both and adds the rest.

## Clarifications

### Session 2026-10-04

- Q: Where does "Ieși de pe toate dispozitivele" sit, given the Build brief proposes a row in Setări but only the driver and admin dashboards have a Setări view, and that view is a placeholder (the settings pages are another story)? → A: In the dashboard's account block, directly under "Ieși din cont", for every role; the same block is the account band on a phone. Moving it into Setări is a one-line change once the settings pages exist.
- Q: Which session identifies the account for "all devices", given the web app never sends the access token to `/api/v1/auth/*` and the refresh cookie is sent only there? → A: The refresh-token cookie, exactly as sign-out and refresh read it; the call lives at `POST /api/v1/auth/sign-out-everywhere`. A token that would not renew (missing, unknown, expired, reused outside the grace) answers 401 `sign_in_required`, clears the cookie and revokes nothing more than refresh would.
- Q: How do the other open tabs of the same browser learn of a sign-out on this device, which has no server event? → A: The tab that signs out tells the browser's other tabs on a `BroadcastChannel`; each forgets its session, closes its live connection and opens Home. "All devices" also reaches every tab of every device through the `session.revoked` live message.
- Q: What does "retried when the connection returns" mean for the web app? → A: A sign-out call that got no answer from the server (offline, network error, 5xx) is kept pending in the browser's local storage; it is sent again on the browser's `online` event and before the next session load or sign-in; any answer of 2xx or 4xx clears it. The session is forgotten locally at once either way.
- Q: What does the audit entry look like, given the audit actions are create/update/delete/open? → A: One `delete` entry on subject `account` (the account itself), actor = the account with its last role, kind `signed_out_everywhere`, written in the transaction that revokes the tokens. A single-device sign-out writes none (Build brief, Data).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign out on this device (Priority: P1)

Andrei taps "Ieși din cont" at the bottom of his dashboard menu. His session on this device ends: the refresh token is revoked, the access token is dropped from memory, the cookie is cleared and Home opens. His other open tabs in this browser sign out too. The browser's Back button does not show a dashboard.

**Why this priority**: signing out is the minimum every signed-in person needs; it is the story's first acceptance criterion.

**Independent Test**: sign in, open a second tab on the dashboard, tap "Ieși din cont" in the first; both tabs end on Home signed out; Back shows no dashboard; a refresh with the old cookie answers 401.

**Acceptance Scenarios**:

1. **Given** Andrei is signed in, **When** he taps "Ieși din cont", **Then** his refresh-token family is revoked, the access token is dropped from memory, the cookie is cleared and Home opens; Back does not show a dashboard.
2. **Given** Andrei has two tabs of the dashboard open in one browser, **When** he signs out in one, **Then** the other forgets its session, closes its live connection and opens Home.
3. **Given** the session already expired, **When** "Ieși din cont" is tapped, **Then** the local session is still cleared and Home opens.
4. **Given** the device is offline, **When** "Ieși din cont" is tapped, **Then** the local session is cleared at once and Home opens; the server revocation is sent again when the connection returns.
5. **Given** a sign-out was already done, **When** sign-out is called again, **Then** it answers 204 and changes nothing.

---

### User Story 2 - Sign out on all devices (Priority: P1)

Andrei is signed in on a phone and a laptop. On one of them he chooses "Ieși de pe toate dispozitivele" and confirms. Every session of his account ends; the open tabs on both devices sign out within a few seconds; a device that was offline asks for sign-in at its next use, at the latest when its 15-minute access token ends.

**Why this priority**: it is the story's second goal ("so that nobody else uses my account") and the only way to end a session on a lost device.

**Independent Test**: two browser contexts signed in to one account; "all devices" in one; the other ends on Home signed out; a refresh from either answers 401; the audit history holds one "signed out on all devices" entry.

**Acceptance Scenarios**:

1. **Given** Andrei is signed in, **When** he chooses "Ieși de pe toate dispozitivele", **Then** a confirmation asks "Ieși de pe toate dispozitivele? Va trebui să te autentifici din nou peste tot." with "Ieși" and "Renunță".
2. **Given** the confirmation is open, **When** he chooses "Renunță" or closes it, **Then** nothing changes and he stays signed in.
3. **Given** he confirms with "Ieși", **Then** every refresh-token family of his account is revoked, one audit entry "signed out on all devices" is written, this device signs out and opens Home, and every open dashboard of the account on any device receives `session.revoked` and opens Home signed out.
4. **Given** a device that was offline, **When** it is used again, **Then** its renewal fails and it asks for sign-in, at the latest when its 15-minute access token ends.
5. **Given** no valid refresh token is presented, **When** sign-out on all devices is called, **Then** it answers 401 `sign_in_required`, clears the cookie and revokes no other session.

---

### User Story 3 - The same for every role (Priority: P2)

A driver, a garage owner, a receptionist, a mechanic and an admin each sign out the same way, on this device and on all devices.

**Why this priority**: the frame is shared, so this mostly needs proving.

**Independent Test**: for each role, the account block of its dashboard shows both actions and each works.

**Acceptance Scenarios**:

1. **Given** a garage owner, a receptionist, a mechanic or an admin, **When** they sign out on this device or on all devices, **Then** it works as for a driver.

### Edge Cases

- A `session.revoked` message reaches a dashboard whose session already ended: it is forgotten again (no error) and Home opens.
- Several tabs receive `session.revoked` at once: each signs out once; the extra sign-out calls answer 204.
- A pending offline sign-out and a new sign-in on the same browser: the pending call is sent first, against the old cookie, so it never ends the new session.
- The page renders on the server: no broadcast channel or `online` listener is opened there.
- The live connection is down when "all devices" is confirmed elsewhere: the tab's next renewal fails (its cookie's family is gone) and it asks for sign-in, at the latest after 15 minutes.
- Redis is down when "all devices" is confirmed: the sessions are still revoked and the call answers 204; open tabs sign out at their next renewal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/sign-out-everywhere` with a refresh-token cookie that would renew MUST delete every refresh token of that account and write one audit entry (action `delete`, subject `account` = the account, actor = the account with its last role, kind `signed_out_everywhere`) in one transaction, clear the cookie and answer 204.
- **FR-002**: Sign-out on all devices with no, an unknown, an expired or a reused (outside the 20-second grace) refresh token MUST answer 401 `sign_in_required`, clear the cookie, and revoke no other family than refresh would.
- **FR-003**: After sign-out on all devices, `POST /api/v1/auth/refresh` with any refresh token the account held MUST answer 401.
- **FR-004**: After the revocation is saved, the API MUST publish a `session.revoked` live event to `account:{accountId}`; a failed publish MUST be logged and MUST NOT change the answer.
- **FR-005**: When "Ieși din cont" signs this tab out, the web app MUST tell the other tabs of the same browser, and each of them MUST forget its session, close its live connection and open Home.
- **FR-006**: Every dashboard (driver, garage — owner, receptionist, mechanic — and admin) MUST show "Ieși de pe toate dispozitivele" / "Sign out on all devices" in its account block, under "Ieși din cont".
- **FR-007**: Choosing it MUST open a confirmation dialog titled "Ieși de pe toate dispozitivele?" / "Sign out on all devices?" with the text "Va trebui să te autentifici din nou peste tot." / "You will need to sign in again everywhere." and the buttons "Ieși" / "Sign out" and "Renunță" / "Cancel"; "Renunță" or closing the dialog MUST change nothing.
- **FR-008**: Confirming MUST close the tab's live connection, forget the session in memory, call sign-out on all devices, tell the other tabs (FR-005) and open Home, also when the call fails.
- **FR-009**: On a `session.revoked` live message the dashboard MUST sign the tab out as "Ieși din cont" does and open Home.
- **FR-010**: A sign-out call (this device or all devices) that gets no answer, a network error or a 5xx MUST be kept pending in the browser and sent again on the browser's `online` event and before the next session load, sign-in or sign-up; a 2xx or 4xx answer MUST clear it.

### Key Entities

- **Refresh token** (existing, `refresh_token`): deleted for the whole account by FR-001.
- **Audit entry** (existing): one per sign-out on all devices.
- **Pending sign-out**: one browser-local record, `device` or `everywhere`, until the server has answered.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After "Ieși de pe toate dispozitivele", the other device's open dashboard is on Home signed out within 5 seconds (Build brief: "within a few seconds"; 5 s is the autonomous bound).
- **SC-002**: After either sign-out, no refresh token the browser held renews (Build brief scenarios 1 and 3).
- **SC-003**: A device that missed the live message is signed out no later than 15 minutes later (access-token lifetime, Build brief scenario 3).

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010
- **Modifies**: none
- **Removes**: none

## Assumptions

- (autonomous default) "Ieși de pe toate dispozitivele" sits in the dashboard's account block for every role, not in Setări: the Build brief's placement is *(proposed)*, only the driver and admin dashboards have a Setări view and it is a placeholder; the settings pages are out of scope (Build brief, Out of scope).
- (autonomous default) The confirmation's English texts are "Sign out on all devices?", "You will need to sign in again everywhere.", "Sign out" and "Cancel"; the Build brief gives only the Romanian.
- (autonomous default) Same-browser tabs learn of a sign-out through `BroadcastChannel` (`mf-session`); a browser without it signs other tabs out at their next renewal.
- (autonomous default) The live message is `session.revoked` with a fresh event id, carrying no personal data, sent through the existing `live:events` fan-out to `account:{id}`; the API's auth Redis connection publishes it, so the auth module needs no dependency on the events module.
- (autonomous default) The pending offline sign-out lives in `localStorage` under `mf-sign-out-pending`; a browser without storage simply does not retry.
- (autonomous default) SC-001's 5-second bound stands for "a few seconds".
- Open SSE streams of other devices are closed by their dashboards on `session.revoked`; the server does not close them itself (their access token stays valid until it expires, 15 minutes at most, as the Build brief accepts).
- Out of scope, per the Build brief: deleting the account (ST-129), the settings pages themselves.
