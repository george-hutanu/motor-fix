---
capability: accounts
updated: 2026-10-05
features:
  - 079-account-model
  - 082-sign-in
  - 080-sign-up
  - 020-account-language
  - 130-sign-in-gate
  - 128-sign-out
---

# Capability: Accounts

Accounts, their roles and sign-in identities, the link of an account to a garage, the actor every call runs as, and the rights each role has.

## Requirements

### 079-FR-001 — The system MUST store an account with id, e-mail (unique, trimmed, lower-case, optional), e-mail verified time, phone (unique, optional), phone verified time, name, city (optional), language (`ro` default, or `en`), status (`active` default, `suspended`, `deleted`), last role, last active time and creation time.

_From 079-account-model._

### 079-FR-002 — The system MUST store an account's roles as rows of (account, role) with role ∈ `driver`, `garage`, `receptionist`, `mechanic`, `admin`, one row per pair.

_From 079-account-model._

### 079-FR-003 — The system MUST store an account's sign-in identities as (account, method ∈ `password`, `google`, `apple`, `whatsapp_phone`, subject, an argon2id password hash for `password`, written by the sign-up and sign-in stories), unique per (method, subject).

_From 079-account-model._

### 079-FR-004 — The system MUST store refresh tokens as (account, token hash, family id, expiry, used time) for the sign-in story to issue and rotate.

_From 079-account-model._

### 079-FR-005 — The system MUST store a minimal garage (id, name, unique slug, status), a garage membership (garage, account, role ∈ `owner`, `receptionist`, joined time) unique per (account, membership role) — so an account owns at most one garage and is receptionist at at most one — and a mechanic link (garage, account unique, and the three permissions defaulting to false).

_From 079-account-model._

### 079-FR-006 — Creating an account MUST write the account, its roles and its identity, hand `account.created` (account id, roles, method) to the event port and one audit entry per role added (actor = the new account itself) to the audit port, all inside one transaction that rolls back whole if any step fails; an account with no role is refused.

_From 079-account-model._

### 079-FR-007 — Granting a role to an existing account MUST add the role row and hand an audit entry (actor, account, role, old and new value) to the audit port in the caller's transaction; granting a held role changes nothing.

_From 079-account-model._

### 079-FR-008 — The audit port and the event port MUST each be an interface that takes the open transaction, with a no-op implementation bound by default, so the audit history writer and the outbox replace the binding without touching the account code.

_From 079-account-model._

### 079-FR-009 — No public endpoint MUST be able to create an account with, or grant, `admin`, `garage`, `mechanic` or `receptionist`. This story ships one endpoint ("who am I", FR-016); the rule is enforced by the account use cases, whose callers pass the role from server code, and tested against the use cases and the API's route list.

_From 079-account-model._

### 079-FR-010 — The capabilities of each role MUST be one table on the server, with a test for every "may not" (every role × capability not granted). It holds the capabilities this epic's frames and scenarios name, read from the Security page's "Capabilities by role": driver — `driver.requests`, `driver.cars`, `driver.reviews`, `driver.saved_garages`, `driver.settings`; garage side — `garage.requests` (owner, receptionist; mechanic with `can_answer_quotes`), `garage.schedule` (owner, receptionist; mechanic with `can_move_bookings`), `garage.final_price` (owner, receptionist; mechanic with `can_record_final_price`), `garage.own_jobs` (owner, receptionist, mechanic), `garage.reviews`, `garage.team`, `garage.prices`, `garage.profile`, `garage.feature_switches` (owner only); admin — `admin.garages`, `admin.users`, `admin.reviews`, `admin.catalogue`, `admin.settings`. Later epics add rows. The web app gets the actor's capabilities through "who am I", never a copy of the table.

_From 079-account-model._

### 130-FR-001 — The API MUST check the actor on every route by default; a route MUST be explicitly marked public to be reachable without a session. Without a valid access token a gated route MUST answer 401 `sign_in_required` before its body is validated (modifies 079-FR-011).

_From 130-sign-in-gate._

### 079-FR-012 — The role in use MUST be the role the access token carries when the account still holds it (the token is issued for the last role at sign-in, and for the new role at a role switch), otherwise the account's last role when held, otherwise the first held role in the order admin, garage, receptionist, mechanic, driver; the fallback is computed per call, never written back.

_From 079-account-model._

### 079-FR-013 — The policy MUST answer 404 when the actor's role lacks the capability or the resource belongs to another account or garage; it MUST be callable from use cases, not only from controllers.

_From 079-account-model._

### 079-FR-014 — A mechanic capability that depends on a permission (`can_move_bookings`, `can_answer_quotes`, `can_record_final_price`) MUST be allowed only when that permission is on.

_From 079-account-model._

### 079-FR-015 — A customer described to a mechanic MUST carry the first name and the car, the plate only on the mechanic's own jobs, and never a phone field; described to a receptionist or owner it MAY carry the phone and the plate (the conditions "quote accepted" and "car in the workshop" are applied by the epics that own quotes and jobs). No job exists yet, so this is one function that takes "is it the mechanic's own job" as an input; the first epic with jobs supplies it.

_From 079-account-model._

### 079-FR-016 — The API MUST answer "who am I" for the actor: account id, name, e-mail, language, roles, role in use, garage id, the capabilities of the role in use, and the landing address (`/app/driver`, `/app/garage` for garage, receptionist and mechanic, `/app/admin`).

_From 079-account-model._

### 082-FR-021 — A signed-out visit to `/app/driver`, `/app/garage` or `/app/admin` MUST end on Home with the sign-in dialog open; after signing in, the person's own landing opens (modifies 079-FR-017).

_From 082-sign-in._

### 079-FR-018 — The frame's menu MUST show only the entries the role in use may open according to the capabilities table; there MUST be no "Vezi ca" demo buttons.

_From 079-account-model._

### 082-FR-001 — `POST /api/v1/auth/sign-in` MUST take an e-mail (trimmed, compared lower-case), a password and "keep me signed in" (true by default); with the right credentials it MUST answer an access token for the account's role in use (signed as ST-79's guard checks, valid 15 minutes) in the body, set the refresh token cookie, open a new refresh-token family, and set the account's last active time.

_From 082-sign-in._

### 082-FR-002 — A wrong password, an unknown e-mail, an account with no password identity and a deleted account MUST all answer 401 with code `invalid_credentials` and the same body, and the password check MUST run in every case (against a fixed decoy hash when there is no account), so the answer does not reveal whether the e-mail exists.

_From 082-sign-in._

### 082-FR-003 — Passwords MUST be checked against an argon2id hash in PHC string form; the comparison MUST be constant-time.

_From 082-sign-in._

### 082-FR-004 — The right password for a suspended account MUST answer 403 `account_suspended`.

_From 082-sign-in._

### 082-FR-005 — Failed attempts MUST be counted per e-mail and per network address in Redis; only an `invalid_credentials` answer counts, and each counted failure restarts the key's 15 minutes. Once an e-mail has 5 counted failures, or an address 20, every attempt for that e-mail or from that address MUST be refused with 429 `too_many_attempts` before the password is checked, without being counted, until 15 minutes after the last counted failure. Only a successful sign-in (200) MUST clear the e-mail's count; 400, 403 and 503 answers neither count nor clear. When Redis cannot be reached or does not answer within 2 seconds, sign-in MUST proceed without the limits and log the failure.

_From 082-sign-in._

### 082-FR-006 — While maintenance mode reads as on, a sign-in with the right credentials by an account not holding `admin` MUST answer 503 `maintenance`; an admin MUST sign in. Maintenance MUST read as off until the platform rule exists.

_From 082-sign-in._

### 082-FR-007 — The refresh token MUST be a random value stored only as its hash, sent in a cookie that is `HttpOnly`, `Secure`, `SameSite=Strict` and scoped to `/api/v1/auth`; with "keep me signed in" it MUST carry a 30-day lifetime and the server MUST accept it for 30 days from its issue; without, it MUST be a browser-session cookie the server accepts for 12 hours from its issue. Every token issued by renewal keeps its family's choice.

_From 082-sign-in._

### 082-FR-008 — `POST /api/v1/auth/refresh` MUST, for a valid unused token of an active account, mark it used, issue its successor in the same family (new cookie), and answer a new access token for the role in use; it MUST update the last active time at most once an hour. An unknown, expired or revoked token MUST answer 401 `sign_in_required` and clear the cookie (only a refusal clears it: a server error, such as the database being unreachable, keeps the cookie); for a suspended account (403 `account_suspended`), a deleted account or an account holding no role (401 `sign_in_required`) it MUST also revoke the family and clear the cookie.

_From 082-sign-in._

### 082-FR-009 — A refresh token presented again after it was used MUST revoke every token of its family and answer 401 `sign_in_required`, unless it was rotated less than 20 seconds earlier (two tabs renewing at once), which MUST answer a new access token like a rotation does, without a new cookie and without revoking anything.

_From 082-sign-in._

### 082-FR-010 — `POST /api/v1/auth/sign-out` MUST revoke the family of the presented refresh token, clear the cookie and answer 204, also when no or an unknown token is presented.

_From 082-sign-in._

### 082-FR-011 — A sign-in body without an e-mail or a password, with values that are not text, or with an e-mail holding control characters MUST answer 400 with the validation problem; a sign-in that is not sent as JSON MUST be refused (415 for a form post) without a cookie, so another site cannot sign the browser into an account it chose; the password MUST never be logged, and a failed attempt MUST be logged with its reason and no e-mail, password or address.

_From 082-sign-in._

### 080-FR-009 — The sign-in dialog MUST show "Ești nou pe MotorFix?" and the button "Creează un cont" under its main button; it MUST open the sign-up dialog — the shared `dialog` shape titled "Cont nou", "MotorFix" and the driver blurb under the title, "Nume", "E‑mail", "Parolă" with a show/hide control, the main button "Creează contul", and "Ai deja cont?" with "Intră în cont", which opens the sign-in dialog again. Each switch MUST carry the typed e-mail and MUST NOT ask before discarding.

_From 080-sign-up._

### 082-FR-014 — Before sending, the dialog MUST check that the e-mail is filled in and looks like an address (text, "@", a domain with a dot) and that the password is filled in, through the shared task saving of `libs/overlays`; each problem MUST show under its field, be tied to the field by `aria-describedby`, and move the focus to the first wrong field.

_From 082-sign-in._

### 082-FR-015 — While a sign-in is on its way the main button MUST be disabled and show progress, and a second tap MUST send nothing.

_From 082-sign-in._

### 082-FR-016 — The dialog MUST show the message for the answer's code in the person's language — `invalid_credentials`, `too_many_attempts`, `account_suspended`, `maintenance`, offline (no answer while the device reports no connection), and the shared messages for a failed call while online and for any other code — in a region screen readers announce; the typed e-mail MUST stay, and the password MUST be cleared after `invalid_credentials`.

_From 082-sign-in._

### 082-FR-017 — After a successful sign-in the dialog MUST close and the role's landing (`/app/driver`, `/app/garage` for garage owner, receptionist and mechanic, `/app/admin`) MUST open, in the account's language.

_From 082-sign-in._

### 130-FR-004 — In the browser, an API call made through the app's HTTP client, outside the session calls (`/api/v1/auth/*`) and outside "who am I", that is answered 401 with code `sign_in_required` MUST first be renewed once from the cookie (one renewal shared by concurrent calls, whether or not the call carried a token) and repeated; when the renewal fails it MUST open the sign-in dialog over the current screen without changing the address, showing the line "Intră în cont ca să continui." under the brand line (modifies 082-FR-018). The live stream, which does not go through that client, keeps its own renew-and-reconnect and never opens the dialog.

_From 130-sign-in-gate._

### 082-FR-019 — When the app needs the session and holds no access token (a reload, a reopened browser), it MUST renew from the cookie before asking "who am I"; a failed renewal means signed out.

_From 082-sign-in._

### 082-FR-020 — "Ieși din cont" MUST call sign-out, forget the session in memory even when the call fails, and open Home.

_From 082-sign-in._

### 082-FR-022 — Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup.

_From 082-sign-in._

### 082-FR-023 — The seed MUST add, outside production, one account per role (driver; garage owner of a seeded garage; receptionist and mechanic of that garage; admin), one driver-and-garage account whose last role is `garage`, and one suspended driver, all with e-mails under `example.test` and the password `parola-de-test` in development and test, which MUST come from `SEED_PASSWORD` in every other environment, an unset or unknown `APP_ENV` included (refused without it); an account whose e-mail exists is left as it is, so running it twice changes nothing.

_From 082-sign-in._

### 080-FR-001 — `POST /api/v1/auth/sign-up` MUST take a name, an e-mail, a password and the interface language (`ro` or `en`); it MUST create, through the one `createAccount` use case, an account holding only the role `driver`, a `password` identity with the argon2id hash of the password, that language and the last role `driver`, with its audit entry and `account.created` event in the same transaction.

_From 080-sign-up._

### 080-FR-002 — A successful sign-up MUST answer 201 with an access token for the role `driver` in the body and set the refresh-token cookie of a new remembered session family, exactly as a remembered sign-in does, and set the account's last active time.

_From 080-sign-up._

### 080-FR-003 — The e-mail MUST be trimmed and stored lower-case; an e-mail that already belongs to any account, compared without regard to case and whatever that account's state, MUST answer 409 `email_taken` with the same body every time, and create nothing — also when two sign-ups for one e-mail race.

_From 080-sign-up._

### 080-FR-004 — The password MUST be 8 to 128 characters (code points) and not on the list of common passwords (compared without regard to case); otherwise the answer MUST be 400 `weak_password` with a field error on `password`, and nothing is created.

_From 080-sign-up._

### 080-FR-005 — A body without a name, an e-mail or a password, with values that are not text, with a name that is not 2 to 80 characters once trimmed, an e-mail longer than 254 characters or without text, "@" and a domain with a dot, control characters in the name or the e-mail, a language other than `ro` or `en`, or any other field, MUST answer 400; a sign-up not sent as JSON MUST be refused as 080-FR-015 says.

_From 080-sign-up._

### 080-FR-006 — Sign-up attempts with a valid body MUST be counted per network address in Redis; once an address has 10 within its hour, every further attempt from it MUST be refused with 429 `too_many_attempts` before anything is checked, until the hour that began with its first counted attempt ends. The address is keyed as 080-FR-016 says. When Redis cannot be reached or does not answer within 2 seconds, sign-up MUST proceed without the limit and log the failure.

_From 080-sign-up._

### 080-FR-007 — While maintenance mode reads as on, sign-up MUST answer 503 `maintenance` and create nothing.

_From 080-sign-up._

### 080-FR-008 — The password MUST never be logged; a refused sign-up MUST be logged with its code and no name, e-mail, password or address, and a created account with no personal data.

_From 080-sign-up._

### 080-FR-010 — Before sending, the sign-up dialog MUST check, through the shared task saving of `libs/overlays`, that the name has 2 to 80 characters, the e-mail is filled in and looks like an address, and the password has 8 to 128 characters; each problem MUST show under its field, tied to it by `aria-describedby`, with the focus on the first wrong field.

_From 080-sign-up._

### 080-FR-011 — While a sign-up is on its way the main button MUST be disabled and show progress, and a second tap MUST send nothing.

_From 080-sign-up._

### 080-FR-012 — The dialog MUST show the message for the answer's code in the person's language — `email_taken` and `too_many_attempts` (its own texts), `weak_password` under the password field, and the shared texts for `maintenance`, offline, a failed call and any other code — in a region screen readers announce; the typed name, e-mail and password MUST stay.

_From 080-sign-up._

### 080-FR-013 — After a successful sign-up the dialog MUST close and the driver landing `/app/driver` MUST open, in the interface language; the dialog MUST resolve with "signed in" like the sign-in dialog, so whoever opened it can go back to the action that asked for an account.

_From 080-sign-up._

### 080-FR-014 — Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup.

_From 080-sign-up._

### 080-FR-015 — A sign-up or a sign-in not sent as JSON (a form post, a text body) MUST be refused with 415 before its body is checked, and a body with a key naming the prototype chain (`__proto__`, `constructor`, `prototype`) MUST answer 400; neither sets a cookie.

_From 080-sign-up._

### 080-FR-016 — A network address MUST count as one client however it is written — an IPv4 address also in its IPv4-mapped IPv6 form, an IPv6 address in any spelling and without its zone id, grouped by its /64 — for the sign-up limit and for sign-in's per-address count alike; an address that cannot be read leaves the limit skipped, as an unreachable Redis does.

_From 080-sign-up._

### 020-FR-001 — The API MUST let a signed-in account change its own language with `PATCH /api/v1/me` and a body `{ "language": "ro" | "en" }`, in every role, and answer with that account's "who am I", the same shape `GET /api/v1/me` returns.

_From 020-account-language._

### 020-FR-002 — The change MUST be refused with 401 `sign_in_required` without a valid token, and with 403 `account_suspended` for a suspended account, leaving the account unchanged.

_From 020-account-language._

### 020-FR-003 — The change MUST accept only `ro` or `en`: any other value, a missing language or an extra field is refused with 400 `validation_failed` whose detail names the offending field, and nothing is saved.

_From 020-account-language._

### 020-FR-004 — The saved language MUST be the one `GET /api/v1/me` returns afterwards; an account that never chose has `ro`.

_From 020-account-language._

### 020-FR-005 — A change to a different language MUST add one audit entry on the account (an update of the field `language`, old value to new value), by the account in the role it is using, saved in the same transaction as the change; setting the same language MUST add none.

_From 020-account-language._

### 130-FR-002 — The public list MUST be exactly: `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/sign-out`, `GET /health/live`, `GET /health/ready` (outside the `/api/v1` prefix), and `POST /api/v1/webhooks/brevo`, which checks Brevo's own bearer secret and is left out of the OpenAPI document (it arrived with ST-194; its own integration spec boots the app-wide check); a test MUST enumerate every route the API serves, call each without a token, and fail when the set of routes not answering 401 `sign_in_required` differs from this list.

_From 130-sign-in-gate._

### 130-FR-003 — The suspended (403 `account_suspended`) and capability (404) answers of the actor check MUST stay as they are for gated routes.

_From 130-sign-in-gate._

### 130-FR-005 — When the person signs in, or switches to sign-up and creates an account, in a dialog opened by FR-004, the dialog MUST close without navigating and the refused call MUST be sent again once with the new access token, its answer going to the code that made the call; a repeated call that is refused again fails with that answer and opens no further dialog.

_From 130-sign-in-gate._

### 130-FR-006 — When a dialog opened by FR-004 is closed without signing in, the refused call MUST fail with its original 401 `sign_in_required`; the shared task saving MUST map `sign_in_required` to "Intră în cont ca să continui." for every form, once, so a form keeps its values and shows that line in its message region with no text of its own.

_From 130-sign-in-gate._

### 130-FR-007 — There MUST be at most one sign-in dialog open: while any sign-in dialog is open (opened by FR-004, or by "Autentificare" / "Cont"), a further refused call waits on it and is repeated after sign-in, or failed when it closes without one.

_From 130-sign-in-gate._

### 130-FR-008 — "Autentificare" and "Cont" MUST keep opening the dialog without the reason line and, after sign-in or sign-up, open the person's landing (082-FR-017, 080-FR-013 unchanged), also when a refused call was waiting on that dialog.

_From 130-sign-in-gate._

### 130-FR-009 — The gate MUST NOT open on the server-rendered page.

_From 130-sign-in-gate._

### 130-FR-010 — Every new text MUST exist in Romanian and English, and Romanian words joined by a hyphen MUST use U+2011.

_From 130-sign-in-gate._

### 128-FR-001 — `POST /api/v1/auth/sign-out-everywhere` with a refresh-token cookie that would renew MUST delete every refresh token of that account and write one audit entry (action `delete`, subject `account` = the account, actor = the account with its last role, kind `signed_out_everywhere`) in one transaction, clear the cookie and answer 204.

_From 128-sign-out._

### 128-FR-002 — Sign-out on all devices with no, an unknown, an expired or a reused (outside the 20-second grace) refresh token MUST answer 401 `sign_in_required`, clear the cookie, and revoke no other family than refresh would.

_From 128-sign-out._

### 128-FR-003 — After sign-out on all devices, `POST /api/v1/auth/refresh` with any refresh token the account held MUST answer 401.

_From 128-sign-out._

### 128-FR-004 — After the revocation is saved, the API MUST publish a `session.revoked` live event to `account:{accountId}`; a failed publish MUST be logged and MUST NOT change the answer.

_From 128-sign-out._

### 128-FR-005 — When "Ieși din cont" signs this tab out, the web app MUST tell the other tabs of the same browser, and each of them MUST forget its session, close its live connection and open Home.

_From 128-sign-out._

### 128-FR-006 — Every dashboard (driver, garage — owner, receptionist, mechanic — and admin) MUST show "Ieși de pe toate dispozitivele" / "Sign out on all devices" in its account block, under "Ieși din cont".

_From 128-sign-out._

### 128-FR-007 — Choosing it MUST open a confirmation dialog titled "Ieși de pe toate dispozitivele?" / "Sign out on all devices?" with the text "Va trebui să te autentifici din nou peste tot." / "You will need to sign in again everywhere." and the buttons "Ieși" / "Sign out" and "Renunță" / "Cancel"; "Renunță" or closing the dialog MUST change nothing.

_From 128-sign-out._

### 128-FR-008 — Confirming MUST close the tab's live connection, forget the session in memory, call sign-out on all devices, tell the other tabs (FR-005) and open Home, also when the call fails.

_From 128-sign-out._

### 128-FR-009 — On a `session.revoked` live message the dashboard MUST sign the tab out as "Ieși din cont" does and open Home.

_From 128-sign-out._

### 128-FR-010 — A sign-out call (this device or all devices) that gets no answer, a network error or a 5xx MUST be kept pending in the browser and sent again on the browser's `online` event and before the next session load, sign-in or sign-up; a 2xx or 4xx answer MUST clear it.

_From 128-sign-out._

## Retired

- `079-FR-017` — superseded by `082-FR-021` (2026-10-04)

- `082-FR-013` — superseded by `080-FR-009` (2026-10-04)

- `079-FR-011` — superseded by `130-FR-001` (2026-10-05)
- `082-FR-018` — superseded by `130-FR-004` (2026-10-05)
