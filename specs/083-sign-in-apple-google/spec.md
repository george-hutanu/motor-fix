# Feature Specification: Sign in with Apple or Google

**Feature Branch**: `83-sign-in-apple-google`

**Created**: 2026-10-05

**Status**: Archived (2026-10-06)

**Input**: User description: "ST-83 Sign in with Apple or Google — https://app.notion.com/p/3ee607bff0d281ae87e5f2ff6afae615 (stacked on #133, branch from origin/132-sign-up-consent)", epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707.

**Sources**: Notion story ST-83, read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it, and its 2026-10-03 note supersedes the "kind chosen in the switch" criterion (a new person gets a driver account only). The shared `createAccount` and consent contract of ST-132 (`libs/domain/src/auth/accounts.service.ts`, `libs/contracts/src/consent.ts`, the `mf-consent` tick). The sign-in session and landing of ST-82 (`sign-in.service.ts`, `auth.controller.ts`). The owner's dispatch: Google's keys are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on Railway's `api` service; Apple has no keys yet and its button stays hidden until they are set; tests use a stub OpenID provider, never the real Google or Apple.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person with an account signs in with Google or Apple (Priority: P1)

The sign-in dialog shows "Continuă cu Apple" and "Continuă cu Google" under the word "sau". A tap leaves for the provider; once the person approves there, they come back signed in to the MotorFix account that holds that provider identity, or to the account whose e-mail the provider vouches for, which the provider is then linked to.

**Why this priority**: it is the story: signing in without another password.

**Independent Test**: with a stub OpenID provider standing in for Google and Apple, sign in as a seeded e-mail account through each provider; read the session, the linked identity and the audit history.

**Acceptance Scenarios**:

1. **Given** Andrei has an e-mail and password account for andrei@gmail.com, **When** he continues with Google and Google reports that e-mail as verified, **Then** the `google` identity is linked to his account, the audit history records "sign-in method linked", and he is signed in to it.
2. **Given** Andrei's account already holds his `google` identity, **When** he continues with Google again, even after changing his Google e-mail, **Then** he is signed in to the same account, matched on Google's subject.
3. **Given** Mihai holds a garage account for mihai@icloud.com, **When** he continues with Apple with that verified e-mail, **Then** he is signed in to it and the role he used last opens.
4. **Given** a provider reports an e-mail that matches an account but marks it as not verified, **When** the person continues, **Then** the identity is not linked to that account.
5. **Given** sign-in succeeded, **Then** the person lands where an e-mail sign-in takes them (their role's landing), or back on the screen whose action asked them to sign in.

---

### User Story 2 - A new person gets a driver account after the terms tick (Priority: P1)

A person the provider vouches for, with no MotorFix account, comes back to a short step: their name filled in from the provider, the terms tick, and "Creează contul". Only then is a driver account created, holding the provider identity.

**Why this priority**: consent before the account exists is the law (ST-132), and most people arriving through Google are new.

**Independent Test**: continue with the stub Google as an unknown person; read the step's data, tick, create; read the account, its identity, consent rows, audit and event.

**Acceptance Scenarios**:

1. **Given** Elena has no account, **When** she continues with Google and approves, **Then** she sees her name filled in and the terms tick; on "Creează contul" a `driver` account is created with identity `google`, `email_verified_at` set, consent rows with method `google`, the audit entries of a new account and `account.created` with method `google`, and she lands on the driver dashboard, or goes back to the action that asked her to sign in.
2. **Given** the step, **When** "Creează contul" is tapped with the tick empty, **Then** nothing is sent; an API call without the current consent answers 400 `consent_required` and creates nothing.
3. **Given** an Apple user hides their e-mail, **When** they continue with Apple for the first time, **Then** the relay address is stored as the account's e-mail and a new driver account is created.
4. **Given** Apple sends the person's name only on the first approval, **Then** that name prefills the step.
5. **Given** the step is left without creating the account, **Then** no account exists and the dialog closes.

---

### User Story 3 - Cancel, failure, maintenance and unconfigured providers (Priority: P2)

**Why this priority**: the outside services may be absent, refused or down, and e-mail sign-in must keep working.

**Independent Test**: cancel at the stub, make the stub fail, turn maintenance on, unset a provider's keys; read what the web shows and what the API answers.

**Acceptance Scenarios**:

1. **Given** the person cancels at the provider, **Then** they come back to the sign-in dialog with no error.
2. **Given** the provider does not answer or answers something that does not verify, **Then** the dialog shows "Nu am putut contacta Google. Încearcă din nou sau intră cu e-mail sau telefon." (or "Apple"), and e-mail sign-in still works.
3. **Given** maintenance mode is on, **Then** only accounts holding `admin` sign in this way; anyone else comes back to the dialog with the maintenance message, and no account is created.
4. **Given** a provider whose keys are not set, **Then** its button is not shown and its routes answer 404; with neither provider set the "sau" divider is not shown.

---

### Edge Cases

- The state returned by the provider does not match the browser's flow cookie, or the flow is unknown, expired (10 minutes) or already used: `provider_failed`, nothing signed in.
- The ID token's signature, issuer, audience, expiry or nonce does not verify: `provider_failed`.
- A subject matched to a suspended account: back to the dialog with the existing `account_suspended` message; to a deleted account: `provider_failed`, nothing linked or created.
- Two returns for the same person at once (two tabs, a double click): the identity is linked once, one audit entry, and both are signed in.
- A provider e-mail, not marked verified, that another account already uses: the return is `email_taken` and the dialog tells the person to sign in with e-mail; if it is taken only after the step opened, the step answers 409 `email_taken` with the same text.
- A provider answer with no e-mail at all: the step still creates the account, without an e-mail.
- The new-person step's pending sign-up expired (10 minutes) or missing: 400 `provider_failed`, nothing created.
- A sign-out still waiting to be sent is sent before leaving for the provider, so it never ends the new session.
- The address the person returns to is kept only in the tab; when it is lost, the role's landing opens.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The sign-in and sign-up tasks of the dialog MUST show, under their main button, a divider with the word "sau" (EN "or") and a 50 px ghost button per configured provider, Apple first: "Continuă cu Apple" / "Continuă cu Google" (EN "Continue with Apple" / "Continue with Google"), each with its provider's mark. The web MUST learn which providers are configured from a public `GET /api/v1/auth/providers` answering `{ apple, google }` booleans; an unconfigured provider MUST show no button, and with neither the divider MUST NOT show.
- **FR-002**: A provider MUST count as configured only when all its keys and the web address are set: Google `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; Apple `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`; both `PUBLIC_WEB_URL`. Its return address MUST be `PUBLIC_WEB_URL` + `/api/v1/auth/oauth/{provider}/callback`. When `APP_ENV` is `development` or `test`, `GOOGLE_ISSUER` and `APPLE_ISSUER` MAY point a provider at a stand-in OpenID issuer; `staging` and `production` MUST ignore them and always use `https://accounts.google.com` and `https://appleid.apple.com`. No key value MUST ever be logged or answered.
- **FR-003**: Tapping a provider button MUST send any sign-out still waiting, keep the address to return to in the tab when an action asked for sign-in, and open `GET /api/v1/auth/oauth/{provider}?language={ro|en}&remember={true|false}` in the page. That route MUST redirect to the provider's authorisation with the authorisation code flow, PKCE (S256), a random state and a random nonce, keep the flow on the server for at most 10 minutes, and bind it to the browser with an `HttpOnly`, `Secure` cookie scoped to `/api/v1/auth/oauth`. An unconfigured provider MUST answer 404.
- **FR-004**: The provider's return (`GET` for Google, the form `POST` for Apple, at `/api/v1/auth/oauth/{provider}/callback`) MUST be accepted only when its state equals the browser's flow cookie and names a stored flow of that provider, which is then used up. It MUST exchange the code with the PKCE verifier (Apple's client secret being a short-lived ES256 token signed with its key), and accept the ID token only when its signature verifies against the provider's published keys and its issuer, audience (the client id), expiry and nonce match. Every outcome MUST redirect to `/{language}/sign-in/return?result=…&provider=…` on the web (language `ro` when no flow was found) and clear the flow cookie.
- **FR-005**: The returned person MUST be matched first on (method, provider subject). With no match, when the provider marks the e-mail as verified and an account holds that e-mail, and that account has confirmed the e-mail itself, the provider identity MUST be linked to that account and the audit history MUST record "sign-in method linked" (field `identity`, value the method), in one transaction. An unverified provider e-mail MUST NOT link, and neither may any e-mail of an account that never confirmed it: both return `email_taken` and keep nothing. A provider that cannot be reached when the flow starts MUST return `failed` the same way, never an error page.
- **FR-006**: A matched or linked account MUST be signed in as an e-mail sign-in is: refused for a suspended account (`account_suspended`) and, under maintenance, for an account not holding `admin` (`maintenance`); otherwise a new session for the role in use, chosen as e-mail sign-in chooses it (the last role when held), with the refresh cookie (30 days when "Ține-mă autentificat" was ticked) and the result `signed-in`. A deleted account MUST answer `provider_failed`.
- **FR-007**: With no matched account, under maintenance the return MUST be `maintenance` and nothing kept; when the provider's e-mail is not verified and another account already holds it, the return MUST be `email_taken` and nothing kept. Otherwise the server MUST keep a pending sign-up for at most 10 minutes (provider, subject, e-mail, whether verified, name, "keep me signed in"), bound to the browser by an `HttpOnly`, `Secure` cookie, and return `consent`. Apple's name, sent only on the first approval in its form's `user` field, MUST be taken from there; a hidden-e-mail relay address MUST be kept as the e-mail.
- **FR-008**: `GET /api/v1/auth/oauth/pending` MUST answer the pending sign-up's provider, name and e-mail to that browser (404 without one). `POST /api/v1/auth/oauth/complete`, JSON only, with `{ name, language, consent }`, MUST create the account through the shared `createAccount`: role `driver` only, identity (provider, subject), the provider's e-mail, verified only when the provider said so, the consent rows with the provider as method, the audit entries and `account.created` with the method; then use up the pending sign-up and answer a session as sign-up does. Without the current consent it MUST answer 400 `consent_required` and create nothing; without a live pending sign-up 400 `provider_failed`; an e-mail taken since 409 `email_taken`; under maintenance 503 `maintenance`.
- **FR-009**: The web's return address `/{lang}/sign-in/return` MUST show Home with: for `signed-in`, the session renewed from the cookie, then the kept address or the role's landing; for `consent`, the new-person step (provider named, name prefilled and editable, the `mf-consent` tick, "Creează contul", "Anulează"), which on success goes on as `signed-in` and on leaving closes on Home; for `cancelled`, the sign-in dialog with no error; for `failed`, the dialog with "Nu am putut contacta {provider}. Încearcă din nou sau intră cu e-mail sau telefon." (EN "We could not reach {provider}. Try again, or use e-mail or phone."); for `maintenance` and `suspended`, the dialog with the existing messages for those codes; for `email_taken`, the dialog with "Există deja un cont cu acest e-mail. Intră cu e-mail și parolă." (EN "An account already uses this e-mail. Sign in with e-mail and password."). A 409 `email_taken` at the new-person step MUST show the same text there.
- **FR-010**: A provider's refusal or the person's cancel at the provider (`access_denied`, `user_cancelled_authorize`) MUST return `cancelled`; a discovery, key or token call to the provider that does not answer within 5 seconds each, or any failed check, MUST return `failed`; neither MUST create, link or sign in anything, and each MUST be logged with its reason and the provider, never a token, code or e-mail.
- **FR-011**: Every new text MUST exist in Romanian and English, and the buttons, divider and new-person step MUST NOT scroll sideways on a 320 px phone.

### Key Entities

- **Account identity** (exists, ACCOUNT_IDENTITY): gains rows of method `google` or `apple` with the provider's subject.
- **Sign-in flow** (Redis, 10 minutes): provider, state, nonce, PKCE verifier, language, "keep me signed in". Used once.
- **Pending sign-up** (Redis, 10 minutes): provider, subject, e-mail, verified, name, "keep me signed in". Used once.

## Clarifications

### Session 2026-10-05

- Q: Pop-up on a computer, redirect on a phone? → A: A full redirect everywhere: one flow, no pop-up blocker, Apple's form-post return behaves the same on every device; the brief marks the pop-up *(proposed)*. (autonomous default)
- Q: Where does the return address live, and how does the web learn the outcome? → A: The provider returns to the API through the web's own address (the edge proxies `/api/`), so the cookies stay first-party; the API redirects to a fixed web path with a result code only, never a token or a free-form address, so there is no open redirect. The screen to go back to is kept in the tab by the web. (autonomous default)
- Q: How does the web know which buttons to show? → A: A public `GET /api/v1/auth/providers` with two booleans, read when the dialog opens; the keys never leave the server. (owner's dispatch: "hide the button whenever its env values are unset, through a public config flag the web reads")
- Q: What does a new person's account carry when the provider's e-mail is not verified? → A: The e-mail, not marked verified; it never links to another account. (autonomous default, brief › Rules)
- Q: A new person under maintenance: refused at the return or at the step? → A: At the return (`maintenance`, nothing kept); the step's 503 stays as the guard for maintenance starting meanwhile. (autonomous, recommended by spec-challenger)
- Q: An unverified provider e-mail another account holds: refused where, shown how? → A: At the return as `email_taken`, the dialog naming e-mail sign-in; the step's 409 shows the same text when it is taken meanwhile. (autonomous, recommended by spec-challenger)
- Q: Which calls carry the 5-second limit? → A: Discovery, the key set and the token call, each; the person's time at the provider is bounded only by the 10-minute flow. (autonomous, recommended by spec-challenger)
- Q: Which environments honour the issuer overrides? → A: `development` and `test` only; staging holds the real Google keys and ignores them like production. (autonomous, recommended by spec-challenger)
- Q: Language with no flow, and role for a multi-role account? → A: `ro`; the role e-mail sign-in would choose (`roleInUse` with the last role). (autonomous, recommended by spec-challenger)
- Q: May a verified provider e-mail link to an account that never confirmed that e-mail? → A: No: it returns `email_taken`, so nobody can register someone else's address with a password and wait for the owner to sign in with Google (pre-account takeover); the person signs in with e-mail and confirms it first. Open for the owner, since a garage account made by the listing form with an unconfirmed e-mail no longer links. (autonomous, recommended by code-reviewer)
- Q: Which env names for Apple? → A: `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the PEM of the .p8 key, `\n` escapes allowed). (owner's dispatch: the run chooses them)

## Spec Delta

### Capability: `accounts`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Against the stub provider, a known subject, a verified e-mail match and an unverified e-mail match give exactly 1 sign-in to the existing account, 1 link, and 0 links respectively (API test).
- **SC-002**: A new person creates exactly 1 account, role `driver` only, with 1 identity of the provider, 2 consent rows and 1 `account.created` with the method; without consent 0 (API test).
- **SC-003**: Cancel, provider failure and a forged or replayed state each create, link and sign in nothing (API test).
- **SC-004**: In the browser, Google against the stub provider creates a driver account and lands on `/app/driver` (end to end).

## Assumptions

- The first build has Google keys on staging and production and no Apple keys; Apple is built fully and stays hidden until its four values are set. (owner's dispatch)
- The end-to-end flow runs against a stub OpenID provider started beside the local servers, not on staging: staging holds the real Google keys and must never be pointed at a stub. (autonomous default; the brief proposed staging)
- Removing a linked method or adding a password is ST-84's; garage accounts come from the listing form. (Build brief › Out of scope)
- Nobody is notified of a new link. (Build brief › Events, *(proposed)*)
- The 10-minute life of a flow and of a pending sign-up, and the 5-second provider timeout, are not from a source. (autonomous default)
