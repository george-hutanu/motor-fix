# Feature Specification: Switch between my driver and garage roles in one account

**Feature Branch**: `394-role-switch`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-394 Switch between my driver and garage roles in one account (Notion story https://app.notion.com/p/3ee607bff0d281029850d5192fa1e164, epic EP-1 Foundations). Role chips in the dashboard menu of an account that holds more than one role; tapping one opens that role's dashboard without signing in again and stores `ACCOUNT.last_role`, which opens after the next sign-in on any device."

**Sources**: Notion story ST-394, read 2026-10-05 (Build brief current as of 2026-10-03; it wins over the criteria above it). Blockers on the Foundations build timeline, both Merged: ST-79 "Set up the account model, the four roles and their rights" (ACCOUNT_ROLE, `last_role`, the actor context, `roleInUse`) and ST-82 "Sign in with e-mail and password" (sessions, landing per role, the role used last opens). Epic: https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707.

**Already built** (`.specify/capabilities/accounts.md`): the actor guard takes the role in use from the access token when the account still holds it, otherwise `last_role`; sign-in and refresh issue a token for `last_role`; `GET /api/v1/me` returns `roles`, `role` and `landing`; the frame sends a person off a dashboard that is not their role's.

## Clarifications

### Session 2026-10-05

- Q: The Build brief's scenario 7 says another open tab keeps its role until reloaded, but a tab renews its 15-minute access token from the refresh cookie, which today always yields `last_role`; the other tab would silently change role at its next renewal while still showing the old dashboard. How is the tab's role kept? → A: `POST /api/v1/auth/refresh` accepts an optional body `{ "role": … }`; the web app sends the role its tab is showing. The token is issued for that role when the account still holds it, otherwise for `last_role` as today. A refresh never changes `last_role`.
- Q: The Build brief also covers "Adaugă o mașină", which adds the `driver` role when a garage-only account saves its first car; the form is the add-car story (EP-3, https://app.notion.com/p/3ee607bff0d2810a917ec0c5db68051b) and no `cars` module exists yet. → A: Out of this PR. The `auth` use case that adds a role in the caller's transaction already exists (`AccountsService.grantRole`, ST-79); the add-car story calls it and shows the menu entry. Recorded as a deviation for the owner.
- Q: Where do the chips sit, given the mock's "Vezi ca" chips are demo-only and the phone has no side menu? → A: In the frame's account block, above the name and "Ieși din cont": the bottom of the side menu on a desktop, the account band on a phone (the same block ST-288 kept on top below 768 px).
- Q: What does a failed switch look like (offline, network error, 5xx, or the role is gone)? → A: A toast "Nu am putut schimba rolul. Încearcă din nou." / "Could not switch the role. Try again."; the tab keeps its role and dashboard.
- Q: Is a chip a link or a button, and how is the role in use marked? → A: A button with `aria-pressed="true"` on the role in use (which does nothing when tapped), inside a group labelled "Rolul tău" / "Your role".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch role from the dashboard (Priority: P1)

Mihai holds `driver` and `garage`. His dashboard menu shows the chips "Șofer" and "Service", the one in use highlighted. On the garage dashboard he taps "Șofer": the driver dashboard opens at once, without signing in again, and the account remembers he used the driver role last.

**Why this priority**: it is the story's goal ("so that I do not need two accounts").

**Independent Test**: sign in as the seeded two-role account; tap "Șofer"; `/app/driver` opens with the driver menu; tap "Service"; `/app/garage` opens.

**Acceptance Scenarios**:

1. **Given** Mihai holds `driver` and `garage`, **When** his dashboard opens, **Then** the menu shows the chips "Șofer" and "Service", with the one in use pressed.
2. **Given** he is on the garage dashboard, **When** he taps "Șofer", **Then** `/app/driver` opens without a new sign-in and `ACCOUNT.last_role` becomes `driver`.
3. **Given** an account with only `driver`, **Then** no chips show.
4. **Given** a call to switch to a role the account does not hold, **Then** the API answers 404.
5. **Given** Elena holds `mechanic` and `driver`, **Then** the chips are "Mecanic" and "Șofer".
6. **Given** the switch call fails, **Then** a toast says the role could not be switched and the dashboard stays as it was.

---

### User Story 2 - The role used last opens after sign-in (Priority: P1)

After switching to the driver role, Mihai signs out and signs in again, on this or another device: the driver dashboard opens.

**Why this priority**: the owner's decision of 2026-10-03 ("after sign-in, the role the person used last opens").

**Independent Test**: switch to driver, sign out, sign in again: `/app/driver` opens.

**Acceptance Scenarios**:

1. **Given** Mihai switched to `driver`, **When** he signs in on another device, **Then** the driver dashboard opens.
2. **Given** two tabs are open on the garage dashboard, **When** Mihai switches to driver in one, **Then** the other keeps the garage role, also across its token renewals, until it is reloaded.

### Edge Cases

- A tap on a chip while a switch is on its way: ignored until the answer arrives.
- The account lost the role it switched to between the menu and the tap: the API answers 404; the tab shows the failure toast and keeps its role.
- A suspended or deleted account: the switch refuses it as a refresh does (403 suspended, 401 deleted) and clears the cookie. A role the account does not hold answers 404 first, whatever the account's status.
- The tab renews with a role the account no longer holds: the token is for `last_role` (or the fallback order), as without a role.
- Switching to the role already in use: the API answers with a token for it and changes nothing else; the web app never calls it (the pressed chip does nothing).
- The garage chip of a receptionist or mechanic opens `/app/garage`; the live connection is reopened so it joins the new role's channels.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `POST /api/v1/auth/roles/switch` with `{ "role": <role> }` and the browser's refresh cookie, for an account that holds that role, MUST store it as `ACCOUNT.last_role` and answer 200 with `{ "accessToken" }`, a new access token for that role, renewing the session as a refresh does. (Moved from `/me/roles/switch` by pr-tester lap 4: a switch from an access token alone kept a signed-out session alive.)
- **FR-002**: Switching to a role the account does not hold MUST answer 404 and change nothing; a body without a valid role MUST answer 400 `validation_failed`.
- **FR-003**: A switch MUST write no audit entry and send no notification.
- **FR-004**: `POST /api/v1/auth/refresh` MAY carry `{ "role": <role> }`; the new access token MUST be for that role when the account holds it, otherwise for the role it is issued for today; a refresh MUST NOT change `last_role`.
- **FR-005**: The dashboard frame of an account with two or more roles MUST show one chip per role it holds, labelled "Șofer", "Service", "Recepție", "Mecanic", "Admin" (EN "Driver", "Garage", "Front desk", "Mechanic", "Admin"), in a group labelled "Rolul tău" / "Your role", the role in use pressed; an account with one role MUST show no chips.
- **FR-006**: Tapping a chip of another role MUST switch to it (FR-001) with the tab's session, then reload the account, reopen the live connection and open that role's dashboard, without a new sign-in.
- **FR-007**: A switch that fails (no answer, an error answer) MUST show the toast "Nu am putut schimba rolul. Încearcă din nou." / "Could not switch the role. Try again." and keep the tab's role, token and dashboard.
- **FR-008**: The web app's token renewal MUST send the role its tab is showing (FR-004), so a tab keeps its role until reloaded.
- **FR-009**: A switch whose refresh cookie is missing, expired, or ended by a sign-out on this device or on every device MUST answer 401 and change nothing; a request that is not JSON MUST answer 415.

### Key Entities

- **Account** (existing): `last_role` written by FR-001.
- **Access token** (existing): carries the role in use.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A two-role person reaches the other role's dashboard with one tap and no sign-in.
- **SC-002**: After a switch, the next sign-in on any device opens the role switched to.
- **SC-003**: An account with one role sees no role control anywhere.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009
- **Modifies**: none
- **Removes**: none

## Assumptions

- (autonomous default) The chips sit in the frame's account block on every dashboard and on the phone's account band (Clarifications Q3); the mock's chips are demo-only and the phone placement is *(proposed)* in the Build brief.
- (autonomous default) The English chip labels are "Driver", "Garage", "Front desk", "Mechanic", "Admin"; the Build brief gives the Romanian only, "Recepție" is *(proposed)*.
- (autonomous default) The failure toast's texts (FR-007); the Build brief says only "an error toast" *(proposed)*.
- (autonomous default) A switch answers 200 with the same `SessionDto` shape sign-in uses, and rotates the refresh cookie as a refresh does.
- (autonomous default) The e2e test uses a new seeded two-role account (`comutare@example.test`, owner of a new seeded garage "Atelier Dinamo") so switching never changes the `last_role` that the sign-in test of `doua-roluri@example.test` relies on.
- Out of scope, per the Build brief or a later story: "Adaugă o mașină" and adding `driver` with a first car (the add-car story, EP-3; `AccountsService.grantRole` already exists); getting `garage` at the end of the listing form (EP-2); the assistant's per-role tools (AI assistant epic).
