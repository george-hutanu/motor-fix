# Feature Specification: Be asked to sign in when an action needs an account

**Feature Branch**: `130-sign-in-gate`

**Created**: 2026-10-04

**Status**: Archived (2026-10-05)

**Input**: User description: "ST-130 Be asked to sign in when an action needs an account (Notion story https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1, epic EP-1 Foundations). Scope: the shared sign-in gate — visitors browse freely; an action that needs an account opens the sign-in dialog over the screen and resumes with the form intact after sign-in or sign-up; the API denies by default and answers 401 sign_in_required for gated endpoints without a session."

**Sources**: Notion story ST-130 (https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1), read 2026-10-04; its Build brief (current as of 2026-10-03) wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d281318016f16b5b5bc417 (lane C · Auth, W5, 3 points). Blockers merged: ST-82 sign-in (`apps/web/src/app/sign-in/`, `libs/domain/src/auth/`), ST-80 sign-up, ST-157 the shared dialog (`libs/overlays`), ST-159 shared form saving. Sibling ST-394 read for the role boundary (scenario 7 of the brief).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The API refuses every account action without a session, by default (Priority: P1)

Every API route needs a signed-in account unless it is on one short public list. A call to any other route without a valid session answers 401 with code `sign_in_required`, whatever the route, the method or the body. A route added later is gated without anyone remembering to gate it.

**Why this priority**: a check made only in the browser is not a check (constitution V); the screens of later epics (quote requests, messages, saved garages, reviews) rely on this default.

**Independent Test**: list every API route; call each one that is not on the public list without a token and with a broken token; read the status and the code.

**Acceptance Scenarios**:

1. **Given** no token, **When** any route not on the public list is called (any method, with or without a body), **Then** the answer is 401 with code `sign_in_required`, before the body is validated.
2. **Given** a token that is expired, malformed or signed with another key, **When** a gated route is called, **Then** the answer is 401 `sign_in_required`.
3. **Given** no token, **When** a route on the public list is called (sign-in, sign-up, renewal, sign-out, the two health checks), **Then** it answers as it does today.
4. **Given** a valid token of an active account, **When** a gated route is called, **Then** the route runs with that account as the actor.
5. **Given** a route added to the API without any marking, **When** it is called without a token, **Then** it answers 401 `sign_in_required`.

---

### User Story 2 - An action that needs an account asks me to sign in over the screen and goes on afterwards (Priority: P1)

A visitor fills in a form whose action needs an account and taps its main button. The sign-in dialog opens over the form, titled "Autentificare", with a line saying why: "Intră în cont ca să continui." They sign in, or switch to "Creează un cont" and sign up, and the dialog closes: they are on the same screen, the form holds what they typed, and the action they asked for is carried out. If they close the dialog, they stay on the form with their text kept and the form says they need to sign in.

**Why this priority**: the first visit stays easy and nothing typed is lost; every later epic's account action uses this one gate.

**Independent Test**: on a screen whose action calls a gated endpoint, as a visitor, type into the form, tap send, sign in (and, separately, sign up) in the dialog; check the address, the form and that the call was made once with the new session.

**Acceptance Scenarios**:

1. **Given** a visitor on a form whose action needs an account, **When** they tap its main button, **Then** the sign-in dialog opens over the form with the line "Intră în cont ca să continui." and the address does not change.
2. **Given** the dialog opened by an action, **When** the visitor signs in, **Then** the dialog closes, the screen and its form stay exactly as left (no dashboard opens), and the action is sent once with the new session.
3. **Given** the dialog opened by an action, **When** the visitor switches to sign-up and creates an account, **Then** the same happens: they are back on the form and the action is sent once.
4. **Given** the dialog opened by an action, **When** the visitor closes it, **Then** they stay on the form with their text kept, nothing is sent, and the form shows "Intră în cont ca să continui."
5. **Given** two account actions fail for want of a session at the same moment, **Then** one dialog opens, and both go on once the visitor signs in.
6. **Given** the visitor taps "Autentificare" or "Cont" (not an action), **Then** the dialog opens without the reason line and, after sign-in, the dashboard opens, as today.

---

### User Story 3 - A session that ends while I work asks me to sign in again and the action goes on (Priority: P2)

A signed-in person whose session can no longer be renewed (it expired, or was ended on another device) submits a form or makes any account call. Instead of failing, the same dialog opens; after they sign in again the call is repeated and they go on where they were.

**Why this priority**: today such a call fails with a generic error and the person is silently signed out in memory.

**Independent Test**: signed in on a dashboard, make the renewal refuse; trigger an account call; sign in in the dialog; check the call was repeated once with the new token.

**Acceptance Scenarios**:

1. **Given** a signed-in person whose access token is refused and whose renewal is refused, **When** an account call is made, **Then** the sign-in dialog opens over the screen with the reason line.
2. **Given** that dialog, **When** they sign in, **Then** the call is repeated once with the new token and its answer reaches the screen that made it; the address does not change.
3. **Given** that dialog, **When** they close it, **Then** the call fails as a refused call does today and the screen keeps what was typed.

---

### Edge Cases

- A refusal other than `sign_in_required` (a 403 `account_suspended`, a 404 for a missing right, a 401 `invalid_credentials` from sign-in itself): no dialog opens; the screen shows its own message.
- The four session calls (`/api/v1/auth/sign-in`, `/sign-up`, `/refresh`, `/sign-out`) never open the dialog, so a failed sign-in inside the dialog cannot open a second dialog.
- Asking "who am I" while signed out (Session load) never opens the dialog: being signed out is a normal answer there.
- The page is rendered on the server: no dialog opens there; the server makes no account calls.
- A call answered 401 `sign_in_required` while a dialog opened by the gate is already open waits on that dialog rather than opening another.
- The person signs in as an account that lacks the right for the action (for example a garage-only account and a driver action): the repeated call answers 404 and the screen shows that answer; offering the role is ST-394's.
- An unknown route: 404, as today; the guard only runs for routes that exist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The API MUST check the actor on every route by default; a route MUST be explicitly marked public to be reachable without a session. Without a valid access token a gated route MUST answer 401 `sign_in_required` before its body is validated (modifies 079-FR-011).
- **FR-002**: The public list MUST be exactly: `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/sign-out`, `GET /health/live`, `GET /health/ready` (outside the `/api/v1` prefix), and `POST /api/v1/webhooks/brevo`, which checks Brevo's own bearer secret and is left out of the OpenAPI document (it arrived with ST-194; its own integration spec boots the app-wide check); a test MUST enumerate every route the API serves, call each without a token, and fail when the set of routes not answering 401 `sign_in_required` differs from this list.
- **FR-003**: The suspended (403 `account_suspended`) and capability (404) answers of the actor check MUST stay as they are for gated routes.
- **FR-004**: In the browser, an API call made through the app's HTTP client, outside the session calls (`/api/v1/auth/*`) and outside "who am I", that is answered 401 with code `sign_in_required` MUST first be renewed once from the cookie (one renewal shared by concurrent calls, whether or not the call carried a token) and repeated; when the renewal fails it MUST open the sign-in dialog over the current screen without changing the address, showing the line "Intră în cont ca să continui." under the brand line (modifies 082-FR-018). The live stream, which does not go through that client, keeps its own renew-and-reconnect and never opens the dialog.
- **FR-005**: When the person signs in, or switches to sign-up and creates an account, in a dialog opened by FR-004, the dialog MUST close without navigating and the refused call MUST be sent again once with the new access token, its answer going to the code that made the call; a repeated call that is refused again fails with that answer and opens no further dialog.
- **FR-006**: When a dialog opened by FR-004 is closed without signing in, the refused call MUST fail with its original 401 `sign_in_required`; the shared task saving MUST map `sign_in_required` to "Intră în cont ca să continui." for every form, once, so a form keeps its values and shows that line in its message region with no text of its own.
- **FR-007**: There MUST be at most one sign-in dialog open: while any sign-in dialog is open (opened by FR-004, or by "Autentificare" / "Cont"), a further refused call waits on it and is repeated after sign-in, or failed when it closes without one.
- **FR-008**: "Autentificare" and "Cont" MUST keep opening the dialog without the reason line and, after sign-in or sign-up, open the person's landing (082-FR-017, 080-FR-013 unchanged), also when a refused call was waiting on that dialog.
- **FR-009**: The gate MUST NOT open on the server-rendered page.
- **FR-010**: Every new text MUST exist in Romanian and English, and Romanian words joined by a hyphen MUST use U+2011.

### Key Entities

- **Public route marker**: the mark a route carries to be reachable without a session; its absence means gated.
- **Gate** (web, memory only): the one open sign-in dialog shared by every call refused for want of a session, and the calls waiting on it.

## Clarifications

### Session 2026-10-04

- Q: When a token-less call is answered 401 `sign_in_required`, does the interceptor try one renewal from the cookie before opening the dialog? → A: Yes, for every such call: a remembered session reloaded on a public screen holds no token in memory but a valid cookie, and `Session.renew()` is already shared (`apps/web/src/app/dashboard/session.ts:61-87`). (autonomous, recommended by spec-challenger)
- Q: Is the public-list test based on the route marker or on behaviour? → A: Behaviour: every registered route is called without a token and the set not answering 401 `sign_in_required` must equal the six (FR-002); it also catches a guard left per-controller. (autonomous, recommended)
- Q: Where does `sign_in_required` become the reason line on a form? → A: In the shared task saving, once (FR-006), so later forms need no text of their own. (autonomous, recommended)
- Q: Does the gate cover the fetch-based live stream? → A: No: only calls through the HTTP client; the stream keeps its renew-and-reconnect (`apps/web/src/app/dashboard/live.ts:52-77`) and a background reconnect never opens a modal (FR-004). (autonomous, recommended)
- Q: When a refused call arrives while the "Autentificare" dialog is already open, does it wait on that dialog? → A: Yes: at most one sign-in dialog; the call is repeated after sign-in and the landing still opens because the person asked for it (FR-007, FR-008). (autonomous, recommended)
- Resolved from context.md without a question: the three deviations from the brief's *proposed* details (repeat at once, the generic line, memory instead of session storage) stay as autonomous defaults under Assumptions, flagged to the owner in the PR; the public list grows one route per later story, each marking its own route public.

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-002, FR-003, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010
- **Modifies**: `079-FR-011` → `FR-001`, `082-FR-018` → `FR-004`
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every gated route answers 401 `sign_in_required` without a token, and the public set equals the six routes of FR-002 (API test over the full route list, 100%).
- **SC-002**: A visitor who triggers an account action and signs in, or signs up, in the dialog ends on the same address with the form's text intact and the action sent once (component test, and one end-to-end flow).
- **SC-003**: A session refused mid-work is recovered in one dialog submit and the refused call is repeated exactly once (unit test over the interceptor).
- **SC-004**: No dialog opens for any refusal code other than `sign_in_required`, nor for the session calls (unit test).

## Assumptions

- No screen with an account action exists yet: the quote request, the message to a garage, saving a garage and writing a review are built in later epics (the brief's Out of scope). The gate is therefore driven from the one place every such action passes — the API client's interceptor — so each later form gets it by calling its endpoint, with no code of its own. The end-to-end flow uses an existing account call (the language save from the dashboard, `PATCH /api/v1/me`) with its session refused. (autonomous default)
- After signing in through the gate the refused call is repeated at once, rather than waiting for "one more tap" (the brief's *proposed* detail of scenario 1): the session-expired case (brief scenario 6, "the action resumes after sign-in") needs the repeat anyway, a refused call changed nothing on the server so repeating it sends the action exactly once, and one mechanism for both cases is the smaller change (Principle I). (autonomous default)
- The reason line is one generic sentence, "Intră în cont ca să continui." (Sign in to continue.). The brief's action-specific line ("…ca să trimiți cererea.") belongs to the quote request story, which can pass its own line when it exists. (autonomous default)
- The pending action is kept in memory while the tab is open, not in session storage: the dialog opens over the screen and nothing in this epic navigates away or reloads during sign-in, so the form never leaves memory. Session storage with a 30-minute expiry (*proposed* in the brief) earns its place with the first sign-in that leaves the page — Google and Apple (ST-83) — and is recorded there as a follow-up. (autonomous default)
- The listing form (brief scenario 5), the live public stream and the listing draft endpoints do not exist yet; each joins the public list in the story that builds it, by marking its route public. (autonomous default)
- Scenario 7 of the brief (an account without the `driver` role) is already answered by the policy's 404 (079-FR-013); hiding driver actions and adding the role are ST-394's. (autonomous default)
- The renewal endpoint stays public because it works by cookie, not by access token (082-FR-008). (autonomous default)
