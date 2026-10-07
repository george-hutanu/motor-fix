---
capability: accounts
updated: 2026-10-07
features:
  - 079-account-model
  - 082-sign-in
  - 080-sign-up
  - 020-account-language
  - 130-sign-in-gate
  - 128-sign-out
  - 394-role-switch
  - 132-sign-up-consent
  - 563-expired-token-sweep
  - 083-sign-in-apple-google
  - 564-session-reload-role-race
  - 393-whatsapp-phone-sign-in
  - 536-gate-dialog-dashboard
  - 569-auth-events-through-event-port
  - 160-admin-dashboard-menu
  - 028-driver-dashboard-views
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

### 028-FR-005 — A signed‑out visit to a dashboard view address MUST end on Home with the sign‑in dialog open and keep that address; after signing in, that address MUST open when the area guard admits it (it is under the landing of the role the account signs in with), otherwise the landing opens as today; the kept address never changes the role used last. Closing the dialog without signing in MUST drop the kept address; the router URL (path, query and fragment) is kept only when it starts with `/` and not `//` or `/\`; it is opened only through the router (an address of this site, never a browser location change); it uses the one return key the provider sign‑in already uses (083‑FR‑003), the last writer winning. Modifies 082‑FR‑021 (after signing in, the landing opened). A session that expires mid‑visit is not this rule: a view change reads the session in memory, and a refused call is answered by the dialog over the screen (ST-130, unchanged).

_From 028-driver-dashboard-views._

### 160-FR-007 — The frame's menu MUST show only the entries the role in use may open according to the capabilities table and whose view is released; there MUST be no "Vezi ca" demo buttons. Each view MUST carry a release mark; an unreleased view MUST be absent from the menu and the tab bar, and its address MUST open "Panou" (the existing fall-through) for every role the admin area admits (today `admin` only; any other role is sent to its own dashboard by FR-005). At this story's release "Panou", "Service‑uri" and "Setări" are released and "Utilizatori", "Recenzii raportate", "Mărci și lucrări" and "Asistent AI" are not; the story that builds a view flips its mark. The mark is one line per view in the view list, with a test for a hidden entry.

_From 160-admin-dashboard-menu._

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

### 393-FR-012 — The sign-in dialog MUST offer, under its main button and a "sau" divider, the button "Continuă cu telefonul" (English "Continue with phone"); tapping it MUST show the phone step inside the same dialog: the field "Număr de telefon" with "+40" filled in (`type=tel`, `autocomplete=tel`), "Ține‑mă autentificat" ticked by default, the main button "Trimite codul", and a link back to e-mail and password. Before sending, the dialog MUST check that the number is a possible phone number and show the problem under the field as 082-FR-014 does (modifies 080-FR-009, which lists the dialog's controls under its main button).

_From 393-whatsapp-phone-sign-in._

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

### 130-FR-002 — The public list MUST be exactly: `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/sign-out`, `GET /health/live`, `GET /health/ready` (outside the `/api/v1` prefix), `POST /api/v1/webhooks/brevo`, which checks Brevo's own bearer secret and is left out of the OpenAPI document (it arrived with ST-194; its own integration spec boots the app-wide check), and the two cookie-authenticated routes added since, `POST /api/v1/auth/sign-out-everywhere` (128-FR-001) and `POST /api/v1/auth/roles/switch` (394-FR-001); a test MUST enumerate every route the API serves, call each without a token, and fail when the set of routes not answering 401 `sign_in_required` differs from this list.

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

### 569-FR-003 — After the transaction of a completed password reset or a sign-out on all devices commits, the API MUST publish one `session.revoked` live message to `account:{accountId}` through one method of the sign-in service that both flows call; a failed publish MUST be logged and MUST NOT change the answer (extends `128-FR-004` to the reset). The order of this message and the password_changed e-mail is not specified.

_From 569-auth-events-through-event-port._

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

### 394-FR-001 — `POST /api/v1/auth/roles/switch` with `{ "role": <role> }` and the browser's refresh cookie, for an account that holds that role, MUST store it as `ACCOUNT.last_role` and answer 200 with `{ "accessToken" }`, a new access token for that role, renewing the session as a refresh does. (Moved from `/me/roles/switch` by pr-tester lap 4: a switch from an access token alone kept a signed-out session alive.)

_From 394-role-switch._

### 394-FR-002 — Switching to a role the account does not hold MUST answer 404 and change nothing; a body without a valid role MUST answer 400 `validation_failed`.

_From 394-role-switch._

### 394-FR-003 — A switch MUST write no audit entry and send no notification.

_From 394-role-switch._

### 394-FR-004 — `POST /api/v1/auth/refresh` MAY carry `{ "role": <role> }`; the new access token MUST be for that role when the account holds it, otherwise for the role it is issued for today; a refresh MUST NOT change `last_role`.

_From 394-role-switch._

### 394-FR-005 — The dashboard frame of an account with two or more roles MUST show one chip per role it holds, labelled "Șofer", "Service", "Recepție", "Mecanic", "Admin" (EN "Driver", "Garage", "Front desk", "Mechanic", "Admin"), in a group labelled "Rolul tău" / "Your role", the role in use pressed; an account with one role MUST show no chips.

_From 394-role-switch._

### 394-FR-006 — Tapping a chip of another role MUST switch to it (FR-001) with the tab's session, then reload the account, reopen the live connection and open that role's dashboard, without a new sign-in.

_From 394-role-switch._

### 394-FR-007 — A switch that fails (no answer, an error answer) MUST show the toast "Nu am putut schimba rolul. Încearcă din nou." / "Could not switch the role. Try again." and keep the tab's role, token and dashboard.

_From 394-role-switch._

### 394-FR-008 — The web app's token renewal MUST send the role its tab is showing (FR-004), so a tab keeps its role until reloaded.

_From 394-role-switch._

### 394-FR-009 — A switch whose refresh cookie is missing, expired, or ended by a sign-out on this device or on every device MUST answer 401 and change nothing; a request that is not JSON MUST answer 415.

_From 394-role-switch._

### 132-FR-001 — Creating an account MUST require a consent naming the terms version and the privacy notice version the person accepted. When either is missing or is not the current version (TERMS_VERSION, PRIVACY_VERSION in `@motor-fix/contracts`), creation MUST be refused with 400 `consent_required` (error field `consent`) and nothing MUST be written. This holds for every caller of the shared account creation, whatever the sign-in method.

_From 132-sign-up-consent._

### 132-FR-002 — Creating an account MUST store, in the same transaction as the account, two consent rows, kind `terms` and `privacy_notice`, each with the text version, the language the account is created with, the sign-in method of the identity created, and the time of acceptance.

_From 132-sign-up-consent._

### 132-FR-003 — Creating an account MUST record in the audit history, in the same transaction, one "consent given" entry by the new account (field `consent`) whose value carries both versions.

_From 132-sign-up-consent._

### 132-FR-004 — `POST /api/v1/auth/sign-up` MUST take a `consent` object `{ termsVersion, privacyVersion }` and pass it to the account creation; without it the call MUST answer 400 `consent_required` before any account is written.

_From 132-sign-up-consent._

### 132-FR-005 — The sign-up form MUST show, above its main button, a required tick, unticked at first, with the text "Accept Termenii de utilizare și am citit Nota de informare privind datele personale." (EN "I accept the Terms of use and have read the Privacy notice."), whose two titles link to `/{lang}/terms` and `/{lang}/privacy` in a new tab.

_From 132-sign-up-consent._

### 132-FR-006 — Sending the sign-up form with the tick empty MUST show "Bifează pentru a continua." (EN "Tick to continue.") under the tick, move the focus to it, and send nothing; with the tick set the request MUST carry the current versions.

_From 132-sign-up-consent._

### 132-FR-007 — The tick MUST be one component that any form creating an account can place above its main button as a form control.

_From 132-sign-up-consent._

### 132-FR-008 — `/{lang}/terms` and `/{lang}/privacy` MUST show the terms of use and the privacy notice in the address's language to anyone without an account, rendered on the server, with the text version and a notice that the text is a draft pending legal review; both MUST be listed in the sitemap for both languages, and MUST NOT scroll sideways on a 320 px phone.

_From 132-sign-up-consent._

### 563-FR-001 — The route sweep MUST call every route outside the public list with an access token that is genuine in every respect (signed with the application's secret, for an existing active account, with a valid role) except that its expiry is in the past; its role is `driver`, a role the account holds.

_From 563-expired-token-sweep._

### 563-FR-002 — For every such route the sweep MUST require the same refusal as for a missing session: status 401, code `sign_in_required`, no cookie set.

_From 563-expired-token-sweep._

### 563-FR-003 — The expired-token case MUST iterate the same route list as the existing cases (derived from the API description at test time), so a new gated route is covered without editing the sweep.

_From 563-expired-token-sweep._

### 563-FR-004 — The sweep MUST show that the account and signing used for the expired token are otherwise accepted: an unexpired token for the same account gets 200 from `GET /api/v1/me`, so a refusal cannot be mistaken for a refusal of an unknown account or a bad signature (scenario 2 of story 1).

_From 563-expired-token-sweep._

### 563-FR-005 — The account the sweep creates for this purpose MUST be created by the test itself and MUST NOT depend on seed data or on another test's state; the file takes `databaseTurn` (`@motor-fix/domain/testing`) like the other account-writing API tests, so a suite emptying the account tables cannot run meanwhile.

_From 563-expired-token-sweep._

### 083-FR-001 — The sign-in and sign-up tasks of the dialog MUST show, under their main button, a divider with the word "sau" (EN "or") and a 50 px ghost button per configured provider, Apple first: "Continuă cu Apple" / "Continuă cu Google" (EN "Continue with Apple" / "Continue with Google"), each with its provider's mark. The web MUST learn which providers are configured from a public `GET /api/v1/auth/providers` answering `{ apple, google }` booleans; an unconfigured provider MUST show no button, and with neither the divider MUST NOT show.

_From 083-sign-in-apple-google._

### 083-FR-002 — A provider MUST count as configured only when all its keys and the web address are set: Google `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; Apple `APPLE_SERVICES_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`; both `PUBLIC_WEB_URL`. Its return address MUST be `PUBLIC_WEB_URL` + `/api/v1/auth/oauth/{provider}/callback`. When `APP_ENV` is `development` or `test`, `GOOGLE_ISSUER` and `APPLE_ISSUER` MAY point a provider at a stand-in OpenID issuer; `staging` and `production` MUST ignore them and always use `https://accounts.google.com` and `https://appleid.apple.com`. No key value MUST ever be logged or answered.

_From 083-sign-in-apple-google._

### 083-FR-003 — Tapping a provider button MUST send any sign-out still waiting, keep the address to return to in the tab when an action asked for sign-in, and open `GET /api/v1/auth/oauth/{provider}?language={ro|en}&remember={true|false}` in the page. That route MUST redirect to the provider's authorisation with the authorisation code flow, PKCE (S256), a random state and a random nonce, keep the flow on the server for at most 10 minutes, and bind it to the browser with an `HttpOnly`, `Secure` cookie scoped to `/api/v1/auth/oauth`. An unconfigured provider MUST answer 404.

_From 083-sign-in-apple-google._

### 083-FR-004 — The provider's return (`GET` for Google, the form `POST` for Apple, at `/api/v1/auth/oauth/{provider}/callback`) MUST be accepted only when its state equals the browser's flow cookie and names a stored flow of that provider, which is then used up. It MUST exchange the code with the PKCE verifier (Apple's client secret being a short-lived ES256 token signed with its key), and accept the ID token only when its signature verifies against the provider's published keys and its issuer, audience (the client id), expiry and nonce match. Every outcome MUST redirect to `/{language}/sign-in/return?result=…&provider=…` on the web (language `ro` when no flow was found) and clear the flow cookie.

_From 083-sign-in-apple-google._

### 083-FR-005 — The returned person MUST be matched first on (method, provider subject). With no match, when the provider marks the e-mail as verified and an account holds that e-mail, and that account has confirmed the e-mail itself, the provider identity MUST be linked to that account and the audit history MUST record "sign-in method linked" (field `identity`, value the method), in one transaction. An unverified provider e-mail MUST NOT link, and neither may any e-mail of an account that never confirmed it: both return `email_taken` and keep nothing. A provider that cannot be reached when the flow starts MUST return `failed` the same way, never an error page.

_From 083-sign-in-apple-google._

### 083-FR-006 — A matched or linked account MUST be signed in as an e-mail sign-in is: refused for a suspended account (`account_suspended`) and, under maintenance, for an account not holding `admin` (`maintenance`); otherwise a new session for the role in use, chosen as e-mail sign-in chooses it (the last role when held), with the refresh cookie (30 days when "Ține-mă autentificat" was ticked) and the result `signed-in`. A deleted account MUST answer `provider_failed`.

_From 083-sign-in-apple-google._

### 083-FR-007 — With no matched account, under maintenance the return MUST be `maintenance` and nothing kept; when the provider's e-mail is not verified and another account already holds it, the return MUST be `email_taken` and nothing kept. Otherwise the server MUST keep a pending sign-up for at most 10 minutes (provider, subject, e-mail, whether verified, name, "keep me signed in"), bound to the browser by an `HttpOnly`, `Secure` cookie, and return `consent`. Apple's name, sent only on the first approval in its form's `user` field, MUST be taken from there; a hidden-e-mail relay address MUST be kept as the e-mail.

_From 083-sign-in-apple-google._

### 083-FR-008 — `GET /api/v1/auth/oauth/pending` MUST answer the pending sign-up's provider, name and e-mail to that browser (404 without one). `POST /api/v1/auth/oauth/complete`, JSON only, with `{ name, language, consent }`, MUST create the account through the shared `createAccount`: role `driver` only, identity (provider, subject), the provider's e-mail, verified only when the provider said so, the consent rows with the provider as method, the audit entries and `account.created` with the method; then use up the pending sign-up and answer a session as sign-up does. Without the current consent it MUST answer 400 `consent_required` and create nothing; without a live pending sign-up 400 `provider_failed`; an e-mail taken since 409 `email_taken`; under maintenance 503 `maintenance`.

_From 083-sign-in-apple-google._

### 083-FR-009 — The web's return address `/{lang}/sign-in/return` MUST show Home with: for `signed-in`, the session renewed from the cookie, then the kept address or the role's landing; for `consent`, the new-person step (provider named, name prefilled and editable, the `mf-consent` tick, "Creează contul", "Anulează"), which on success goes on as `signed-in` and on leaving closes on Home; for `cancelled`, the sign-in dialog with no error; for `failed`, the dialog with "Nu am putut contacta {provider}. Încearcă din nou sau intră cu e-mail sau telefon." (EN "We could not reach {provider}. Try again, or use e-mail or phone."); for `maintenance` and `suspended`, the dialog with the existing messages for those codes; for `email_taken`, the dialog with "Există deja un cont cu acest e-mail. Intră cu e-mail și parolă." (EN "An account already uses this e-mail. Sign in with e-mail and password."). A 409 `email_taken` at the new-person step MUST show the same text there.

_From 083-sign-in-apple-google._

### 083-FR-010 — A provider's refusal or the person's cancel at the provider (`access_denied`, `user_cancelled_authorize`) MUST return `cancelled`; a discovery, key or token call to the provider that does not answer within 5 seconds each, or any failed check, MUST return `failed`; neither MUST create, link or sign in anything, and each MUST be logged with its reason and the provider, never a token, code or e-mail.

_From 083-sign-in-apple-google._

### 083-FR-011 — Every new text MUST exist in Romanian and English, and the buttons, divider and new-person step MUST NOT scroll sideways on a 320 px phone.

_From 083-sign-in-apple-google._

### 564-FR-001 — An answer to a re-read of the signed-in account MUST be dropped when a role switch or a new session (sign-in, sign-up, password reset, provider sign-up) completed while the read was in flight; the account on screen stays what it was. A token renewal for the same session MUST NOT drop it.

_From 564-session-reload-role-race._

### 564-FR-002 — A re-read that no role switch or new session overtook MUST keep its contract: the answer replaces the account, a failed read keeps it, and an answer after a sign-out restores nothing.

_From 564-session-reload-role-race._

### 393-FR-001 — `POST /api/v1/auth/phone-code` MUST take a phone number and the interface language (`ro` or `en`), be reachable without a session, normalise the number to E.164 (a Romanian national number such as `0722123456` becomes `+40722123456`; a number starting with `+` or `00` keeps its country), refuse with 400 a value that is not a possible phone number (after normalisation, `+` then 7 to 15 digits, the first not 0), and, when allowed, generate a 6-digit code from a cryptographic random source, send it by WhatsApp through Brevo with the registered SIGN_IN_CODE template in that language, and store it as described in FR-003. It MUST answer the same body (202, no content that reveals whether an account holds the number) for a known and an unknown number.

_From 393-whatsapp-phone-sign-in._

### 393-FR-003 — A sign-in code MUST be stored in PostgreSQL, at most one live code per E.164 number, as: the number, a hash of the code (never the code), when it expires (5 minutes after it was sent), how many wrong attempts it took, and whether it was used or voided. Issuing a new code for a number MUST void the previous one in the same statement, so two concurrent requests leave exactly one live code.

_From 393-whatsapp-phone-sign-in._

### 393-FR-004 — A code MUST be refused before it is sent when the number had a code sent less than 60 seconds ago (429 `too_many_attempts`), when the number had 5 codes sent within the hour that began with its first (429 `too_many_attempts`), or when the requesting network address, keyed as 080-FR-016 says, had 20 code requests within the hour that began with its first (429 `too_many_attempts`); each window is fixed from its first request. These counts MUST live in Redis as counts only; a request answered `whatsapp_failed` MUST NOT count toward the number's hourly share. When Redis cannot be reached or does not answer within 2 seconds, the request MUST proceed without these limits and log the failure.

_From 393-whatsapp-phone-sign-in._

### 393-FR-005 — When Brevo refuses the message, does not answer within 5 seconds, WhatsApp sending is off, the number is outside the non-production allow-list, or the SIGN_IN_CODE template is not approved, the request MUST answer 502 `whatsapp_failed`, store no code, and log the kind of failure without the number.

_From 393-whatsapp-phone-sign-in._

### 393-FR-006 — `POST /api/v1/auth/phone-sign-in` MUST take the phone number, the code, "keep me signed in" (true by default) and, optionally, a name, the consent (ST-132's `termsVersion` and `privacyVersion`) and the interface language (`ro` or `en`, default `ro`, used only for a new account), be reachable without a session, and check the code against the number's current code (the one not used and not voided), in this order: a code with 5 wrong attempts MUST answer 429 `too_many_attempts` without checking the code (it stays until a new code voids it); a code past its expiry MUST answer 410 `code_expired` whatever was typed; then no current code or a hash mismatch MUST answer 401 `code_invalid` (a mismatch counts one wrong attempt). Whatever the answer, the body MUST NOT reveal whether an account holds the number before the right code is given.

_From 393-whatsapp-phone-sign-in._

### 393-FR-007 — With the right code, the number MUST be matched first to a `whatsapp_phone` sign-in identity whose subject is that E.164 number, then to an account whose phone is that number and whose phone is verified. A match MUST open a session for the account's role in use exactly as `POST /api/v1/auth/sign-in` does (082-FR-001, 082-FR-007: access token in the body, refresh-token cookie with the "keep me signed in" choice, last active time set), for an account of any role, and mark the code used in the same transaction. A suspended account MUST answer 403 `account_suspended`; a deleted account MUST answer 409 `phone_taken`; both spend the code.

_From 393-whatsapp-phone-sign-in._

### 393-FR-008 — With the right code and no matching account, a request without a name or without the current consent MUST answer 200 with `{ "next": "profile" }` and leave the code live (the right code does not count as an attempt); a request with a name of 2 to 80 trimmed characters and the current consent MUST create, through the one `createAccount` use case, an account holding only the role `driver`, that name, the request's language, the phone in E.164 with `phone_verified_at` set now, a `whatsapp_phone` identity whose subject is the number, the `terms` and `privacy_notice` consent rows with method `whatsapp_phone`, its "account created" audit entry (method `whatsapp_phone`) and its `account.created` event, mark the code used, and open a remembered-or-not session for `driver` as 080-FR-002 does, all in one transaction; when the number matches an account (FR-007), a name and consent in the body are ignored and the account is signed in; a stale consent MUST answer 400 `consent_required` and create nothing. A number another account already holds (unique) MUST answer 409 `phone_taken` and create nothing.

_From 393-whatsapp-phone-sign-in._

### 393-FR-009 — A code MUST sign in or create an account at most once: two concurrent `phone-sign-in` calls with the same right code MUST open exactly one session, the other answering 401 `code_invalid`. Codes and sign-ins MUST NOT be written to the audit history; the "account created" entry is the only audit of this flow.

_From 393-whatsapp-phone-sign-in._

### 393-FR-010 — While maintenance reads as on, `phone-code` MUST answer 503 `maintenance` and send nothing unless the number matches (as FR-007 matches) an account holding `admin` (that this tells a caller a number is an admin's is accepted, as for the e-mail sign-in under maintenance); `phone-sign-in` with the right code MUST answer 503 `maintenance` for a non-admin account and for a new number, spending the code, and sign an admin in.

_From 393-whatsapp-phone-sign-in._

### 393-FR-011 — Both routes MUST refuse a body not sent as JSON and a body with a key naming the prototype chain as 080-FR-015 says, answer 400 for a missing or non-text phone, a code that is not exactly 6 digits, a language other than `ro` or `en`, a name outside 2 to 80 characters or holding control characters, or any other field; the code and the phone number MUST never be logged, and a refused call MUST be logged with its code only. Both routes MUST join the API's public-route list.

_From 393-whatsapp-phone-sign-in._

### 393-FR-013 — After the code is sent, the dialog MUST show the code step: the number it went to, a 6-digit code field (`inputmode=numeric`, `autocomplete=one-time-code`), a countdown from 5:00, the main button "Intră în cont", and "Trimite din nou", disabled for 60 seconds after each send and after the countdown reaches 0:00 offered as the only action; entering the sixth digit MUST NOT send the code by itself: the person taps "Intră în cont". While a request is on its way the main button MUST be disabled with progress and a second tap MUST send nothing. Each step MUST move keyboard focus to its first field and announce its heading to screen readers, and every field MUST have a visible label.

_From 393-whatsapp-phone-sign-in._

### 393-FR-014 — The dialog MUST show, in the person's language and in a region screen readers announce, the message for each answer: `code_invalid` — "Codul nu este corect." with the attempts left; `code_expired` — "Codul a expirat. Cere un cod nou."; `too_many_attempts` — one text for too many codes or attempts, asking to wait or ask for a new code; `whatsapp_failed` — "Nu am putut trimite codul pe WhatsApp." with a link to sign in with e-mail and password (and to Google and Apple once those exist); `account_suspended`, `phone_taken`, `maintenance`, offline and the shared messages for a failed call and any other code as 082-FR-016 does. The typed number MUST stay; the code field MUST be cleared after `code_invalid`.

_From 393-whatsapp-phone-sign-in._

### 393-FR-015 — When the answer is `{ "next": "profile" }`, the dialog MUST show the profile step in the same dialog: "Nume", the shared consent control (ST-132) and the main button "Creează contul"; it MUST check the name's length and the tick as 080-FR-010 does before sending, and send the same code with the name and the consent. After a session is opened by any step, the dialog MUST close and behave as 082-FR-017 and 080-FR-013 say: the role's landing opens (`/app/driver` for a new account) in the account's language, or the dialog resolves "signed in" to the action that opened it.

_From 393-whatsapp-phone-sign-in._

### 393-FR-016 — Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup. The screens MUST hold at 320 px and 390 px phones, tablet and desktop, light and dark, without sideways scrolling.

_From 393-whatsapp-phone-sign-in._

### 393-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the 5-minute expiry; single use, also under two concurrent uses; the 5-attempt cap; the 60-second, 5-per-hour and per-address limits and their fail-open when Redis is down; a new number creating `driver` only, with its identity, consent, audit entry and event; a garage owner's number signing in to the garage account; a suspended and a deleted account's number; Brevo failure answering `whatsapp_failed` and storing nothing; maintenance; the number normalisation. A Playwright end-to-end test with a Brevo stub MUST sign in with a new number: tap the phone option, send the code, read it from the stub, enter it, fill in the name and the tick, and land on the driver dashboard.

_From 393-whatsapp-phone-sign-in._

### 536-FR-001 — While a sign-in dialog opened by 130-FR-004 is open, the dashboard frame MUST keep showing the account that was on screen when the refused call failed (name, role chips, dashboard, menu items, invite button), even though the failed renewal has forgotten the session; the kept account MUST be let go when that dialog closes, and at sign-out, so only the account the session holds is shown afterwards. Access decisions (the area guard, the views' guard, the token) MUST keep reading the session's own account, never the kept one.

_From 536-gate-dialog-dashboard._

### 569-FR-001 — A completed password reset MUST record one domain event of the new kind `account.password_reset` (added to the typed event catalogue, `257-FR-006`) through the event port, inside the same transaction that takes the link, replaces the password, deletes the account's refresh tokens and writes the audit entry; its subject and audience are the account, and its payload is exactly `{ accountId }`.

_From 569-auth-events-through-event-port._

### 569-FR-002 — A password reset that is refused (link unknown, used, expired or taken by a concurrent save; weak password; maintenance for a non-admin), or whose transaction fails for any reason (the event port included), MUST record no `account.password_reset` event, and the transaction's other writes MUST roll back with it; the answer to the client stays what it is today.

_From 569-auth-events-through-event-port._

### 569-FR-004 — The password_changed e-mail, the audit entry, the sessions revoked and the reset's answer MUST stay as ST-127 specified them; the API contract (openapi.json) and the web app MUST NOT change.

_From 569-auth-events-through-event-port._

## Retired

- `079-FR-017` — superseded by `082-FR-021` (2026-10-04)

- `082-FR-013` — superseded by `080-FR-009` (2026-10-04)

- `079-FR-011` — superseded by `130-FR-001` (2026-10-05)
- `082-FR-018` — superseded by `130-FR-004` (2026-10-05)

- `080-FR-009` — superseded by `393-FR-012` (2026-10-06)

- `128-FR-004` — superseded by `569-FR-003` (2026-10-07)

- `079-FR-018` — superseded by `160-FR-007` (2026-10-07)

- `082-FR-021` — superseded by `028-FR-005` (2026-10-07)
