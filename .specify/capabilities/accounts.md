---
capability: accounts
updated: 2026-10-17
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
  - 765-reload-after-failed-switch
  - 028-driver-dashboard-views
  - 089-add-a-car
  - 261-maintenance-mode
  - 097-garage-dashboard
  - 030-new-account-empty-states
  - 139-edit-my-details
  - 244-analytics-news-consent
  - 243-terms-privacy
  - 1203-legal-operator
  - 250-launch-analytics-events
  - 1169-prefetch-intent
  - 029-overview-panels-own-data
  - 366-assistant-privacy
  - 291-saved-garages
  - 066-suspended-garages
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

### 139-FR-003 — `GET /api/v1/me` MUST also return `phone`, `phoneConfirmed`, `pendingEmail` (the address of a live e-mail change, else null) and `hasPassword` (whether a `password` identity exists), so the panel can show the pending line, "Neconfirmat" and "Setează o parolă" without another call (modifies 097-FR-005).

_From 139-edit-my-details._

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

### 261-FR-005 — The existing `MAINTENANCE` port (`libs/domain/src/auth/ maintenance.ts`), which sign-in, sign-up, phone sign-in, OAuth and password reset already consult, MUST be bound to the real rule, so those services refuse non-admins as their requirements already state (082-FR-006, 080-FR-007, 083-FR-006, 083-FR-007, 083-FR-008, 393-FR-010, 569-FR-002) and the port's "reads as off until the rule exists" clause ends.

_From 261-maintenance-mode._

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

### 139-FR-004 — `PATCH /api/v1/me` MUST also accept `name` (2 to 80 characters once trimmed, no control characters) and `city` (null, or 2 to 60 characters once trimmed, no control characters; a blank city after trimming is stored as null), each optional, beside `language`; it MUST save the given fields in one transaction with one audit entry per field whose value changed (field, old value, new value, by the account in the role it is using) and one `account.updated` event naming the account and the changed fields, and answer "who am I"; a body with no change writes nothing (modifies 020-FR-001, 020-FR-005).

_From 139-edit-my-details._

### 020-FR-002 — The change MUST be refused with 401 `sign_in_required` without a valid token, and with 403 `account_suspended` for a suspended account, leaving the account unchanged.

_From 020-account-language._

### 020-FR-003 — The change MUST accept only `ro` or `en`: any other value, a missing language or an extra field is refused with 400 `validation_failed` whose detail names the offending field, and nothing is saved.

_From 020-account-language._

### 020-FR-004 — The saved language MUST be the one `GET /api/v1/me` returns afterwards; an account that never chose has `ro`.

_From 020-account-language._

### 139-FR-004 — `PATCH /api/v1/me` MUST also accept `name` (2 to 80 characters once trimmed, no control characters) and `city` (null, or 2 to 60 characters once trimmed, no control characters; a blank city after trimming is stored as null), each optional, beside `language`; it MUST save the given fields in one transaction with one audit entry per field whose value changed (field, old value, new value, by the account in the role it is using) and one `account.updated` event naming the account and the changed fields, and answer "who am I"; a body with no change writes nothing (modifies 020-FR-001, 020-FR-005).

_From 139-edit-my-details._

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

### 243-FR-013 — The texts MUST live in code with the pages that show them, not in the interface language files, add no dependency, and change no page layout: `/{lang}/terms` and `/{lang}/privacy` show the text in the address's language to anyone without an account, rendered on the server and listed in the sitemap for both languages; the page shows the title, the version label and date, and the sections (132-FR-008's layout minus the draft note), and MUST NOT scroll sideways on a 320 px phone in either language.

_From 243-terms-privacy._

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

### 765-FR-001 — An answer to a reload sent while a role switch's token is in place MUST be dropped, whether it arrives before or after the switch ends; the switch's own account load decides what shows.

_From 765-reload-after-failed-switch._

### 765-FR-002 — A reload sent before a switch put its token in MUST still land when the switch fails.

_From 765-reload-after-failed-switch._

### 089-FR-006 — When the saving account does not hold the role `driver`, the same transaction MUST grant it through the existing grant use case (079-FR-007), whose audit entry records the role; an account that holds it gets nothing added, so a second car never adds the role again. The 201 carries no role flag: after a save from the garage-side entry the web app re-reads "who am I", which shows the new role chip.

_From 089-add-a-car._

### 089-FR-010 — The garage-side dashboard's account block MUST show "Adaugă o mașină" / "Add a car" for an account that does not hold the `driver` role, opening the same dialog; after a save that added the role, the app MUST re-read "who am I" so the "Șofer" / "Driver" chip appears and the switch opens `/app/driver`. An account that already holds `driver` sees no entry there (it adds cars on its driver dashboard).

_From 089-add-a-car._

### 029-FR-010 — Panou's panels MUST come from one registry with, per panel: key (`active_request`, `live`, `quotes`, `cars`, `mileage`, `spend`, `history`, `saved`), default place, width (one column or full width) and release flag; the default order and widths are 030-FR-001's. Panels of unshipped features keep their empty states (030-FR-004..006, 030-FR-011); panels behind an off release flag (`live`, `mileage`, `spend`) are not drawn and the grid closes the gap.

_From 029-overview-panels-own-data._

### 030-FR-002 — For a driver with no active request (a request is active while its status is neither `done` nor `closed`), the first row MUST replace Cererea activă with the invitations: "Adaugă prima ta mașină" + button "Adaugă o mașină" when the driver has no car, and "Caută un service pentru mașina ta" + button "Caută un service" always.

_From 030-new-account-empty-states._

### 030-FR-003 — "Adaugă o mașină" MUST open the shell's add-car dialog; "Caută un service" and "Caută altele" MUST open Home (`/<lang>`).

_From 030-new-account-empty-states._

### 030-FR-004 — A panel whose data has loaded and is empty MUST show exactly this text, in the active language, and at most the one action named:

_From 030-new-account-empty-states._

### 030-FR-005 — Every empty state MUST be rendered by one shared empty-state component: an icon, one or two sentences, at most one button; its smallest text MUST be 12 px.

_From 030-new-account-empty-states._

### 029-FR-008 — When the cars call fails, the cars panel alone MUST show "Nu am putut încărca mașinile. Reîncearcă." / "We could not load your cars. Try again." with a "Reîncearcă" / "Try again" button that reads the cars again; a retry puts the panel back to its skeleton until the answer settles; the first row follows the requests alone (with no active request: the invitations, the "add a car" one only once the cars have loaded and are none), and the other panels keep their own states.

_From 029-overview-panels-own-data._

### 030-FR-007 — For a driver with at least one car and no active request, the first row MUST show only the search invitation; the due item beside it is ST-31's.

_From 030-new-account-empty-states._

### 030-FR-008 — A car saved from the add-car dialog MUST take the first row and Mașinile mele (panel and view) out of their empty state without a page reload; changes made elsewhere show on the next load of Panou.

_From 030-new-account-empty-states._

### 030-FR-010 — Every text this story shows MUST come from the translation files with a key present in both Romanian and English; no text may be hard-coded in a template.

_From 030-new-account-empty-states._

### 030-FR-011 — The Service-uri salvate panel and view MUST show their empty state without reading any saved-garages data; they are shown only to a driver with the `driver.saved_garages` capability, exactly as the view is gated today.

_From 030-new-account-empty-states._

### 030-FR-012 — Panou MUST render correctly on a 320 px and a 390 px phone, a tablet and a desktop, in light and dark, Romanian and English, with no horizontal scroll.

_From 030-new-account-empty-states._

### 030-FR-013 — An empty state MUST be reachable and readable without a pointer: its icon is decorative (hidden from assistive technology, no text of its own), its button is a native button or link in the page's tab order with the shell's visible focus ring, and its text meets the Cockpit theme's contrast in light and dark. The icon is chosen per state by the plan (inline, no icon library).

_From 030-new-account-empty-states._

### 244-FR-001 — No page, public or signed-in, server-rendered or in the browser, MUST load the analytics script or send any request to the analytics service until the browser holds a valid `granted` analytics choice (current text version, less than 365 days old). This feature MUST add no browser storage before consent beyond `mf_consent` (the choice and its browser id), which is essential.

_From 244-analytics-news-consent._

### 244-FR-002 — Every page MUST show the consent bar while the browser holds no valid choice: the text, the privacy-notice link and the two equal-weight buttons of User Story 1 scenario 1, in the page's language. The bar MUST NOT block the page: it is a bottom bar in the Cockpit style (light and dark), on a phone a bottom sheet above the tab bar where there is one, the page's content reserving the bar's height so the bar covers no button or link, with buttons at least 44 px high, readable and usable at 320 px with no sideways scroll, reachable by keyboard and announced as a region to assistive technology.

_From 244-analytics-news-consent._

### 244-FR-003 — Pressing "Accept" MUST store the choice `granted` in the browser (decision, text version, time, browser id) under the one key `mf_consent`, hide the bar, load the analytics script on that page and every page after, and send one record to the server. Pressing "Refuz" MUST do the same with `refused` and MUST NOT load the script.

_From 244-analytics-news-consent._

### 244-FR-004 — The analytics script MUST be Plausible's manual script, loaded only from Plausible's EU service, only after consent, and never from a server-rendered page; a page served with JavaScript off MUST carry no analytics script. The app MUST send one page view per route change itself, only while the choice in force is a valid `granted`.

_From 244-analytics-news-consent._

### 244-FR-005 — The text version MUST be one constant, `ANALYTICS_CONSENT_VERSION` in the contracts library, raised with each approved text change; a stored choice MUST be valid only when its text version equals the constant and its time is less than 365 days before now ("12 months" everywhere in this spec means 365 days; one constant, `ANALYTICS_CONSENT_MAX_AGE_DAYS`, beside the version). An invalid choice MUST show the bar again, keep analytics off and show the dialog's switch off.

_From 244-analytics-news-consent._

### 244-FR-006 — Every public page's footer and every dashboard's Setări view MUST carry the link "Setări cookie" / "Cookie settings" that opens the dialog of User Story 2 scenario 2. Saving a changed switch MUST store `granted` or `withdrawn` as FR-003 stores a choice; turning it off MUST stop every analytics event at once and keep the script off on the next page. Cancel, or an unchanged switch, MUST store nothing.

_From 244-analytics-news-consent._

### 244-FR-007 — Other open tabs of the same browser MUST apply a saved choice without a reload, through the browser's storage event: hide the bar and start or stop analytics.

_From 244-analytics-news-consent._

### 244-FR-008 — Consent records MUST live in one append-only table, `CONSENT_RECORD`: id, `browser_consent_id` (a random id made once in the browser and kept with the choice), `account_id` (empty for a visitor), `kind` `analytics`, `decision` one of `granted`, `refused`, `withdrawn`, `text_version`, `language`, `at`. Rows MUST only be added, never changed or deleted; an account's choice in force MUST be its row with the latest `at`. Nothing reads records by browser id: the browser's own `mf_consent` is its latest choice.

_From 244-analytics-news-consent._

### 244-FR-009 — `POST /api/v1/consents` (a visitor) and `POST /api/v1/me/consents` (a signed-in person, which needs a session) MUST take `{ browserConsentId, decision, textVersion, language, at }` validated at the edge (uuid, the three decisions, the current text version only, the app's languages, a time no more than 5 minutes ahead of the server's clock), write one row (the `/me` route carries the session's account id; the public route never does, since a public route does not resolve a session), and answer 201 with nothing more than the row's id. The public route MUST be public, and both MUST be limited per address, 20 records per hour, through the shared address throttle (count only; a throttle that cannot count never refuses), answering 429 beyond it.

_From 244-analytics-news-consent._

### 244-FR-010 — A record stored by a signed-in person MUST, in the same transaction, write one audit entry on the person's own account (actor the person, field `analyticsConsent`, value the decision and the text version). Nothing MUST let a caller name another account or another person's browser id as the subject: the subject is always the session's account.

_From 244-analytics-news-consent._

### 244-FR-011 — `GET /api/v1/me/consents` MUST need a session and answer the account's latest analytics record (decision, text version, language, at, or null) and the account's latest terms and latest privacy-notice consent (kind, text version, language, accepted time; two entries at most) as already stored; a visitor MUST get the `sign_in_required` 401.

_From 244-analytics-news-consent._

### 244-FR-012 — Right after a sign-in, and on each dashboard load, the browser MUST reconcile its choice with the account's latest analytics record: the newer of the two applies and is kept in the browser with the account; when the browser's is newer, or the account has none, it MUST be stored on the account as a record keeping its own decision and time, but only when the browser's choice was made under that account or as a visitor not yet bound to an account; a choice made under another account is never stored and the account's applies (or the bar shows when it has none). When the account's is newer it MUST NOT be stored again. Public pages use the browser's choice. The bar MUST NOT show when the account's valid choice applies.

_From 244-analytics-news-consent._

### 244-FR-013 — A record the server did not accept (network error, 5xx, 429) MUST be kept as pending in the browser with the choice and sent again on the next page load, at most once per load, until it is accepted; a 4xx other than 429 drops it.

_From 244-analytics-news-consent._

### 244-FR-014 — Every text of the bar and the dialog MUST exist in Romanian and in English through the app's translation files, and the stored record's `language` MUST be the page's language at the time of the choice.

_From 244-analytics-news-consent._

### 244-FR-015 — News e-mail consent MUST stay as built: off by default, never ticked in advance, a one-click stop in every news e-mail and the switch in settings. This feature MUST NOT change the news-consent flow, the unsubscribe page or the news preference, and the existing news-consent tests MUST pass unchanged on the branch.

_From 244-analytics-news-consent._

### 244-FR-017 — The feature MUST be covered by failing-first tests: Jest for the append-only rule and "latest wins" per account, the 5-minute clock tolerance, the address limit, the audit entry and account id of a signed-in record, the reconciliation rule, the validity rule (version, 12 months) and the bar and dialog components; Playwright for a first visit with no analytics request, "Accept" then requests, "Setări cookie" off then none, "Refuz" and reload then none, each in Romanian and in English, and at 320 px.

_From 244-analytics-news-consent._

### 139-FR-001 — The driver dashboard's Setări view MUST show, before the push and notification panels, the panel "Datele tale" / "Your details" with the rows Nume, Telefon, E-mail, Oraș (an empty value shown as "—"), the line under the phone "Service-ul îți vede numărul doar după ce accepți oferta lui." / "A garage sees your number only after you accept its quote.", and the button "Modifică" / "Edit".

_From 139-edit-my-details._

### 139-FR-002 — Modifică MUST turn the name and city rows into fields with "Salvează" / "Save" and "Renunță" / "Cancel"; the e-mail, phone and password rows MUST each carry their own "Schimbă" / "Change" action that opens a dialog of the kit (`libs/overlays`) for that change alone. Every form MUST validate before sending through the kit's shared task saving, show each problem under its field tied by `aria-describedby`, disable its main button and show progress while a call is on its way, and show the answer's code in the person's language in a region screen readers announce (`role="alert"`). Focus MUST move to the first invalid field after a failed save, to the first field when the inline edit or a dialog opens, and back to the control that opened it when the dialog closes or the inline edit is saved or cancelled; Escape closes a dialog. Tap targets MUST be at least 44 px, and the panel and every dialog MUST show no sideways scroll at 320 px, in light and dark, in Romanian and English.

_From 139-edit-my-details._

### 139-FR-003 — `GET /api/v1/me` MUST also return `phone`, `phoneConfirmed`, `pendingEmail` (the address of a live e-mail change, else null) and `hasPassword` (whether a `password` identity exists), so the panel can show the pending line, "Neconfirmat" and "Setează o parolă" without another call (modifies 097-FR-005).

_From 139-edit-my-details._

### 139-FR-004 — `PATCH /api/v1/me` MUST also accept `name` (2 to 80 characters once trimmed, no control characters) and `city` (null, or 2 to 60 characters once trimmed, no control characters; a blank city after trimming is stored as null), each optional, beside `language`; it MUST save the given fields in one transaction with one audit entry per field whose value changed (field, old value, new value, by the account in the role it is using) and one `account.updated` event naming the account and the changed fields, and answer "who am I"; a body with no change writes nothing (modifies 020-FR-001, 020-FR-005).

_From 139-edit-my-details._

### 139-FR-005 — A name or city out of range, with control characters, or any unknown field MUST answer 400 `validation_failed` naming the field, and nothing is saved; the panel shows the problem as a Romanian and English text per rule (name or city too short, too long, or with a disallowed character).

_From 139-edit-my-details._

### 139-FR-006 — `POST /api/v1/me/email` with `{ email }` (trimmed, compared and stored lower-case, at most 254 characters, text, "@" and a domain with a dot) MUST, for an active account, when the address belongs to no account: issue a confirmation token (32 random bytes, stored as its SHA-256 hash, purpose `email_change`, the new address, valid 24 hours, single use), void every older `email_change` token of the account, queue one `ACCOUNT_EMAIL` e-mail with purpose `email_check` to the new address carrying the link `<PUBLIC_WEB_URL>/<language>/confirm-email/<token>`, queue one `ACCOUNT_EMAIL` notice with purpose `email_change_notice` to the current address when the account has one, and answer 202 `{ pendingEmail }`. The account's e-mail MUST stay unchanged until the link is opened.

_From 139-edit-my-details._

### 139-FR-007 — An address that belongs to any account (whatever its state, compared without regard to case) MUST answer 409 `email_taken`; the account's own current address MUST answer 409 `email_unchanged`; nothing is sent in either case.

_From 139-edit-my-details._

### 139-FR-008 — Opening the link (the existing `POST /api/v1/auth/confirm-email`, no sign-in, its lookup and confirmation made aware of the token's purpose) with an unexpired, unused `email_change` token of an active account MUST, in one transaction: set the account's e-mail to the token's address, set the confirmed time to now, move the `password` identity's subject to the new address when one exists, mark the token used, record an audit entry for `email` (old and new value) and an `account.updated` event, and answer `{ status: "confirmed" }`; the page then says "Adresa ta de e-mail este confirmată." / "Your e-mail address is confirmed." When the address became taken meanwhile it MUST answer 409 `email_taken` and the page says "Adresa e folosită de alt cont."

_From 139-edit-my-details._

### 139-FR-009 — An expired, used, voided or unknown token MUST answer as the confirmation page's expired state does today (410 `link_expired`), and "Trimite un link nou" on that page MUST issue a new `email_change` link to the same pending address by the expired token only when that token is the account's latest `email_change` token and the address still belongs to no account (else 410 `link_expired` and nothing is sent), within the limits of FR-012.

_From 139-edit-my-details._

### 139-FR-010 — The panel's "Trimite linkul din nou" MUST, when the account has a pending e-mail change, send a new link to the pending address (voiding the older), else send a new confirmation link to the current unconfirmed address through the existing resend; both within the limits of FR-012.

_From 139-edit-my-details._

### 139-FR-011 — `POST /api/v1/me/phone` with `{ phone }` MUST accept a possible phone number as the phone sign-in accepts it (a Romanian mobile typed as 07xx xxx xxx read as +40…), store it in international form, and, for an active account when the number belongs to no other account: make a 6-digit code (stored only as its HMAC with its expiry 5 minutes ahead and its try count, one live change per account, a new code replacing the old), send one WhatsApp message of the new kind `PHONE_CHANGE_CODE` (transactional, cannot be muted, in the account's language) to the new number directly through Brevo, as the sign-in code is sent today, so the code is never written to a notification row, and answer 202. A number that belongs to another account MUST answer 409 `phone_taken`; the account's own number 409 `phone_unchanged`; a number that is not possible 400 `validation_failed`; WhatsApp sending blocked or Brevo refusing 503 `send_failed` with nothing kept.

_From 139-edit-my-details._

### 139-FR-012 — At most 5 links or codes (FR-006, FR-009, FR-010, FR-011 together) MUST be issued per account per hour, counted in one new per-account Redis counter in addition to the existing confirm-resend and per-number code limits (which stay as they are); the sixth MUST answer 429 `too_many_attempts` and send nothing. When Redis cannot be reached the limit is skipped and the failure logged, with the sign-in limiter's fail-open rule.

_From 139-edit-my-details._

### 139-FR-013 — `POST /api/v1/me/phone/confirm` with `{ code }` MUST, for the right code of a live change within 5 minutes, in one transaction: set the account's phone and its confirmed time to now, move the `whatsapp_phone` identity's subject to the new number when one exists, delete the change record, record an audit entry for `phone` (old and new value) and an `account.updated` event, and answer "who am I". A wrong code MUST answer 401 `code_invalid` and count one try; the fifth wrong try and every later one 429 `too_many_attempts` with the code void; an expired or missing code 410 `code_expired`. When the number became taken meanwhile it MUST answer 409 `phone_taken`.

_From 139-edit-my-details._

### 139-FR-014 — `POST /api/v1/auth/password` (under the auth path, where the `mf_refresh` cookie scoped to `/api/v1/auth` arrives, so the current family is known) with `{ currentPassword, newPassword }` MUST, for an account with a `password` identity whose current password verifies: store the argon2id hash of the new password, delete every refresh token of the account except the family of the presented refresh-token cookie, delete the account's push subscriptions of other sessions (all of them, as sign-out everywhere does today, when sessions cannot be told apart), record an audit entry of kind `password_changed` with no value and an `account.password_changed` event, all in one transaction; after it commits, publish `session.revoked` for the closed families so their open pages end at once and queue one `ACCOUNT_EMAIL` notice with purpose `password_changed` to the account's e-mail, as the password reset does (the notifications module writes through its own client, so the notice cannot join the auth transaction; a notice that fails to queue is logged and does not undo the change), and answer 204. The new password MUST meet sign-up's rules (080-FR-004) else 400 `weak_password` on `newPassword`; the password fields MUST never be logged.

_From 139-edit-my-details._

### 139-FR-015 — A wrong current password MUST answer 401 `invalid_credentials` and count one failure per account in Redis in a 15-minute window; from the fifth counted failure every try MUST be refused with 429 `too_many_attempts` until 15 minutes after the last counted failure, without the password being checked; a successful change clears the count. When Redis cannot be reached the limit is skipped and logged.

_From 139-edit-my-details._

### 139-FR-016 — For an account with no `password` identity and an e-mail, the same endpoint with `{ newPassword }` and no current password MUST create the `password` identity (subject: the account's e-mail) when the session's refresh-token family was opened within the last 10 minutes, else answer 403 `recent_sign_in_required` and the panel offers to sign in again; an account with no e-mail MUST be refused 409 `email_required` and the panel does not offer it. An assistant session (`via: assistant`) MUST be refused 404 on every password call, and on every e-mail and phone change and confirmation call (contact details are how the account is recovered; name and city follow the assistant's grant, FR-004).

_From 139-edit-my-details._

### 139-FR-017 — Every endpoint of this story MUST act on the signed-in account only (no account id in the path), refuse a suspended account with 403 `account_suspended` and an unsigned call with 401 `sign_in_required`, and be listed in the OpenAPI file with its DTOs in the contracts library and the generated client regenerated (Principle V).

_From 139-edit-my-details._

### 139-FR-019 — The new endpoints and the new notification kind MUST be listed in `infra/observability/inventory.json` with their signals (the product counters of e-mail and phone changes and password changes), and the e-mail and WhatsApp sends ride the existing notification dashboard and alerts.

_From 139-edit-my-details._

### 243-FR-001 — The terms of use and the privacy notice MUST each exist as a final text in Romanian and in English, with the same sections in the same order in both languages, each section a heading and one or more paragraphs, and no text or label anywhere on the pages or in the sign-up flow saying the text is a draft or pending legal review.

_From 243-terms-privacy._

### 243-FR-002 — The privacy notice MUST name the operator and the contact route for data matters (FR-011), and MUST list every kind of personal data MotorFix keeps at launch, each with why it is kept: the account (name, e-mail address, phone number, language, the sign-in methods: e-mail and password, Google, Apple, a phone number with a code sent by WhatsApp); cars (brand, model, year, fuel, odometer, due dates for ITP, RCA and rovinietă, and the number plate, kept private and shown only to the garage working on the car and on its day sheets); quote requests, quotes, bookings, the one message per request, the garage's reply, and up to 3 photos on each; the repair history, repairs logged elsewhere and their invoices, sharing the history with a garage one booking at a time, and passing a car's history to a buyer; reviews (the author shown as a first name and initial, e.g. "Andrei M."), reports and appeals; the audit history of every change, including changes made through an AI assistant later; garage legal documents and verification results; garage staff (mechanics, receptionists) and mechanics' public pages; notifications and the channel chosen for each, and the device label of a push subscription (taken from the browser description); consent records (terms, privacy notice, news, analytics) with the version accepted and when; the account's city, last activity and whether e-mail to it bounced; an unfinished garage listing with its e-mail address. Items not yet built (messages, reviews, appeals, car photos) are worded so they apply when the person uses them.

_From 243-terms-privacy._

### 243-FR-003 — The privacy notice MUST name every provider that processes personal data on MotorFix's behalf, each under a data processing agreement, and what it does: hosting in a European Union region (Railway); e-mail, SMS and WhatsApp messages (Brevo); file storage for photos and documents in an EU region (S3-compatible object storage); push messages through the browser vendor's push service, content end-to-end encrypted; monitoring and error reports from the servers and the browser (Grafana Cloud, EU region); web analytics only with the visitor's consent (Plausible); map tiles loaded by the browser (OpenFreeMap, which sees the visitor's connection address); address search called by MotorFix's server (Geoapify, which never sees the visitor's address); Google and Apple sign-in, as the method the person chooses. It MUST say that personal data is stored in the European Union and that, where a provider or its parent company is outside the EEA, transfers rely on the European Commission's standard contractual clauses or the EU-US Data Privacy Framework.

_From 243-terms-privacy._

### 243-FR-004 — The privacy notice MUST state the retention periods as the longest MotorFix keeps the data: legal documents and the audit history are kept while the garage or the account is active, then 5 years; photos are kept 90 days where that applies (quote request and reply photos; workshop photos stay while the listing shows them); account data while the account exists and, after it is closed, only as long as the law requires, closing and erasure being asked for by the contact route and handled by MotorFix until a self-service way exists; unfinished garage listings 90 days after their last change; consent records as long as needed to prove the acceptance; the anonymous profile-view data as FR-009 says.

_From 243-terms-privacy._

### 243-FR-005 — The privacy notice MUST state the legal basis for each use (the contract with the person for the account and the service; legal obligations for what the law requires MotorFix to keep; consent for news and for analytics, withdrawable at any time; legitimate interest for profile-view counts, the security measures and the verification of garages) and MUST list the person's rights: access, rectification, erasure, restriction, portability, objection, withdrawal of a consent without affecting what came before, and a complaint to the National Supervisory Authority for Personal Data Processing (ANSPDCP), with the contact route of FR-011 for exercising them.

_From 243-terms-privacy._

### 243-FR-006 — The privacy notice MUST say which security and anti-abuse measures touch personal data: requests from one connection address are counted under a one-way hash of the address, never the address, for 60 seconds (profile views, place search, assistant sign-in), 15 minutes (failed sign-ins) or 1 hour (sign-ups, password resets, consent records, listing drafts, WhatsApp sign-in codes); the address of a visitor watching a garage's live page is held in memory only while that page is open, to cap the live pages one address opens at once; the number plate is hidden from everyone but the garage working on the car. It MUST include a cookies-and-storage section: the strictly necessary sign-in cookies (the session cookie, kept up to 30 days with "remember me", else until the browser closes; the 10-minute cookies of a Google or Apple sign-in), browser storage for the analytics choice, the chosen place, an unfinished garage listing and actions waiting for a connection, and that Plausible loads only after consent.

_From 243-terms-privacy._

### 243-FR-007 — The terms of use MUST cover, in both languages: what MotorFix is and that garages are independent and answer for their own work and their quotes; who may create an account (a person of 18 or over, or a garage through a person entitled to act for it) and the account holder's duties (true details, one account, keeping sign-in to themselves, telling MotorFix of misuse); what drivers may do (cars, requests, bookings, repair history, sharing and transferring a history) and what garages may do (listing, quotes, day sheets, staff, mechanics' public pages); that a garage lists itself with true legal documents, that MotorFix verifies them and may approve, refuse or suspend a listing, and how a garage appeals; the review rules (only about work actually done, the author shown as a first name and initial, reports and appeals, and MotorFix's right to remove a review that breaks the rules); that MotorFix is free at launch for drivers and garages, takes no payments and is not a party to the repair contract, and that how it earns money is decided later and announced as a new version of these terms; acceptable use and what leads to suspension or closure; liability limits within what Romanian law allows; closing an account; changes to the terms, published as a new dated version; governing law (Romanian) and the contact route.

_From 243-terms-privacy._

### 243-FR-008 — Both texts MUST be reachable without a session from the footer of every public page and from every sign-up screen (the three that carry the tick today), in the language of the screen, at `/{lang}/terms` and `/{lang}/privacy` (132-FR-005, 132-FR-008, unchanged); this story verifies those links and fixes them only where one is missing.

_From 243-terms-privacy._

### 1203-FR-001 — The privacy notice's first section, "Who runs MotorFix and how to reach us" (EN) / "Cine se ocupă de MotorFix și cum ne contactezi" (RO), MUST name HUȚANU GEORGE-DRAGOȘ PERSOANĂ FIZICĂ AUTORIZATĂ as the controller of the personal data in the service, with CUI 55178146, trade register number (Nr. ordine în Registrul Comerțului) F2026034954005, EUID ROONRC.F2026034954005, and the professional seat București, Sector 1, Bd. Bucureștii Noi nr. 136, parter, ap. 5, in both languages. The legal name and the seat are written verbatim in Romanian in both languages (a legal name and a postal address are not translated); the English text may add a short gloss saying the operator is a sole trader registered in Romania.

_From 1203-legal-operator._

### 366-FR-003 — The privacy version MUST become 2026-10-17 in both languages; the terms version stays 2026-10-12.

_From 366-assistant-privacy._

### 243-FR-014 — The news consent (#834) and the analytics consent (#150) texts MUST be referred to from the privacy notice as separate, withdrawable consents, and the notice MUST say where each is changed (the account's notification settings or the link in each news e-mail for news, where the product changes it today; the cookie settings for analytics).

_From 243-terms-privacy._

### 1203-FR-001 — The privacy notice's first section, "Who runs MotorFix and how to reach us" (EN) / "Cine se ocupă de MotorFix și cum ne contactezi" (RO), MUST name HUȚANU GEORGE-DRAGOȘ PERSOANĂ FIZICĂ AUTORIZATĂ as the controller of the personal data in the service, with CUI 55178146, trade register number (Nr. ordine în Registrul Comerțului) F2026034954005, EUID ROONRC.F2026034954005, and the professional seat București, Sector 1, Bd. Bucureștii Noi nr. 136, parter, ap. 5, in both languages. The legal name and the seat are written verbatim in Romanian in both languages (a legal name and a postal address are not translated); the English text may add a short gloss saying the operator is a sole trader registered in Romania.

_From 1203-legal-operator._

### 1203-FR-002 — The same section MUST give hutanugeorge40@gmail.com as the e-mail for anything about the reader's data, including data-protection requests and exercising the rights this notice describes (the phrase covers "anything in this notice"), stating that no account is needed, and MUST keep writing from the account as a second way; the sentence telling a reader without an account to create one in order to write MUST be removed, in both languages.

_From 1203-legal-operator._

### 1203-FR-003 — The sentence that the legal name, registration number and address "will be added to this notice, as a new version, once the company is set up", and its Romanian twin, MUST be removed.

_From 1203-legal-operator._

### 1203-FR-004 — The terms' section "Governing law and contact" (EN) / "Legea aplicabilă și contact" (RO) MUST keep that the terms are governed by Romanian law and MUST name the same operator with the same four facts (name, CUI, trade register number with EUID, professional seat) and the same e-mail as the way to write about anything in the terms, beside writing from the account, in both languages.

_From 1203-legal-operator._

### 1203-FR-006 — An acceptance (consent) that names a version other than 2026-10-12 for either text MUST not count as current: a sign-up carrying it MUST be refused with the existing "accept the current terms" error, and one carrying 2026-10-12 for both MUST be accepted and recorded with those versions. No new re-acceptance flow is added; the existing version rule (both versions compared by equality) applies.

_From 1203-legal-operator._

### 1203-FR-007 — The documented API example of the consent versions MUST be regenerated so it shows the new version: `apps/api/openapi.json` and, if its output changes, the generated `libs/data-access` client (`npx nx run data-access:generate`); the diff of each is the example only.

_From 1203-legal-operator._

### 1203-FR-008 — Every Romanian word in the changed paragraphs, the operator's name and its seat included, MUST use ș and ț with comma below (U+0219, U+021B, and their capitals U+0218, U+021A); no cedilla form (U+015F, U+0163, U+015E, U+0162) may appear in the legal texts.

_From 1203-legal-operator._

### 1203-FR-009 — Both languages MUST keep the same sections and the same number of paragraphs in the same order, as the existing structure test requires; the operator details are placed in the same paragraph positions in both languages.

_From 1203-legal-operator._

### 1203-FR-010 — No legal fact beyond the ones in FR-001, FR-002 and FR-004 is added: no DPO appointment, no other address, telephone number or supervisory-authority wording, no change to any other section.

_From 1203-legal-operator._

### 250-FR-001 — The web app MUST send every analytics event through one analytics service that drops the call without a valid "granted" consent, stops at once when consent is withdrawn during the visit, and never runs on the server.

_From 250-launch-analytics-events._

### 250-FR-002 — An event sent to Plausible MUST carry only the properties of its allowed set (FR-004); any other property, and any property whose value is outside its allowed values, is dropped before the call. A `brand` slug is lowercase letters, digits and single hyphens only. No event or page view may carry a name, e-mail, phone, number plate, account id, request id, garage id or free text.

_From 250-launch-analytics-events._

### 250-FR-003 — Page addresses sent to Plausible MUST have ids removed: a page is named by its route template (as today's page views already do), and custom events reuse the same name, never the address.

_From 250-launch-analytics-events._

### 250-FR-004 — The event contract MUST be exactly the Build brief's list: `sign_up_completed` (`method` ∈ email, google, apple, phone; `role` ∈ driver, garage), `brand_picked` (`brand` slug; `source` ∈ home_picker, home_strip, results_chips), `garage_opened` (`source` ∈ results, map_pin, home, shared_link, saved_list), `filter_applied` (`filter` ∈ open_now, open_saturday, max_price, min_rating, card; no value), `garage_saved` (`source` ∈ profile, result_card), `quote_request_started` (`source` ∈ profile, results), `quote_request_sent` (`garages` ∈ "1", "2–3", "4–5"; `jobs` integer ≥ 1; `brand` slug, dropped when the request did not come through a brand profile), `message_sent` (`side` ∈ driver, garage), `request_answered` (`action` ∈ quote, decline), `quote_accepted` (`sort` ∈ fastest, price, slot, rating; `position` integer ≥ 1), `review_posted` (`rating` 1–5; `has_text` ∈ yes, no), `listing_started`, `listing_step_completed` (`step` 1–6), `survey_completed`, `listing_submitted`.

_From 250-launch-analytics-events._

### 250-FR-005 — Each event whose surface exists today MUST fire from it: `brand_picked` (Home picker and brand search, `source: home_picker`), `garage_opened` (profile, source from the existing profile-view classification: search → `results`, home → `home`, shared link → `shared_link`, saved → `saved_list`; a direct open sends no `source`), `quote_request_started` (opening "Cere ofertă" from the profile), `quote_request_sent` (the request created), `sign_up_completed` (e-mail, Google, Apple, phone; role from the flow, always `driver` today), `request_answered` (the garage quotes or declines), `listing_started` (a new listing draft), `listing_step_completed` (each of the 6 steps), `listing_submitted` (fires when the form's completeness check ends complete, the only send that exists; it moves to the verification submit when #14 lands and the list says so).

_From 250-launch-analytics-events._

### 250-FR-006 — An event whose surface is not built (`filter_applied`, `garage_saved`, `message_sent`, `review_posted`, `survey_completed`, `quote_accepted` (no web accept surface until #61; `position` only until a sort exists), `sign_up_completed` with `role: garage`, `brand_picked` from a strip or chips, `garage_opened` from a map pin, a quote sort) is part of the contract and fires when its surface lands; it is not wired in this feature and the list (FR-009) says so.

_From 250-launch-analytics-events._

### 250-FR-009 — The repository MUST hold a list mapping each launch feature's "How to measure it" figure to an event of FR-004, a database count (the S9 figures and the nightly funnel), or "not measured at launch"; for every event, its surface and whether it is built; and the owner-side Plausible setup: one goal per event and the two funnels (driver: Home → `brand_picked` → `garage_opened` → `quote_request_started` → `quote_request_sent` → `quote_accepted` → `review_posted`; garage: `listing_started` → `listing_step_completed` step 6 → `survey_completed` → `listing_submitted`), done in Plausible's dashboard.

_From 250-launch-analytics-events._

### 250-FR-010 — When Plausible cannot be reached or is blocked, no screen, flow or database figure MUST be affected; the events are lost silently.

_From 250-launch-analytics-events._

### 1169-FR-002 — Every sign-in that ends in `SignInService.openSession` (password, Google, Apple, phone code, sign-up, password reset) MUST, after the credentials or identity were verified and the session issued, start the warm for that account and role without delaying the sign-in answer: the answer is sent whether the warm has finished, failed or was skipped. A refused sign-in (unknown account, wrong password, too many attempts, suspended, maintenance) warms nothing and keeps its answer, status and timing path exactly as today, so an observer learns nothing about whether the account exists.

_From 1169-prefetch-intent._

### 029-FR-001 — The Mașinile mele panel MUST show, for each car it lists, the brand and model, "<year> · <km>" with the kilometres in the person's number format ("148.200 km" / "148,200 km"), then its two most urgent lines; no plate in the panel.

_From 029-overview-panels-own-data._

### 029-FR-002 — A car's lines MUST be the ITP, RCA and rovinietă due-date lines of 090-FR-001..005 and 092-FR-009 (their states, sentences and plurals unchanged, without the garage link and without the add buttons) plus, when the car has a next-service km, the oil-service line.

_From 029-overview-panels-own-data._

### 029-FR-004 — Urgency order of a car's lines MUST be: lamp state red, then amber, then green, then grey; within a state the smaller signed day count first (a date line's days until it, the oil line's estimated days; a passed line is negative and so comes first), a date line before the oil line on a tie, and date lines tied on state and days in the order ITP, RCA, rovinietă; grey lines in the same fixed order. The panel shows the first two.

_From 029-overview-panels-own-data._

### 029-FR-005 — The panel MUST order cars by their most urgent line (FR-004's full order — state, signed days, kind — applied to each car's first line), ties newest first as the list answers; it MUST show at most 3 cars and, when the driver has more, a link "Toate mașinile (<n>)" / "All cars (<n>)" to the view Mașinile mele, with n the number of cars not removed.

_From 029-overview-panels-own-data._

### 029-FR-009 — A car saved from the panel's "Adaugă o mașină" MUST show in the panel at once, placed by FR-005, without a reload (030-FR-008 unchanged).

_From 029-overview-panels-own-data._

### 029-FR-011 — A pure merge of a layout (an ordered list of entries, each a panel key and whether it is hidden) onto the registry MUST return the panels to draw: with no layout, the released panels in default order; with a layout, its order without its hidden entries, ignoring keys no panel has, inserting a registered released panel the layout omits right after the nearest panel before it in the default order that the result already holds (first when none is), and never a panel behind an off release flag; a key the layout repeats counts once, at its first place, and an empty layout is the same as none. No stored layout is read in this story: reading `DASHBOARD_LAYOUT` is #280's (ST-402).

_From 029-overview-panels-own-data._

### 029-FR-012 — Every text this story shows MUST come from the translation files with a key present in both Romanian and English (030-FR-010).

_From 029-overview-panels-own-data._

### 029-FR-013 — Tests MUST cover: the merge with no layout, a full layout, an unknown key, a missing key and an off release flag; the oil line's state and sentence at 3,800 km (green, 116 days), 1,988 km (green, 61), 1,987 km (amber, 60), 247 km (amber, 8), 246 km (red, 7), 0 and −200 km in both languages; the urgency order across date and oil lines, a passed line first, grey last; the car order and the 3-car cut with its link; the panel's own error text and retry; the car saved from the panel shown at once (Jest); `GET /api/v1/cars` carries `nextServiceKm`, answers only the caller's cars and never a removed one, and another driver's car by id answers 404 (Jest, on real PostgreSQL where the repository is used); end to end (Playwright): a new driver sees the empty states, adds a car from the panel, sees it at once, reloads and still sees it.

_From 029-overview-panels-own-data._

### 029-FR-014 — Panou with a filled cars panel MUST render on a 320 px and a 390 px phone, a tablet and a desktop, in light and dark, Romanian and English, with no horizontal scroll (030-FR-012).

_From 029-overview-panels-own-data._
### 366-FR-001 — The privacy notice's section "Who else handles the data" (EN) / "Cine mai prelucrează datele" (RO) MUST hold one paragraph about AI assistants, in both languages, stating: (a) only the person connects an assistant, and sending rests on their own request; (b) it reads only what the person could see in MotorFix themselves; (c) phone numbers and number plates are never sent to it, and photos only as a link that opens MotorFix; (d) every action is shown to the person and done only after their "yes", and bookings are also approved in the app; (e) its changes are recorded in the audit history as made through an AI assistant; (f) the assistant's provider handles what it receives under its own terms, with no agreement with MotorFix, and may be outside the European Economic Area; (g) the person can disconnect it at any time from their account.

_From 366-assistant-privacy._

### 366-FR-002 — The sentence "If you connect an AI assistant, what it reads at your request goes to that assistant's provider." and its Romanian twin MUST be removed from the paragraph that names the map, address and sign-in providers.

_From 366-assistant-privacy._

### 366-FR-004 — A consent naming any privacy version other than 2026-10-17 MUST not be current: a sign-up carrying privacy 2026-10-12 MUST be refused with the existing error.

_From 366-assistant-privacy._

### 366-FR-005 — `apps/api/openapi.json` MUST be regenerated so its consent example shows the new privacy version; the generated `libs/data-access` client is regenerated and committed only if it changes.

_From 366-assistant-privacy._

### 366-FR-006 — Both languages MUST keep eleven privacy sections with the same paragraph counts in the same order, and the Romanian text MUST use ș and ț with comma below only.

_From 366-assistant-privacy._

### 291-FR-006 — The panel "Service-uri salvate" on Panou (registry key `saved`, 029-FR-010, released and behind `driver.saved_garages` as today) and the view "Service-uri salvate" at `/app/driver/saved` (028-FR-001, title "Service-uri salvate" / "Saved garages", 028-FR-002) MUST show the same list from FR-001, through one root-provided store: activating either reads the first page once, and the other shows the store's rows when it opens and reads again. The view MUST show under its title the subtitle "{n} service-uri care lucrează pe mașinile tale" / "{n} garages that work on your cars" from `workingCount`, with the Romanian count forms of the shared formatter: "1 service care lucrează…", "0 service-uri…", "2–19 service-uri…" and from 20 "20 de service-uri care lucrează pe mașinile tale".

_From 291-saved-garages._

### 291-FR-007 — Each row MUST show: the rating dial (the shared dial the result cards and Home cards use, with its unrated state), the garage's name, the lamp line of FR-008, a remove control (icon only, accessible name "Scoate din salvate" / "Remove from saved"), and an arrow; the name and the arrow open the garage's public profile `/<lang>/garages/<slug>` in the person's language (the profile opened from here reports its source as `saved`, as today). Rows are helm cards, in the order the API gives.

_From 291-saved-garages._

### 291-FR-008 — The lamp line MUST be composed from the item: with `brands` not empty, a green lamp (the shared `mf-lamp`) and "Lucrează pe {brands}" / "Works on {brands}", the names joined with ", " and the last with " și " / " and "; with `brands` empty and the driver owning at least one car, a red lamp and "Nu lucrează pe mașinile tale" / "Does not work on your cars"; with no car, a grey lamp and "Adaugă o mașină ca să vezi dacă lucrează pe ea" / "Add a car to see whether it works on it". After it, separated by " · ", the distance when the item has one, in the language's format with one decimal and " km" (019-FR-004); for a mobile mechanic "vine la tine" / "comes to you" when `comesToYou` is true and "în afara zonei" / "outside its area" when false; nothing, and no separator, without a place. The colour is never the only signal: the text states the case and the dot is hidden from assistive technology. An `available: false` item is drawn greyed with "Indisponibil" / "Unavailable" in place of the lamp line (its name and arrow still open the profile, which shows the "no longer available" page, A34) and keeps its remove control; its dial shows the garage's stored rating, or the unrated state, like any other row.

_From 291-saved-garages._

### 291-FR-009 — The panel MUST show the newest 3 rows; when `total` exceeds 3 it ends with the link "Vezi toate" / "See all" to the view. The view MUST show the first page and read the next page with its cursor when the last row comes into view (infinite scroll), appending; a failed page read shows the error text of FR-012 under the loaded rows with "Reîncearcă".

_From 291-saved-garages._

### 291-FR-010 — The place for `near` MUST be the one the browser keeps for Home and the results (the place store, 229-FR-005: location or typed address) and, with none kept, the Setări city as Home takes it (229-FR-006: through the address look-up once, not stored); with neither, or when the browser refused the location, the read is sent without `near`. The place is rounded to three decimals before it leaves the browser (229-FR-008). A change of the place while the dashboard is open re-reads the list once.

_From 291-saved-garages._

### 291-FR-011 — The remove control MUST remove the row at once (optimistic), send ST-290's removal, show the undo bar of 290-FR-013 ("Scos din salvate · Anulează" / "Removed from saved · Undo", 8 seconds, announced, keyboard-operable) and update `total`, `workingCount` and the panel's "Vezi toate" in place; "Anulează" sends the undo save and puts the row back in its former place; a failed removal puts the row back, drops the bar and shows the error toast ("Fără conexiune" / "No connection" offline, else the shared error text). When a row goes, keyboard focus moves to the next row's link, else the previous row's, else "Caută altele". The shared control and undo of ST-290 are reused, not rewritten.

_From 291-saved-garages._

### 291-FR-012 — States: while the first read is open the panel and the view show three row skeletons; a failed read shows "Nu am putut încărca service-urile salvate." / "We could not load your saved garages." with "Reîncearcă" / "Try again"; an empty list shows "Nu ai salvat încă niciun service." / "You have not saved any garage yet." with the button "Caută altele" / "Find more" (the existing empty state of the view, 030-FR-011, now also the panel's). "Caută altele" MUST also sit at the top right of the panel's and the view's header, as the mock draws it (design.md), not at the foot; it opens the results in the person's language for the brand of the driver's first car (`/<lang>/garages?brand=<brand id>`, which the results page reads as a brand id, with the kept place as the results page already read it; amended at review: the car carries the brand's id, not its slug) or Home when the driver has no car.

_From 291-saved-garages._

### 291-FR-013 — The panel and the view MUST subscribe to `saved_garage.added` and `saved_garage.removed` on the driver's signed-in live stream (290-FR-008) and read the list again on either (the first page, then, in the view, the further pages again up to as many rows as were shown, through the dashboard's shared `moreRows`), so a save or removal in another tab shows within seconds; an event for a removal this screen itself made is harmless (the re-read answers the same list). A rating or status change shows on the next read, with no subscription.

_From 291-saved-garages._

### 291-FR-014 — Every text MUST live in the dashboard's texts in Romanian and English, and the panel and the view MUST render well at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll (286-FR, 288-FR); a row's remove control and arrow are at least 44 px targets.

_From 291-saved-garages._
### 066-FR-012 — The admin read of accounts (`GET /api/v1/admin/accounts`) MUST carry on each account `serviceSuspended`, true when the account holds a mechanic card at a garage whose status is `suspended`, false otherwise; no screen shows it in this story (the Mecanici table of #27 and the detail page of #28 will show "service suspendat" in red from it). Tests MUST cover a mechanic of a suspended garage (true), of an approved garage (false), an owner of a suspended garage with no mechanic card (false), and the flag turning false once the garage is no longer suspended.

_From 066-suspended-garages._

## Retired

- `079-FR-017` — superseded by `082-FR-021` (2026-10-04)

- `082-FR-013` — superseded by `080-FR-009` (2026-10-04)

- `079-FR-011` — superseded by `130-FR-001` (2026-10-05)
- `082-FR-018` — superseded by `130-FR-004` (2026-10-05)

- `080-FR-009` — superseded by `393-FR-012` (2026-10-06)

- `128-FR-004` — superseded by `569-FR-003` (2026-10-07)

- `079-FR-018` — superseded by `160-FR-007` (2026-10-07)

- `082-FR-021` — superseded by `028-FR-005` (2026-10-07)

- `082-FR-006` — superseded by `261-FR-005` (2026-10-08)
- `079-FR-016` — superseded by `097-FR-005` (2026-10-08)

- `020-FR-001` — superseded by `139-FR-004` (2026-10-10)
- `020-FR-005` — superseded by `139-FR-004` (2026-10-10)
- `097-FR-005` — superseded by `139-FR-003` (2026-10-10)

- `132-FR-008` — superseded by `243-FR-013` (2026-10-11)

- `243-FR-011` — superseded by `1203-FR-001` (2026-10-11)
- `243-FR-012` — superseded by `1203-FR-005` (2026-10-11)

- `030-FR-001` — superseded by `029-FR-010` (2026-10-17)
- `030-FR-006` — superseded by `029-FR-008` (2026-10-17)
- `1203-FR-005` — superseded by `366-FR-003` (2026-10-17)
