---
capability: accounts
updated: 2026-10-30
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
  - 1345-staging-observability
  - 005-data-requests
  - 1348-release-green
  - 1359-signup-survey
  - 116-listing-verification-status
  - 101-verification-progress
  - 009-copy-voice-analytics
  - 129-delete-account
  - 292-saved-garage-quote
  - 532-lost-session-home
  - 500-req-ip-behind-proxy
  - 140-account-delete-export
  - 500-trust-railway-edge
  - 105-brand-list-admin
  - 1370-release-seed-no-ssh
  - 1372-seed-restores-accounts
  - 947-faro-consent-journeys
  - 003-admin-account-actions
  - 1373-seed-status-identity
  - 1156-retention-job
  - 1204-terms-reaccept
  - 102-garage-members
  - 423-mechanic-garage-dashboard
  - 1381-mechanic-scope
  - 099-overview-sections
  - 011-dashboard-sections
  - 1316-swr-resource-store
  - 1369-receptionist-profile
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

### 102-FR-002 — The rows MUST be: owner (role `garage`) every `garage.*` capability; receptionist `garage.requests`, `garage.schedule`, `garage.move_bookings`, `garage.final_price`, `garage.own_jobs`, `garage.reviews`, `garage.profile`, `garage.audit_history`; mechanic `garage.own_jobs`, `garage.schedule`, `garage.audit_history`, plus `garage.requests` with `can_answer_quotes`, `garage.move_bookings` (new) with `can_move_bookings`, `garage.final_price` with `can_record_final_price`. Admin and driver rows are unchanged. A test MUST cover every role × capability pair not granted ("may not"), as 079-FR-010 asks, and every permission on and off for the mechanic.

_From 102-garage-members._

### 130-FR-001 — The API MUST check the actor on every route by default; a route MUST be explicitly marked public to be reachable without a session. Without a valid access token a gated route MUST answer 401 `sign_in_required` before its body is validated (modifies 079-FR-011).

_From 130-sign-in-gate._

### 079-FR-012 — The role in use MUST be the role the access token carries when the account still holds it (the token is issued for the last role at sign-in, and for the new role at a role switch), otherwise the account's last role when held, otherwise the first held role in the order admin, garage, receptionist, mechanic, driver; the fallback is computed per call, never written back.

_From 079-account-model._

### 102-FR-007 — `requireCapability` MUST answer 403 `forbidden` when the actor is garage staff of a garage (a `garage`, `receptionist` or `mechanic` role with a `garageId`) and lacks the capability, and 404 when the actor holds no garage or the capability is not a `garage.*` one; `assertGarage` MUST keep answering 404 for another garage (A31/A34, decided 2026-10-16: 403 within one garage's staff, 404 across garages and between drivers). The garage figures' mechanic refusal (`garage-figures.service.ts`) MUST become the same 403. Every existing test asserting 404 for same-garage staff is updated to 403; the feature-off 404 stays.

_From 102-garage-members._

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

### 500-FR-011 — Both refused-sign-in warning lines (`sign-in refused: invalid_credentials` and `sign-in refused: too_many_attempts`) MUST carry, after `caller=<masked>` and in this order, the tokens `hops=<hops>` (FR-012) and `headers=<names>` (FR-013), then `real-ip=<masked>` and `forwarded=<masked>` (FR-014) only when that header is present; the controller always hands the sign-in service the request's headers and socket address, so the tokens are always there (`hops=unknown headers=none` for a request that names neither). No token may carry a full address, the e-mail or the password, and no other sign-in outcome logs an address. (Modifies 500-FR-005: the line gains the forwarding facts beside the caller.)

_From 500-trust-railway-edge._

### 393-FR-012 — The sign-in dialog MUST offer, under its main button and a "sau" divider, the button "Continuă cu telefonul" (English "Continue with phone"); tapping it MUST show the phone step inside the same dialog: the field "Număr de telefon" with "+40" filled in (`type=tel`, `autocomplete=tel`), "Ține‑mă autentificat" ticked by default, the main button "Trimite codul", and a link back to e-mail and password. Before sending, the dialog MUST check that the number is a possible phone number and show the problem under the field as 082-FR-014 does (modifies 080-FR-009, which lists the dialog's controls under its main button).

_From 393-whatsapp-phone-sign-in._

### 082-FR-014 — Before sending, the dialog MUST check that the e-mail is filled in and looks like an address (text, "@", a domain with a dot) and that the password is filled in, through the shared task saving of `libs/overlays`; each problem MUST show under its field, be tied to the field by `aria-describedby`, and move the focus to the first wrong field.

_From 082-sign-in._

### 082-FR-015 — While a sign-in is on its way the main button MUST be disabled and show progress, and a second tap MUST send nothing.

_From 082-sign-in._

### 003-FR-008 — Once suspended, the next sign-in by every method (e-mail and password, Google, Apple, phone code) and every refresh MUST be refused as the existing `account_suspended` answers say (082-FR-004, 082-FR-008, 083-FR-006, 393-FR-007); the message shown for `account_suspended` everywhere the web shows it MUST read "Contul tău este suspendat. Scrie‑ne la suport." / "Your account is suspended. Write to support." (Modifies 082-FR-016.)

_From 003-admin-account-actions._

### 082-FR-017 — After a successful sign-in the dialog MUST close and the role's landing (`/app/driver`, `/app/garage` for garage owner, receptionist and mechanic, `/app/admin`) MUST open, in the account's language.

_From 082-sign-in._

### 130-FR-004 — In the browser, an API call made through the app's HTTP client, outside the session calls (`/api/v1/auth/*`) and outside "who am I", that is answered 401 with code `sign_in_required` MUST first be renewed once from the cookie (one renewal shared by concurrent calls, whether or not the call carried a token) and repeated; when the renewal fails it MUST open the sign-in dialog over the current screen without changing the address, showing the line "Intră în cont ca să continui." under the brand line (modifies 082-FR-018). The live stream, which does not go through that client, keeps its own renew-and-reconnect and never opens the dialog.

_From 130-sign-in-gate._

### 082-FR-019 — When the app needs the session and holds no access token (a reload, a reopened browser), it MUST renew from the cookie before asking "who am I"; a failed renewal means signed out.

_From 082-sign-in._

### 1316-FR-006 — The store MUST hold nothing once the signed-in account is forgotten, whoever signs in next (the same account after a lapsed session included): at a session that lapses and opens the sign-in dialog (536-FR-001), at "Ieși din cont" and "Ieși de pe toate dispozitivele" (also when the call fails, 082-FR-020, 128-FR-008), on a `session.revoked` message (128-FR-009), and when a sign-out in another tab reaches this one (128-FR-005).

_From 1316-swr-resource-store._

### 082-FR-022 — Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup.

_From 082-sign-in._

### 1372-FR-004 — The seed MUST stay idempotent on every staging deploy: a second run on the same database MUST add no row to any table (the existing removal of the seed accounts' last-day quote requests is the one exception) and MUST change no row, the password hash of every seeded identity included (replaces `1370-FR-006`: a seeded account's password identity, seeded roles and seeded garage link a user changed are restored, not kept); the integration spec MUST run the seed twice and compare the row counts and every seeded account's account, identity, role and link rows.

_From 1372-seed-restores-accounts._

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

### 130-FR-002 — The public list MUST be exactly: `POST /api/v1/auth/sign-in`, `POST /api/v1/auth/sign-up`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/sign-out`, `GET /health/live`, `GET /health/ready` (outside the `/api/v1` prefix), `POST /api/v1/webhooks/brevo`, which checks Brevo's own bearer secret and is left out of the OpenAPI document (it arrived with ST-194; its own integration spec boots the app-wide check), and the two cookie-authenticated routes added since, `POST /api/v1/auth/sign-out-everywhere` (128-FR-001) and `POST /api/v1/auth/roles/switch` (394-FR-001); a test MUST enumerate every route the API serves, call each without a token, and fail when the set of routes not answering 401 `sign_in_required` differs from this list.

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

### 1316-FR-007 — The store MUST hold nothing of the previous account or role when another account signs in on the same page or the account switches role (394-FR-006): the first view of the new account or role starts from its skeleton, and no value held before the change is observable after it.

_From 1316-swr-resource-store._

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

### 1204-FR-012 — The tick MUST be one component that any form creating an account can place above its main button as a form control, tying its error line to its control by the fixed id `mf-consent-error` and taking no `errorId` input; the sign-up, provider sign-up and phone sign-in forms keep linking the error by `aria-describedby` (modifies 132-FR-007 by fixing the id).

_From 1204-terms-reaccept._

### 1204-FR-010 — The legal texts MUST live in code with the pages that show them, add no dependency, and change no page layout: `/{lang}/terms` and `/{lang}/privacy` show the text in the address's language to anyone without an account, rendered on the server and listed in the sitemap for both languages; the page shows the title, the version label and date, and the sections (132-FR-008's layout minus the draft note), and MUST NOT scroll sideways on a 320 px phone in either language. The pages' two interface labels MUST come from the interface language files under `public.legal.*` — the version label ("Versiunea" / "Version") and, for each text, the page title key ("Termeni de utilizare · MotorFix", "Nota de informare privind datele personale · MotorFix" / "Terms of use · MotorFix", "Privacy notice · MotorFix") — with `LEGAL_LABELS` removed from the legal-texts module, and the key-parity check stays green (modifies 243-FR-013's source of those labels only).

_From 1204-terms-reaccept._

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

### 947-FR-004 — The analytics consent text MUST name Grafana Faro beside Plausible and say that, with consent, the visit is followed as one session through the pages visited, in Romanian and English in the app's translation files (the bar's text and the dialog's line; the dialog line's "no cookies and without identifying you" is reworded so it stays true: no cookie, no name, a random session id on this device only). `ANALYTICS_CONSENT_VERSION` MUST become `2026-10-24`, so a choice stored under `2026-10-10` is no longer valid: the bar shows again and no session id is sent until the visitor accepts the new text (244-FR-005 as written).

_From 947-faro-consent-journeys._

### 244-FR-003 — Pressing "Accept" MUST store the choice `granted` in the browser (decision, text version, time, browser id) under the one key `mf_consent`, hide the bar, load the analytics script on that page and every page after, and send one record to the server. Pressing "Refuz" MUST do the same with `refused` and MUST NOT load the script.

_From 244-analytics-news-consent._

### 244-FR-004 — The analytics script MUST be Plausible's manual script, loaded only from Plausible's EU service, only after consent, and never from a server-rendered page; a page served with JavaScript off MUST carry no analytics script. The app MUST send one page view per route change itself, only while the choice in force is a valid `granted`.

_From 244-analytics-news-consent._

### 947-FR-003 — When the choice stops being a valid `granted` (the switch saved off, a storage event from another tab, expiry, a version bump), the next event and every one after MUST carry no session id and no journey event, and the session id kept on the device MUST be removed from session storage at that moment, and the live session meta MUST lose its id (so no `x-faro-session-id` header and no `session.id` span attribute follow). Granting again MUST start a new session id, never reuse the old one.

_From 947-faro-consent-journeys._

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

### 1204-FR-008 — A record the server did not accept (network error, 5xx, 429, or 403 `consent_required`) MUST be kept as pending in the browser with the choice and sent again on the next page load, at most once per load, until it is accepted; any other 4xx drops it. A signed-in record (`POST /api/v1/me/consents`) refused with `consent_required` is first resent once by the dialog's resend after "Accept" (FR-007), and stays pending only when that call still ends refused (no acceptance followed, or the resend failed), then goes again after acceptance or on the next page load (modifies 244-FR-013, which dropped every 4xx other than 429).

_From 1204-terms-reaccept._

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

### 947-FR-005 — The privacy notice MUST state the new facts in both languages: that Grafana Faro, only after analytics consent, follows the visit as a session with a random id kept on the device and the pages visited, without a name or account; that no session replay is recorded; and that the device keeps that session id among the items it lists. `PRIVACY_VERSION` MUST become `2026-10-24` (a notice change is a new date, 132-FR-001 unchanged).

_From 947-faro-consent-journeys._

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

### 005-FR-014 — Every paragraph of the privacy notice in `apps/web/src/app/public/legal-texts.ts` that says how to use a right (closing the account or erasure, objecting to the profile-view count, "Your rights" / "Drepturile tale") MUST point to the e-mail address of the first section ("the e-mail address above" / "adresa de e‑mail de mai sus", worded so it cannot be read as the postal seat) as well as the account, in both languages, so it agrees with the contact paragraph and the procedure; the address itself stays written once per notice (1203-FR-010, `legal-texts.operator.adversary.spec.ts`); the terms of use are unchanged. It carries 1203-FR-010's rule forward: no legal fact beyond 1203-FR-001, 1203-FR-002 and 1203-FR-004 is added to the operator details (no DPO appointment, no other address, telephone number or supervisory-authority wording), and no section changes beyond these paragraphs.

_From 005-data-requests._

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

### 116-FR-003 — "CREEAZĂ CONTUL" on the survey summary MUST first save the server copy with the five answers and, after its 2xx, fire the `survey_completed` event (250-FR-004, 250-FR-006) once per page load through the consent-gated tracker, and show "Răspunsurile tale sunt salvate." / "Your answers are saved." under the summary in a `role="status"` live region; the button MUST be disabled while the save is in flight, and a failed save MUST show "Nu am putut salva. Încearcă din nou." / "We could not save. Try again." in a `role="alert"` live region, keep the answers and keep the owner on the summary. After the save it MUST open the sign-in dialog in its sign-up task with the step 1 e-mail filled in, offering e-mail and password, Google, Apple and the phone number with a WhatsApp code (the dialog's existing ways, 083-FR-001, 393-FR-012), and the switch to signing in to an existing account. Modifies 1359-FR-011 (the press now also opens the dialog and leads to the send).

_From 116-listing-verification-status._

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

### 1316-FR-005 — A change the person makes to a resource in the app (a car added, edited or removed on Mașinile mele or from Panou's panel) MUST be applied to the held value at once, from the write's answer and without changing the held value's age, so that every other view of that resource shows the change on its next open without waiting for a read; 029-FR-009's at-once display of a car saved from the panel holds for the panel and now for the Mașinile mele list too.

_From 1316-swr-resource-store._

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

### 292-FR-001 — Each row of the view "Service-uri salvate" at `/app/driver/saved` whose garage is available MUST carry a secondary button "Cere ofertă" / "Request a quote", accessible name "Cere ofertă de la {garage}" / "Request a quote from {garage}", placed as a sibling of the row's existing controls (never inside the profile link), at least as tall as the app's tap size (`--mf-tap`, 44 px), and wrapping under the name on a narrow row; the row's name and arrow keep opening the profile, and the remove control is unchanged.

_From 292-saved-garage-quote._

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
### 1345-FR-006 — The web app's background calls that need a session MUST NOT be sent without an access token: the bell's unread-count poll (each tick, and the first) and the push device's key request check the token first and skip the call without one, as the live stream already does. A dashboard tab whose renewal was refused therefore makes no further background call until the account signs in again, and the poll resumes with the new token. Explicit asks (the area and account guards, the sign-in return, the invite, the sign-in dialog, the report link) keep their single renewal; the session's `ask()` and the refresh endpoint are unchanged (the signed-out refresh is ST-510, #398). Colocated unit tests cover the bell and the push device.

_From 1345-staging-observability._

### 1345-FR-007 — A public screen that needs a session for part of its work (the request-a-quote dialog's car list) MUST, when it holds no access token and no stored role hint, open the sign-in dialog without an API call and load once signed in; if the visitor dismisses the sign-in dialog, the request-a-quote dialog shows the state it shows today when the list cannot load, still without a call; with a token or a hint it loads as today. One Playwright test loads `/ro`, `/ro/garages?brand=dacia` and a seeded garage profile and opens its request-a-quote dialog in a fresh context, records every request and response, and asserts none is a 401 and no `POST /api/v1/auth/refresh` is sent.

_From 1345-staging-observability._
### 066-FR-012 — The admin read of accounts (`GET /api/v1/admin/accounts`) MUST carry on each account `serviceSuspended`, true when the account holds a mechanic card at a garage whose status is `suspended`, false otherwise; no screen shows it in this story (the Mecanici table of #27 and the detail page of #28 will show "service suspendat" in red from it). Tests MUST cover a mechanic of a suspended garage (true), of an approved garage (false), an owner of a suspended garage with no mechanic card (false), and the flag turning false once the garage is no longer suspended.

_From 066-suspended-garages._

### 005-FR-001 — The specs repo MUST hold a procedure page "Cereri privind datele personale" at `docs/reference/data-requests.md` with the eight front-matter keys, listed in `llms.txt` with its summary, passing `scripts/docs-lint.mjs`.

_From 005-data-requests._

### 005-FR-002 — The page MUST be marked owner-approved on 2026-10-16 under the owner's 2026-10-11 rule and MUST name the lawyer's later review as a follow-up that does not block anything.

_From 005-data-requests._

### 005-FR-003 — The page MUST cover these request kinds, each in its own section: access, correction, deletion, copy (portability), objection, restriction, consent withdrawal.

_From 005-data-requests._

### 005-FR-004 — For each kind the page MUST state: the channels a request may come through (e-mail to hutanugeorge40@gmail.com, from the account, the contact form), how identity is checked before answering, the deadline (one month from receipt, extendable by two months with a notice to the person that states why, GDPR art. 12(3)), who handles it (the MotorFix admin, one admin role at launch [X21]), the steps, and the reply texts in Romanian and English; for correction, deletion and restriction, the step that tells each recipient the data was shared with (a garage, a processor) of the change, unless impossible or disproportionate (GDPR art. 19).

_From 005-data-requests._

### 005-FR-005 — The page MUST give reply texts, in Romanian and English, for: acknowledgement of receipt, an identity question, the extension notice, each kind's answer, and the refusals (identity not confirmed; manifestly unfounded or excessive), every refusal and extension text naming the person's right to complain to the supervisory authority (ANSPDCP) and to go to court (GDPR art. 12(4)).

_From 005-data-requests._

### 005-FR-006 — The page MUST state what is kept after a deletion and for how long, marked owner-approved: legal documents and audit history while the account or garage is active, then 5 years after closing; photos, clips and recordings 90 days; day-sheet PDFs 30 days; held in one config read by the retention job (ST-1156); the lawyer may change the values later.

_From 005-data-requests._

### 005-FR-007 — The page MUST list the fields an admin fills before deleting an account on request: request reference, date received, identity-checked tick; and MUST say ST-3 (issue 84) uses them.

_From 005-data-requests._

### 005-FR-008 — The page MUST state that each request is recorded as an admin action in the audit history with: who asked, when received, what for (the kind), who handled it, when answered, and the address answered to; for a person without an account the entry has no subject account and its text carries these facts; and how the admin records it until the product does.

_From 005-data-requests._

### 005-FR-009 — The page MUST state the deletion rules: a driver's open quote requests are closed, future bookings are cancelled by the system, the garages concerned are told [X11]; a mechanic or receptionist leaves the team and the reviews of their work stay with the garage [X12]; a garage owner's account is deleted only after the garage is closed through support [X12].

_From 005-data-requests._

### 005-FR-010 — The page MUST state that a deleted driver's reviews stay, shown under "Șofer MotorFix", with the garages' ratings unchanged (ST-140).

_From 005-data-requests._

### 005-FR-011 — The page MUST define the content and format of a data copy (ST-140): a ZIP archive with one JSON file per area of the person's data, the person's media files as they are, and one readable summary in the person's language; the areas listed.

_From 005-data-requests._

### 005-FR-012 — The page MUST state that requests are accepted from people without an account and how their identity is checked.

_From 005-data-requests._

### 005-FR-013 — The issues of ST-3 (george-hutanu/motor-fix-specs#84) and ST-129 (#235) and the feature page `docs/reference/features/admin/mf-46-users-accounts-overview.md` MUST link to the procedure page; MF-46's stale lawyer lines ("Lawyer, still open" on retention and the download, "agreed with the lawyer") and MF-28's download-format NEEDS CLARIFICATION MUST be replaced by a pointer to the page and the owner's 2026-10-16 sign-off.

_From 005-data-requests._

### 005-FR-015 — The owner-only follow-ups (the lawyer's review, legal wording changes, the controller's contact details if they change, a processor contract list) MUST be raised in one `needs-confirmation` comment on the story with exact instructions; the comment does not set the task to Blocked and does not hold the merge.

_From 005-data-requests._

### 1348-FR-005 — The sign-in warm (1169-FR-002) MUST finish before the API's stores close: the warm service keeps every warm it started in flight, and once the application's shutdown has begun it starts no new warm and waits for those running before the Redis store is returned and the database client disconnects, so that `app.close()` resolves only after every warm in flight has finished and no database or Redis call is made after it. The sign-in answer is still never delayed by the warm, and a sign-in that arrives during shutdown is answered without one. A domain integration test that holds a warm's read open MUST fail while the leak is there (`app.close()` resolving before that read finished) and pass after; in CI, `assistant-token.integration.spec.ts` and every other file that follows a signing-in file in its worker run their tests.

_From 1348-release-green._

### 101-FR-011 — Every new text exists under `garage.verification.*` in the shared i18n files, and `shell.frame.verification` is removed in Romanian and English (Romanian hyphenated words use U+2011); the page is a `<name>/` component folder (Principle IV); no new route, DTO or endpoint is added; the generated client is unchanged.

_From 101-verification-progress._

### 009-FR-002 — The launch events `quote_request_started`, `quote_request_sent` and `listing_started` (250-FR-004, 250-FR-005) MUST carry a property `voice` (1–5): for the two request events, the visit's voice at the moment of the action; for `listing_started`, the visit's voice only when the form was opened from Home (FR-006), otherwise no `voice` property. The event contract MUST list `home_visit` and the `voice` property with its allowed values, so anything else is dropped before it leaves, as today.

_From 009-copy-voice-analytics._

### 009-FR-003 — Without a valid granted consent, no event and no voice property MUST leave the browser, and nothing else about the visit changes: no new storage, no new call, no new prompt. The existing one wrapper of the consent service is the only path an event takes.

_From 009-copy-voice-analytics._

### 003-FR-012 — `POST /api/v1/admin/accounts/{id}/delete-on-request` with `{ reference, receivedOn, identityChecked }` MUST validate at the edge: `reference` matching `DR-<four-digit year>-<four or more digits>`, `receivedOn` a calendar date not after today (Europe/Bucharest), `identityChecked` exactly `true`; else 400 `validation_failed`. It MUST refuse with 409 `deletion_not_allowed` an account holding an owner membership of any garage, whatever the garage's status (129-FR-004's rule) and with 409 `admin_account` an admin (FR-003). Otherwise it MUST run the deletion use case of ST-129 for an `active` or a `suspended` account (the conditional write admitting both; 129-FR-001's row and field clearing, 129-FR-007's events, 129-FR-008's `session.revoked`, 129-FR-009's team leave, 129-FR-010–FR-012's review, plate and e-mail rules all unchanged) without the self-service checks (no confirmation text, no 15-minute re-sign-in, no assistant refusal), the assistant grants revoked with reason `account_deleted` (FR-015), and write the deletion's audit entry (action `delete`, subject `account`, kind `account_deleted`) with the admin as actor and `text` = `{ reference, receivedOn }`, never the personal values removed. The answer is 204. (Modifies 129-FR-001.)

_From 003-admin-account-actions._

### 129-FR-002 — The request MUST carry a confirmation: the account's e-mail (case-insensitive) or phone (as normalised at sign-in), or, for an account holding neither, the word `ȘTERGE` or `DELETE`; a mismatch answers 400 `validation_failed` and changes nothing.

_From 129-delete-account._

### 129-FR-003 — The deletion MUST require a sign-in at most 15 minutes old: when the current session's sign-in is older, the API answers 401 `reauth_required` and changes nothing; the web dialog then opens the sign-in and retries once the person is signed in again.

_From 129-delete-account._

### 140-FR-012 — ST-129's deletion use case MUST refuse with 409 `car_in_work` ("Ai o mașină în service. Poți șterge contul după ce o ridici.") when the account is the driver of a job whose status is `in_work` or `paused`, checked after 409 `deletion_not_allowed` (owner) and before 401 `reauth_required`, counted as outcome `refused_in_work`; otherwise the use case runs unchanged (129-FR-001–FR-013).

_From 140-account-delete-export._

### 129-FR-005 — A session opened for an AI assistant MUST be refused with 403 `forbidden`.

_From 129-delete-account._

### 129-FR-006 — After deletion, sign-in by password, phone code, Apple or Google with the account's former e-mail, phone or identity MUST answer as for an unknown account (the existing unknown-account responses, with no hint that the account existed), and sign-up with the former e-mail or phone MUST create a new account; the deleted-account clauses of 393-FR-007 (`phone_taken`) and 083-FR-006 (`provider_failed`) become unreachable, since a deleted account holds no phone, e-mail or identity, and a former number or provider identity signs up a new account as those stories do for a new one.

_From 129-delete-account._

### 129-FR-007 — The deletion's transaction MUST record the outbox events `account.deleted` (payload `{ accountId }`, audience `account:{accountId}`) and, through the garages module, `mechanic.updated` for a detached mechanic and `member.removed` for a removed receptionist (audience `garage:{garageId}`), so that the quotes module's closed-account clean-up (428-FR-001–FR-012) runs, the live hub evicts the account's streams and the garage's open screens re-read their team.

_From 129-delete-account._

### 129-FR-008 — After the deletion commits, the API MUST publish one `session.revoked` live message to `account:{accountId}` through the sign-in service's one method that the password reset and sign-out everywhere call (569-FR-003, now with a third caller; a failed publish is logged and does not change the answer), so every open tab of the deleted account signs out as 128-FR-009 says, without a reload, and lands on Home as a visitor; the deleting tab forgets its push subscription, its session and its live connection as 128-FR-008 does.

_From 129-delete-account._

### 129-FR-012 — When the account held an e-mail, the API MUST, after the transaction commits, queue one ACCOUNT_EMAIL message with purpose `account_deleted`, subject "Contul tău a fost șters" / "Your account was deleted", in the account's language, addressed to the e-mail the account held (read before it was cleared and carried by the message, since the account no longer holds it), as the `password_changed` notice is queued (139-FR-014: the notifications module writes through its own client; a notice that fails to queue is logged and does not undo the deletion); no preference can switch it off.

_From 129-delete-account._

### 140-FR-015 — The driver's Setări MUST end with a panel "Contul tău" / "Your account" that holds the export control of FR-009 and ST-129's "Șterge contul" row and dialog (129-FR-014, moved into the panel for the driver; other roles' Setări keep the row as it is), each action with one line on what it does; it works at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll, and passes the axe checks; a change of the export's state is announced to assistive technology (a polite live region) and every action is reachable and operable by keyboard with a visible focus.

_From 140-account-delete-export._

### 129-FR-015 — The dialog MUST work at 320 px, 390 px, tablet and desktop, light and dark, in Romanian and English, with no sideways scroll, and MUST pass the axe checks; the row and the dialog's texts live in the i18n catalogue.

_From 129-delete-account._

### 129-FR-016 — The endpoint MUST be listed in `infra/observability/inventory.json` with a counter of outcomes (`deleted`, `forbidden`, `refused_owner`, `reauth_required`, `mismatch`, `failed`), a log line without personal values, a panel and an alert on `failed`.

_From 129-delete-account._

### 129-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Valkey where rows are written: FR-001–FR-013 (personal fields cleared and every named row gone; sign-in by each method fails as unknown and sign-up succeeds; the review shows "Șofer MotorFix"; the owner refused; the assistant refused; the stale sign-in refused; the mismatch refused; a mechanic and a receptionist leave the team and the mechanic's reviews and bookings stay; `account.deleted` recorded and the quotes clean-up run once for it, twice idempotent; plates cleared; the e-mail queued with the held address; the audit entry without personal values); and in Playwright: delete a driver account through the dialog, land on Home, fail to sign in with it again, at 390 px and on desktop, in RO and EN.

_From 129-delete-account._

### 292-FR-002 — A row whose garage is not available (`available` false, the row that shows "Indisponibil" today) MUST render no "Cere ofertă" button, including when the row turns unavailable through a live update (291-FR-013).

_From 292-saved-garage-quote._

### 292-FR-003 — The rows of the "Service-uri salvate" panel on Panou (the limited list with "Vezi toate", 291-FR-009) MUST NOT carry the button; they stay as 291-FR-007 describes them.

_From 292-saved-garage-quote._

### 292-FR-004 — Tapping the button MUST read the garage's current public profile (the same details the profile page reads for that garage) and then open the request dialog of 221-FR-002 for it, with that garage ticked in the picker, the driver's cars in the Select (221-FR-003), the garage's priced jobs as switches all off, and the picker of 221-FR-006 behaving as from the profile. While the read is open the button is disabled and shows its pending state; a second tap does nothing. The pending state is exposed to assistive technology (`aria-busy`), and when the dialog closes focus returns to the button that opened it (the overlays service's behaviour, unchanged).

_From 292-saved-garage-quote._

### 292-FR-007 — When the profile read of FR-004 fails because the garage is gone or no longer available (404 or 410), the dialog MUST NOT open, the row MUST show "Indisponibil" / "Unavailable" in the button's place with no toast, as 290-FR-012 (a status text announced politely, so keyboard focus lost with the removed button is not silent); on a failed connection the button returns to idle and a toast shows "Fără conexiune" / "No connection"; on any other error the button returns to idle and a toast shows the shared error text.

_From 292-saved-garage-quote._

### 292-FR-008 — Every new text MUST live in the dashboard's texts in Romanian and English, and the row with its button MUST render well at 320 px, 390 px, tablet and desktop, light and dark, with no sideways scroll at 320 px.

_From 292-saved-garage-quote._

### 292-FR-009 — Tests MUST cover, in Jest: the button on an available row and its absence on an unavailable row and on the Panou panel's rows; a tap reads the garage's profile and opens the request dialog with that garage ticked, its jobs and the source `saved`; the 404, offline and other-error outcomes of FR-007. End to end, in Playwright: as a driver, from Service-uri salvate, send a request to a saved garage and see it under Cererile mele.

_From 292-saved-garage-quote._

### 292-FR-010 — Tapping the button MUST send the existing `quote_request_started` analytics event with source `saved` (added to that event's allowed sources); no other telemetry is added, as no endpoint, queue or event is new.

_From 292-saved-garage-quote._

### 532-FR-002 — A signed-in person's landing MUST be unchanged, and while the sign-in gate dialog keeps the account shown the current screen MUST stay behind it.

_From 532-lost-session-home._

### 500-FR-001 — The system MUST mask an IPv4 address to its first two octets followed by `.x.x` (`81.196.1.2` → `81.196.x.x`).

_From 500-req-ip-behind-proxy._

### 500-FR-002 — The system MUST mask an IPv6 address to its first two groups followed by six `x` groups (`2a02:2f0c:1234:5678:9abc:def0:1234:5678` → `2a02:2f0c:x:x:x:x:x:x`); a compressed form MUST be expanded first (`2a02::1` → `2a02:0:x:x:x:x:x:x`, `::1` → `0:0:x:x:x:x:x:x`), kept groups MUST be written in lower-case hex without leading zeros, and a zone id (`%eth0`) MUST be dropped before parsing.

_From 500-req-ip-behind-proxy._

### 500-FR-003 — The system MUST mask an IPv4-mapped IPv6 address (`::ffff:81.196.1.2`) as the IPv4 address it carries (`81.196.x.x`).

_From 500-req-ip-behind-proxy._

### 500-FR-004 — For a missing, empty or unparseable address the system MUST produce the fixed placeholder `unknown`, and the input MUST appear nowhere in the result.

_From 500-req-ip-behind-proxy._

### 500-FR-016 — The API MUST resolve the caller with a `trust proxy` function that walks the hops from the socket inward and trusts every hop in loopback, link-local, private (RFC 1918), `100.64.0.0/10` or `fc00::/7` (an IPv4-mapped IPv6 hop as the IPv4 address it carries) until it trusts one public hop, and trusts exactly one public hop (Railway's edge PoP, whose range varies by region) when it sits directly before a trusted private hop; the caller is the first hop not trusted. A chain `86.125.92.213, 95.173.1.1, 100.64.0.5` from socket `fd12:e82::1` resolves to `86.125.92.213`. (Modifies 500-FR-008: the trusted hops gain private and the one PoP hop, decided on #303.)

_From 500-trust-railway-edge._

### 532-FR-001 — Whenever the dashboard frame has no account shown (the session lapsed through a refused renewal and no sign-in gate keeps the account shown), the frame MUST open Home (`/`), as sign-out and `session.revoked` already do, and MUST NOT render any role's dashboard.

_From 532-lost-session-home._

### 140-FR-001 — `POST /api/v1/me/data-export` MUST create one DATA_EXPORT for the signed-in driver's own account in state `queued`, record the audit entry of FR-011 in the same transaction, and queue the build; it MUST answer 403 `forbidden` to an assistant session, 429 `export_too_soon` (no row written) when the account has a DATA_EXPORT requested less than 24 hours ago whose state is not `failed`, and 409 `export_ready` (no row written) when the account has a `ready` export; two concurrent requests create one row (a unique constraint or a conditional write, the loser answering 429).

_From 140-account-delete-export._

### 140-FR-002 — `GET /api/v1/me/data-export` MUST return the account's latest DATA_EXPORT (state, requested time, ready time, expiry time) and `canRequestAt` (when the 24-hour rule next allows a request, null when it allows one now), or none, so Setări can show the panel's state; it never returns another account's export.

_From 140-account-delete-export._

### 140-FR-003 — The worker MUST build the ZIP for a `queued` export with at most 3 attempts (the queue's retry with back-off); on success it stores the file, sets `ready` with `ready_at` and `expires_at` = `ready_at` + 7 days, emits `data_export.ready` and queues the e-mail of FR-006; after the third failure it sets `failed` and logs the reason without personal values; an export whose account is `deleted` is set `expired` without a file; any other account status still builds it.

_From 140-account-delete-export._

### 140-FR-004 — The ZIP MUST hold exactly, in UTF-8 with times in ISO 8601: `account.json` (the account's details, roles, sign-in methods without secrets, language), `cars.json` (cars with plates, dates, reminders and driver-logged repairs), `requests-and-quotes.json` (the driver's requests and the quotes received), `bookings-and-jobs.json` (bookings, jobs and the job history as the driver sees it, repairs from MotorFix), `reviews.json` (the driver's reviews and the replies to them), `messages.json` (the driver's support messages, SupportMessage), `notifications-and-preferences.json` (notifications of the last 12 months and every notification preference and push subscription without its keys), `consents.json` (consents and the news consent), `audit.json` (audit entries whose subject or actor is the driver, as the driver's own history shows them; an entry whose subject is another account or a garage carries only the subject's type and the label the driver already sees, never its id), and `README.txt`, a readable summary in the driver's language naming each file and the request date. No other file; an area with no rows is written as `[]`, so every export holds the ten files.

_From 140-account-delete-export._

### 140-FR-005 — Every row in the export MUST belong to the signed-in driver (by owner, driver, author or account id); another person appears only as the product already shows them to this driver (a garage's name and city, a mechanic's first name on the driver's job, a reply's author label); no other account's e-mail, phone, plate or id is ever written. A two-driver test asserts it over every file.

_From 140-account-delete-export._

### 140-FR-007 — `GET /api/v1/me/data-export/download` MUST serve the signed-in driver's own `ready` export as a ZIP download (directly or by redirecting to a short-lived link to the stored file), MUST answer 404 `not_found` for no export, an `expired`, `failed` or `queued` one, and 403 `forbidden` to an assistant session, and 401 `sign_in_required` to no session; a store that fails answers 503 `storage_unavailable` and the export stays `ready`; the response carries `Cache-Control: no-store`; the stored file is never public.

_From 140-account-delete-export._

### 140-FR-008 — A scheduled worker sweep MUST, at least hourly, delete the stored file of every `ready` export past `expires_at` and set it `expired`, idempotently; on `account.deleted` the worker MUST do the same for that account's `queued` and `ready` exports at once.

_From 140-account-delete-export._

### 140-FR-009 — Setări › Contul tău MUST show "Descarcă datele mele" from FR-002's state: no export or `expired` → the button; `queued` → "Pregătim fișierul. Îți trimitem un e-mail când e gata."; `ready` → "Descarcă (ZIP)" with the expiry date in the driver's locale and no request button (this wins over the 24-hour line); `failed` → "Nu am putut pregăti fișierul. Încearcă din nou." with the button; any request younger than 24 hours that is not `failed` → the button disabled with "Poți cere un fișier nou o dată pe zi." (and the same text when the API answers 429); outside `ready`, the age rule wins over the state (an `expired` row younger than 24 hours shows the disabled button), and a `failed` row never counts; each text in Romanian and English in the i18n catalogue.

_From 140-account-delete-export._

### 140-FR-010 — DATA_EXPORT is stored with: id, account, `requested_at`, `status` ∈ `queued` / `ready` / `expired` / `failed`, `zip_key` (nullable), `ready_at`, `expires_at`, `attempts`; the export's module owns its Prisma schema and its migration.

_From 140-account-delete-export._

### 140-FR-013 — ST-129's web dialog MUST show the `car_in_work` refusal's text in place of the generic task error, in both languages.

_From 140-account-delete-export._

### 140-FR-014 — Tests MUST assert, through ST-129's use case and the existing handlers, the effects the story promises: after a driver's deletion sign-in by every method answers as for an unknown account, the reminder job sends nothing to the account, the driver's open request is closed and its waiting quotes `lost`, the future booking is cancelled by `system` with the garage and mechanic told, and a published 4-star review stays with author "Șofer MotorFix", no name and no account link, while the garage's and the mechanic's rating and review count are unchanged.

_From 140-account-delete-export._

### 140-FR-016 — The three endpoints, the export queue and the sweep MUST be listed in `infra/observability/inventory.json` with a counter of export outcomes (`requested`, `too_soon`, `already_ready`, `forbidden`, `ready`, `failed`, `expired`, `downloaded`), log lines without personal values, a panel, and an alert on `failed`; the deletion counter gains `refused_in_work`.

_From 140-account-delete-export._

### 140-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Valkey where rows are written: FR-001–FR-003 and FR-007–FR-008 (states, the 24-hour, `ready` and concurrent refusals, the three attempts, the 7-day expiry and file deletion, the clean-up on deletion, the assistant refusals, the download for the owner only), FR-004–FR-005 (every file present, no other file, the two-driver isolation over every file), FR-006 (one e-mail, none without an address), FR-011, FR-012 (refused with `in_work` and `paused`, allowed with `done`), FR-014; the web panel and dialog states in component specs (FR-009, FR-013, FR-015); and in Playwright: request the export and download the ZIP from the sandbox e-mail's link, delete a test driver and fail to sign in with it. Each test file names its FRs in a whole-line `// @traces` comment.

_From 140-account-delete-export._
### 500-FR-009 — The trusted hops MUST remain a list of address ranges, never a count of hops: a chain `<spoof>, <visitor>, <100.64.0.0/10 address>` from a unique-local socket MUST resolve its caller to `<visitor>`, and no public address MUST ever be trusted.
### 500-FR-017 — The function MUST never trust two public hops, a public hop that is not directly before a trusted private hop (so a public socket trusts nothing), any hop past the trusted public hop, or an entry that is not an address; a client-forged prefix before the real chain resolves to the visitor. It is never a hop count and reads no header other than X-Forwarded-For (X-Real-IP is not read; `req.ip` stays the one source). (Modifies 500-FR-009: one public hop is now trusted, by position, never by count.)

_From 500-trust-railway-edge._

### 500-FR-010 — A request arriving from a public socket address MUST resolve its caller to that socket address whatever forwarded-for header it carries.

_From 500-trust-railway-edge._

### 105-FR-016 — `refusal` MUST live in a shared module of the auth library (`libs/domain/src/auth/http-refusal.ts`), re-exported where the existing imports expect it or every import updated; after the change no file outside `libs/domain/src/auth/` imports `auth/sign-up.service` for it (`git grep` shows none). (#568)

_From 105-brand-list-admin._

### 003-FR-001 — `GET /api/v1/admin/accounts/{id}` MUST answer, for a MotorFix admin, the account's: name, e-mail, phone, language, roles (in the list's order), the linked garage when the account owns one, is receptionist at one or holds a mechanic card at one (id, name, status), joined time, last active time, status, the suspension reason when `suspended`, counts (cars, quote requests, reviews), sign-in methods (`password`, `google`, `apple`, `whatsapp_phone`, as a list of methods only), whether the account holds `admin` (so no action is offered) and, for a garage owner, the garage's legal documents (ids and titles) the page can open. The answer MUST carry no password hash, no sign-in subject and no token.

_From 003-admin-account-actions._

### 003-FR-002 — The read and every action route of this story MUST be admin-only through the existing actor check: any other role answers 404 `not_found`, a missing token 401 `sign_in_required`, a suspended caller 403 `account_suspended`; an unknown id, a malformed id or a `deleted` account answers 404 `not_found`; every error as RFC 9457 problem details with a `code`.

_From 003-admin-account-actions._

### 003-FR-003 — The actions (FR-006, FR-007, FR-010, FR-012) MUST be refused with 409 `admin_account` for an account that holds `admin`, before any write, and the page MUST offer no action button on such an account.

_From 003-admin-account-actions._

### 003-FR-006 — `POST /api/v1/admin/accounts/{id}/reset-access` MUST, in one transaction: revoke every refresh token of the account (the sign-out-everywhere step), write one audit entry (action `update`, subject `account`, kind `access_reset`, actor the admin with role `admin` and their name) and record the outbox event `account.access_reset` (`{ accountId }`, audience `account:{accountId}`). After the commit it MUST publish `session.revoked` to `account:{accountId}` through the sign-in service's one method (569-FR-003) and, when the account holds a `password` identity and an e-mail, send the existing password-reset e-mail with its link directly (194-FR-012, the reset flow's own request), never to a phone-only or e-mail-less account. The answer is 200 `{ email: 'sent' | 'none' | 'failed' }`; a refused send answers `failed` with the sessions already ended, and a repeat of the call is allowed as the retry. The admin never receives, sees or sets a password.

_From 003-admin-account-actions._

### 003-FR-007 — `POST /api/v1/admin/accounts/{id}/suspend` with `{ reason }` (10 to 500 characters after trimming, else 400 `validation_failed`) MUST, in one transaction: move `ACCOUNT.status` `active` → `suspended` by a conditional write (zero rows changed rolls back and answers 409 `account_already_suspended`, or 404 when the account is `deleted`), store the reason as the account's suspension reason, revoke every refresh token, revoke every active assistant grant of the account with reason `account_suspended` (FR-015), write one audit entry (action `update`, subject `account`, field `status`, old `active`, new `suspended`, kind `account_suspended`, `text` = the reason, actor the admin) and record the outbox event `account.suspended` (`{ accountId }`, audience `account:{accountId}`). After the commit it MUST publish `session.revoked` as FR-006 does and, when the account holds an e-mail, queue one ACCOUNT_EMAIL `account_suspended` (FR-022) in the account's language; an account without an e-mail gets no message; a send the sender refuses is logged and counted as outcome `email_failed`, with no retry, and does not change the answer. The answer is 200 with the page's read (FR-001).

_From 003-admin-account-actions._

### 003-FR-009 — The suspension's clean-up runs through the existing consumer of `account.suspended` (428-FR-001–FR-012): the person's open quote requests are closed, their future bookings are cancelled with `cancelled_by_side` `system`, and the garages are told by REQUEST_CANCELLED and BOOKING_CANCELLED [X11]; this story adds no second handler and MUST test that the existing one runs exactly once for the event; a restore reopens nothing (428-FR-001 ignores `account.restored`).

_From 003-admin-account-actions._

### 003-FR-010 — `POST /api/v1/admin/accounts/{id}/restore` with `{ note }` (optional, at most 500 characters) MUST, in one transaction: move `suspended` → `active` by a conditional write (zero rows changed answers 409 `account_not_suspended`, or 404 when `deleted`), clear the suspension reason, write one audit entry (action `update`, subject `account`, field `status`, old `suspended`, new `active`, kind `account_restored`, `text` = the note when given, actor the admin) and record the outbox event `account.restored` (`{ accountId }`, audience `account:{accountId}`); after it the person can sign in again. Requests closed and bookings cancelled by the suspension stay so, revoked assistant grants stay revoked, and no message is sent to the person. The answer is 200 with the page's read.

_From 003-admin-account-actions._

### 003-FR-011 — Suspending, restoring or deleting an account MUST never change a garage's status, its listing or its other members' access: a suspended owner's garage stays listed and its receptionists keep working; the page MUST say, for an owner whose garage is `suspended`, that the garage is suspended from its own page (MF-44) and link there, offering no garage action.

_From 003-admin-account-actions._

### 003-FR-013 — A mechanic's or a receptionist's account deleted on request MUST leave the team as 129-FR-009 says, with the reviews of their work staying with the garage [X12]; the page MUST disable "Șterge la cererea titularului" for a garage owner with the text "Garajul se închide mai întâi prin suport" / "The garage is closed through support first" and keep it disabled until the account holds no owner membership.

_From 003-admin-account-actions._

### 003-FR-014 — Every action MUST write its audit entry and its outbox event in the same transaction as its change, with the admin's account id, role `admin` and first name as the actor (164-FR-001), and every status change MUST be a conditional write so that two admins acting at once leave exactly one winner: the loser answers 409 and the web re-reads the page. Reads write nothing except FR-005's document opening.

_From 003-admin-account-actions._

### 003-FR-016 — Every session end of this story (reset, suspend, delete) MUST reach the person's open tabs through `session.revoked` on `account:{accountId}` (128-FR-009), and the live hub's eviction on `account.suspended` and `account.deleted` (254-FR-008) stays as it is; a failed publish is logged and does not change the answer.

_From 003-admin-account-actions._

### 003-FR-020 — The five routes MUST be REST with OpenAPI, their DTOs in the contracts library validated at the edge, and the generated Angular client regenerated; the events `account.access_reset`, `account.suspended`, `account.restored`, `account.deleted` and `assistant_grant.revoked` are the kinds already declared in the contracts' event list.

_From 003-admin-account-actions._

### 003-FR-023 — Tests MUST cover, before the code (Principle II), in Jest on real PostgreSQL and Valkey where rows are written: each action with its audit entry and event (FR-006, FR-007, FR-010, FR-012); sessions revoked on reset and suspend; sign-in refused for a suspended account by every method and refresh; restore and sign-in again; delete on request refused without the fields and for a garage owner whose garage is open or suspended, allowed for a driver, a mechanic and a receptionist (team left, reviews kept) and for a suspended account; the suspension's clean-up run exactly once; the document opening logged; the actions refused on admin accounts; 404 for non-admins and unknown ids; the concurrent suspend, restore and delete; the e-mail queued with the reason and the contact link, none for an e-mail-less account; the reset e-mail for a password account, none for phone-only, `failed` on a refused send with the tokens gone; the grants revoked per trigger (suspend, delete, role loss) with one event per grant, a still-valid token refused, a role added leaving grants intact; the history filter by actor or subject and the 50 limit; and in Playwright: suspend a seeded driver, fail to sign in as that driver, restore it and sign in, at 390 px and on desktop, in Romanian and English.

_From 003-admin-account-actions._

### 500-FR-012 — `hops` MUST list the X-Forwarded-For entries left to right, then the address of the socket the API was called on, each masked as FR-001–FR-004 mask the caller (an entry that is not an address reads `unknown`, an empty entry is skipped), comma-separated without spaces. At most the rightmost 8 entries of the header are listed; when more were sent, the list starts with `+<n>`, the number left out. With no X-Forwarded-For header the list is the socket address alone. The entry just before the socket is the one the web edge appended (FR-015).

_From 500-trust-railway-edge._

### 500-FR-013 — `headers` MUST list the names, never the values, of the forwarding-related request headers present, lower-case, sorted and each once, comma-separated: `forwarded`, `via`, `x-real-ip`, `true-client-ip`, `cf-connecting-ip`, `cdn-clientip`, `fastly-client-ip`, `x-client-ip`, `x-cluster-client-ip`, every `x-forwarded-*`, `x-railway-*` and `x-envoy-*` name, and every other name ending in `-ip` or `clientip`. Only a name made of letters and hyphens, at most 40 characters, is listed, at most 16 names; `none` when no such header is present.

_From 500-trust-railway-edge._

### 500-FR-014 — When an `x-real-ip` header is present, `real-ip` MUST list its comma-separated entries, each masked as FR-012 masks a hop; when a `Forwarded` header is present, `forwarded` MUST list the `for=` value of each of its elements, quotes, IPv6 brackets and a port removed, each masked the same way (an obfuscated or missing `for=` reads `unknown`). Both keep at most 8 entries, the rightmost, with the same `+<n>` prefix.

_From 500-trust-railway-edge._

### 500-FR-015 — The web edge MUST keep forwarding the X-Forwarded-For chain it was given unchanged and append the address of the socket it was called on (`<given>, <socket>`, or `<socket>` alone), so the API's `hops` show that socket hop masked; this PR asserts the behaviour and does not change it.

_From 500-trust-railway-edge._

### 1372-FR-001 — For each account in its list (`PEOPLE`, matched by e-mail), the seed MUST restore the account's password identity to its seeded state: an identity with method `password` and subject equal to the e-mail whose hash verifies against the seed password; a missing identity is inserted, a hash that does not verify is rewritten with a new argon2id hash of the seed password, and a hash that verifies is left byte-for-byte unchanged (the stored hash is verified against the seed password, never compared to a fresh hash).

_From 1372-seed-restores-accounts._

### 1372-FR-002 — For each account in its list, the seed MUST ensure every role in that account's seeded `roles` exists on it, inserting the missing ones; a role the account holds that the seed does not list for it MUST be left in place.

_From 1372-seed-restores-accounts._

### 1372-FR-003 — For each account in its list with an `at`, the seed MUST ensure its seeded garage link exists with the seeded values: for `as: owner` or `receptionist`, a `garage_member` row at the seeded garage with that role; for `as: mechanic`, a `mechanic` row for the account at the seeded garage with `can_answer_quotes` equal to the seeded `answersQuotes` (false when absent). A missing link is inserted and a link at the seeded garage with other values is set to the seeded ones; a link at any other garage is left in place; when that link holds the seeded role (an account holds one role at one garage, `garage_member` unique on account and role; one `mechanic` row per account) the seeded link cannot be added, and the seed prints `seed: <e-mail> is <role> at another garage, so its link to <slug> is not added` on stderr and goes on.

_From 1372-seed-restores-accounts._

### 1373-FR-006 — The staging guard of `scripts/reset-staging.sh`, the refusal on `APP_ENV=production`, the `SEED_PASSWORD` rules and the seed's idempotence (`1372-FR-004`) MUST be unchanged; accounts outside the list MUST stay untouched (`1372-FR-005`, whose `status` column now belongs to the seed per FR-002).

_From 1373-seed-status-identity._

### 1372-FR-006 — The staging guard of `scripts/reset-staging.sh`, the staging-only seed in the api's Railway pre-deploy (1370-FR-001), the refusal on `APP_ENV=production` and the `SEED_PASSWORD` guard MUST be unchanged, and the seed password's value MUST never be printed to stdout, stderr, a log or an error message.

_From 1372-seed-restores-accounts._

### 1372-FR-007 — Tests come first and live in `libs/domain/src/seed.integration.spec.ts` (PostgreSQL): a drifted-account test (a seeded account with a hash that does not verify, a missing seeded role and no garage link is restored; a renamed seeded account keeps its name; an account outside the list with a wrong hash, no roles and no link is unchanged) and a second-run test that proves FR-004, each carrying `// @traces 1372-FR-<n>` (the form `.claude/scripts/lib/traces.mjs` reads); the test of `1370-FR-006` that asserts a user-changed hash survives is replaced by these.

_From 1372-seed-restores-accounts._

### 1373-FR-002 — For each account in its list, the seed MUST restore the account's `status` to the seeded one (`active`, or the entry's `status`), writing only when it differs.

_From 1373-seed-status-identity._

### 1373-FR-003 — For each account in its list, the seed MUST leave exactly one `password` identity: the one FR-001 of 1372 repairs (subject = e-mail preferred), every other `password` identity of that account deleted; identities of another method and of other accounts are untouched.

_From 1373-seed-status-identity._

### 1373-FR-004 — After every seed run, no seeded account MUST hold a quote request created since the start of the current Bucharest day: `clearDay()` keeps removing what seeded accounts sent in the last 25 hours, and the seed's own requests are written dated before the start of the Bucharest day (2 h and 1 h before it).

_From 1373-seed-status-identity._

### 1373-FR-005 — The seed MUST print exactly one summary line on stdout per run, `seed: restored password <n>, status <n>, roles <n>, link <n>, extra password identities <n>; cleared <n> quote requests`, each count the number of accounts that existed before the run whose field it wrote (an account that lost three extra password identities counts 1); the seed password's value MUST never appear in stdout, stderr or an error.

_From 1373-seed-status-identity._

### 1373-FR-007 — Tests come first: integration tests (`libs/domain/src/seed.integration.spec.ts`) for a `deleted` seeded account, one with two password identities, the day's count at 0 after a seed and the summary line; a unit test of the pre-deploy command run split into words with no shell, each carrying `// @traces 1373-FR-<n>`.

_From 1373-seed-status-identity._

### 1156-FR-004 — The job MUST delete every sign-in code, phone-change code, account token (every purpose) and refresh token whose expiry has passed, used or not, and every staff invite in status `sent` whose expiry has passed; `accepted` and `revoked` invites stay.

_From 1156-retention-job._

### 1204-FR-001 — An account's acceptance MUST be "pending" when its latest stored `terms` acceptance version differs from the terms version in force, or its latest stored `privacy_notice` acceptance version differs from the privacy-notice version in force, or either kind has no row at all; the versions in force are the two version constants in the contracts library (`TERMS_VERSION`, `PRIVACY_VERSION`), read at call time, never copied.

_From 1204-terms-reaccept._

### 1204-FR-002 — Every API route that needs a session MUST, once the actor is admitted (valid token, active and not suspended account, role in use), refuse a pending account with 403 and body `{ code: "consent_required", message, termsVersion, privacyVersion }` naming the versions in force, before the route's body is validated or run; this holds for every role, every sign-in method and the admin area. A public route, with or without an optional actor, is unaffected.

_From 1204-terms-reaccept._

### 1204-FR-003 — Exactly two session routes MUST stay open to a pending account: the new acceptance route (FR-004) and `POST /api/v1/auth/sign-out`; token renewal (`POST /api/v1/auth/refresh`) keeps working as it needs no actor check. Sign-in, OAuth and phone sign-in keep issuing tokens unchanged: pending is signalled on the calls that follow, never by refusing the sign-in.

_From 1204-terms-reaccept._

### 1204-FR-004 — `POST /api/v1/me/acceptance` MUST take `{ termsVersion, privacyVersion }` validated at the edge; when both equal the versions in force it MUST write, in one transaction, one acceptance row per kind whose latest version differs from the one in force (version in force, the account's language, the method of the account's first identity in `SignInMethod` order, since the session does not carry its sign-in method (research R2), and the acceptance time), keep every earlier row, record one "consent given" audit entry by the account (field `consent`, value both versions) and answer 204; when either version differs from the one in force it MUST answer 400 `consent_required` (the existing refusal shape of sign-up, which gains the two fields `termsVersion` and `privacyVersion` naming the versions in force, additive for sign-up) and write nothing. A call with no acceptance pending MUST answer 204 and write nothing.

_From 1204-terms-reaccept._

### 1204-FR-006 — Notifications MUST be produced and sent for a pending account exactly as for an accepted one, on every channel the account chose (`JOB_READY`, reminders, every other message); no notification path checks the acceptance.

_From 1204-terms-reaccept._

### 1204-FR-007 — The web app MUST show a blocking dialog, in the page's language, whenever a signed-in call answers `consent_required` and right after a sign-in whose first call answers it: title and one sentence saying the terms of use and the privacy notice changed, the two texts' titles linked to `/{lang}/terms` and `/{lang}/privacy` in a new tab each followed by its version date from the refusal, one main button "Accept" ("Accept" in both languages' sense: RO "Accept", EN "Accept") and a secondary "Deconectare" / "Sign out"; it has no close control, Escape and a click outside do nothing, focus is trapped in it and starts on "Accept", "Accept" is disabled while the acceptance is being sent (one request per press), and the dashboard content behind it is not shown. "Accept" sends FR-004, then the refused call once more, then the dashboard of the role in use opens; a failed acceptance shows an error line and leaves the dialog up; "Sign out" signs out and goes to Home.

_From 1204-terms-reaccept._

### 1204-FR-009 — A pending analytics choice bound to an account (made while signed out after a sign-out, or left pending at sign-out) MUST be sent to that account's consent route in the first reconciliation after that account signs in, exactly once, and MUST never be stored without the account or under another account: when a different account signs in, the choice bound to the first account is dropped; a unit test covers sign-out → choice → sign-in → one record (OD-33, 2026-10-16; modifies 244-FR-013 by naming the sign-in as a resend moment).

_From 1204-terms-reaccept._

### 1204-FR-011 — `/ro/terms`, `/ro/privacy`, `/en/terms` and `/en/privacy` MUST each set the document title from its `public.legal.*` title key, in the page's language; the route definitions carry the title; a test asserts each title key begins with the matching legal document's own title and a check (unit or end-to-end) reads the document title on each of the four addresses.

_From 1204-terms-reaccept._

### 1204-FR-013 — At 320 px and 390 px in the dashboard frame (one rule for every dashboard route: the bar is offset by the tab bar's height plus the safe area), while the analytics consent bar is unanswered, its "Accept" and "Refuz" buttons MUST be fully visible, not overlapped by the dashboard tab bar, each at least 44×44 px; after an answer the bar is gone and the tab bar sits at the bottom edge with nothing under it; when the bar shows, the first Tab from the document start lands in the bar, and the focus ring of its buttons is never hidden by the tab bar. A Playwright check at 320 px clicks both buttons on `/app/garage/requests` and `/app/driver`.

_From 1204-terms-reaccept._

### 1204-FR-014 — The development and test seed MUST write current-version `terms` and `privacy_notice` acceptance rows for every seeded account except one new seeded driver whose rows carry version `2026-10-11` for both kinds, so every existing end-to-end and QA flow keeps signing in without the dialog and the stale account proves it.

_From 1204-terms-reaccept._

### 1204-FR-015 — Failing-first tests MUST cover: the pending rule (older row, missing row, current rows) and the 403 on a gated route for each role; the two open routes; the acceptance write (rows per pending kind, earlier rows kept, audit entry, 400 on stale versions, 204 idempotent); the MCP 403 and recovery after the owner accepts; a notification produced for a pending account; the dialog (shows on `consent_required`, no dismissal, Accept then resend, Sign out, error state) in both languages; FR-008 and FR-009 in the browser consent service; the legal titles and labels; the tick's fixed id; the bar at 320 px (Playwright); and an end-to-end test that signs in as the stale seeded account at 390 px and on desktop, sees the dialog, accepts and reaches the dashboard. The `// @traces` comments name `1204-FR-<n>`, the only form the trace matrix reads (it keys a feature by its number; 1204-hours-row-live-regions shares it).

_From 1204-terms-reaccept._

### 1204-FR-016 — The new route ships with its observability in the same PR: request-duration by route for `POST /api/v1/me/acceptance`, one product counter of acceptances recorded (no account id, labels from fixed sets) and one counter of `consent_required` refusals by surface (`api`, `mcp`), each listed with its panel and alert in `infra/observability/inventory.json`.

_From 1204-terms-reaccept._

### 102-FR-001 — The capabilities table (`ROLES`, `CAPABILITIES`, `Permissions`, the role rows and `capabilitiesOf`) MUST live in one browser-safe module of the contracts library (`libs/contracts/src/capabilities.ts`, imported as `@motor-fix/contracts/capabilities`), read by the API's policy, the live filter and the web app; the domain library re-exports it so no existing import path breaks. The web's view list MUST type each view's `capability` with the table's `Capability` type, and a test MUST fail on a view naming a capability the table does not hold.

_From 102-garage-members._

### 102-FR-003 — Whether a person sees a view, a Panou section or an action, and whether the server lets them call it, MUST be decided in this order: a feature switched off removes it for everyone (404 `feature_off` on the server, 398-FR-007), then the role's row, then the mechanic's permissions. `allowedViews` already applies this order for the menu; on the server the held order stays role first, then feature (055-FR-003, `garage-mechanics.service.ts` "so staff and strangers never learn whether the team is on"): same-garage staff outside their row get 403 whatever the switch, and the owner of a garage with the feature off gets 404 `feature_off`.

_From 102-garage-members._

### 1369-FR-001 — The garage menu, tab bar and routes of a receptionist MUST come from the capability table's receptionist row (102-FR-004), so that they hold "Profilul service-ului" / "Garage profile" and lack Mecanici and Prețuri; the frame's receptionist test MUST render her from that row (`capabilitiesOf('receptionist', …)`), never from a hand-written list, and assert the entry present.

_From 1369-receptionist-profile._

### 423-FR-001 — Panou (`/app/garage`) MUST show a person whose capabilities hold `garage.own_jobs` but neither `garage.profile` nor `garage.feature_switches` (a mechanic, with or without `can_answer_quotes`) an own-jobs section in place of the placeholder line of 102-FR-005: a list of the jobs the existing jobs read returns for them whose start falls on today's Bucharest day or that are `in_work` or `paused`, ordered by start time, each row carrying the start time (HH:MM), the car's brand and model, the plate when the read carries one, the job names and the stage label of Lucrări; a next-booking line with the start (day and HH:MM) and the car of the earliest own job starting after now, absent when there is none; and a load line, n counting the rows shown and m those whose stage is done, "{n} lucrări azi · {m} terminate" / "{n} jobs today · {m} done" with the Romanian count forms of the shared formatter. The section declares its capability as 102-FR-005 asks, never a role string; a mechanic with `can_answer_quotes` sees the requests panel above it, as today, and nobody sees figures, demand or reviews on it who does not today.

_From 423-mechanic-garage-dashboard._

### 102-FR-006 — The views Recenzii and Profilul service-ului, now reachable by the receptionist, MUST show no "Răspunde" and no "Modifică profilul" to her: neither button exists on `main` today, and the story that adds one MUST gate it on an owner-only capability of the table, not on the view capability. The garage profile read (`GET /api/v1/garages/:garageId/profile`) MUST answer the receptionist as it answers the owner.

_From 102-garage-members._

### 102-FR-008 — The schedule read (`GET /api/v1/garages/:garageId/schedule` and the day sheet, `garage.schedule`) MUST, for a mechanic, return only bookings whose mechanic card is the mechanic's own (`BOOKING.mechanic_id` = their MECHANIC id); a `mechanicId` query naming any id other than her own MUST answer 403 `forbidden` without a lookup, and bookings with no mechanic (`mechanic_id` null) are not hers. Jobs already follow this rule (`garage-jobs.service.ts` `scope`).

_From 102-garage-members._

### 102-FR-009 — No response to a mechanic MUST carry a driver's phone, and a plate MUST appear only on the mechanic's own bookings and jobs (079-FR-015 holds; the schedule rows of FR-008 and the request reads MUST go through `describeCustomer` or an equivalent that a test proves by walking every field of every garage read's answer as a mechanic for a `phone` key).

_From 102-garage-members._

### 102-FR-015 — When the account re-read that follows `mechanic.updated` or `garage.features_changed` (531-FR-002) no longer allows the view on screen, the frame MUST open Panou (it already leaves the view) and show, once, the short message "Nu mai ai acces la această secțiune." / "You no longer have access to this section." on the dashboard's status line.

_From 102-garage-members._

### 102-FR-016 — When a call under the signed-in garage's own path answers 404, the garage dashboard MUST read the account again, once per such 404 and coalesced while a re-read is in flight, counting only calls under `/api/v1/garages/{garageId}/` of the signed-in garage; when `garageAccess` no longer holds that garage, the dashboard body MUST show "Nu mai ai acces la acest service" / "You no longer have access to this garage" with a link "Spre pagina principală" / "To the home page", and the garage menu MUST show no view. A 404 while the garage is still held changes nothing (a feature off, a resource that is gone).

_From 102-garage-members._

### 423-FR-003 — Panou MUST show, above the own-jobs section, a link "Foaia mea de zi" / "My day sheet" to the Programări view (`/app/garage/schedule`) when the garage's `day_sheets` switch is on and the person's capabilities hold `garage.schedule`; absent otherwise. The view itself stays ST-263's: until it ships, the link opens the view's coming text.

_From 423-mechanic-garage-dashboard._

### 423-FR-005 — The mechanic's menu and routes MUST keep coming from the capability table and the switches (102-FR-004): with no permission ticked the garage menu holds Panou, Lucrări, Istoric modificări and Setări, plus Programări when `day_sheets` is on; Cereri de ofertă appears with `can_answer_quotes`; Echipa, Prețuri, Recenzii and Profilul service-ului never; a typed address of a view she lacks lands on Panou; the Setări view shows a mechanic only her own device and notification choices (102-FR-013 holds).

_From 423-mechanic-garage-dashboard._

### 423-FR-006 — A permission change MUST reach an open dashboard within 5 seconds of the owner's save answer, without a reload: `mechanic.updated` re-reads the account, the menu, the tab bar and Panou's sections follow the new capabilities, and a view no longer allowed is left for Panou with "Nu mai ai acces la această secțiune." (102-FR-015 holds); the permissions are read from the mechanic card on every call, never from the sign-in token, so the server enforces the change on the next call.

_From 423-mechanic-garage-dashboard._

### 423-FR-010 — Tests MUST prove that `allowedViews` yields the menu of FR-005 for each permission on and off, and that the web's job lists re-read on `job.mechanic_changed` (FR-002); the Playwright suite MUST add, on a phone viewport, a mechanic who signs in, sees only her job on Panou, opens it and ticks a step, while `can_answer_quotes` is saved as the owner's save writes it (the mechanic's column and its `mechanic.updated` event in one transaction) and Cereri de ofertă appears for her without a reload, then goes when it is unticked. The odometer reading at reception and the owner's permission screen are not built yet (ST-276 #163 and ST-399 #202, both open); each brings its own end-to-end step with it (decision taken for the owner on 2026-10-25, see Clarifications). The landing per role and the role used last are ST-1381's tests.

_From 423-mechanic-garage-dashboard._

### 423-FR-011 — The mechanic's Panou MUST be phone-first: readable at 320 px and 390 px, a tablet and a desktop, light and dark, Romanian and English, with no sideways scroll at 320 px and no text under 12 px; its texts MUST be in the garage translation files in both languages.

_From 423-mechanic-garage-dashboard._

### 423-FR-012 — This story MUST write nothing on the server beyond FR-004, add no endpoint, no event emitter and no audit entry (reading the dashboard is not recorded); the own-jobs section is built from the existing jobs read, and `job.mechanic_changed` keeps its emitter with the story that lets an owner reassign a job.

_From 423-mechanic-garage-dashboard._

### 1381-FR-001 — `GET /api/v1/me` MUST return no `garageAccess` entry for a mechanic card whose `removed_at` is set (the card lookup in `libs/domain/src/auth/who-am-i.ts`), so that after `mechanic.removed` or the next 404 the re-read of 102-FR-016 finds the garage gone and the dashboard shows "Nu mai ai acces la acest service" / "You no longer have access to this garage" with its home link and no view; a member's row at the same garage is unaffected, and her next call under the garage's path answers 404 (the actor loader already treats a removed card as none).

_From 1381-mechanic-scope._

### 1381-FR-002 — Tests MUST prove, in Jest on real PostgreSQL and Valkey, the own-jobs scope as the mechanic's contract: the jobs list, the single job read, the job steps, the schedule and the day-sheet reads answer a mechanic her own items, 403 for a colleague's item at the same garage, 404 for another garage's and 404 for a mechanic whose card is removed; and that a booking with no mechanic is not hers (102-FR-007, 102-FR-008 held and proven across these reads).

_From 1381-mechanic-scope._

### 1381-FR-003 — Tests MUST prove, through each existing route, the quote inbox, sending a quote and declining a request pass for a mechanic with `can_answer_quotes` and answer 403 without it.

_From 1381-mechanic-scope._

### 1381-FR-004 — Tests MUST prove that confirming a booking, confirming a driver's requested new time, reading the team, patching the garage settings, switching a feature, reading or writing the prices and reading the garage figures answer 403 for a mechanic whatever her permissions (102-FR-007).

_From 1381-mechanic-scope._

### 1381-FR-005 — Tests MUST prove a permission unticked is enforced on the very next call (the card's column written on the row, no new sign-in), and that `capabilitiesOf` yields `garage.move_bookings` only with `can_move_bookings` and `garage.final_price` only with `can_record_final_price`, until their routes ship (ST-199, ST-203, ST-206).

_From 1381-mechanic-scope._

### 1381-FR-006 — A test MUST deep-walk, as a mechanic, the answers of `/me`, the jobs list, the single job, the job steps and (with `can_answer_quotes`) the quote inbox and a request's detail for any key matching `/phone/i` and find none (`/me`'s own top-level `phone` and `phoneConfirmed` are her own account's and are left out of the walk, 097-FR-005), and MUST assert the plate is present on her own jobs and that the quote inbox and the request detail carry no `plate` key (102-FR-009, 079-FR-015 proven for the mechanic across these reads).

_From 1381-mechanic-scope._

### 1381-FR-007 — Tests MUST prove `landingFor` for each role and for the role used last (082-FR-017 over 079-FR-012), an account that is a mechanic and a driver included.

_From 1381-mechanic-scope._

### 1381-FR-008 — This story MUST change nothing on the server beyond FR-001: no endpoint, no event emitter, no audit entry, no screen and no contract change; the proofs extend the existing specs the Build brief names and add only `libs/domain/src/auth/mechanic-launch-actions.api.integration.spec.ts`; each test file carries a whole-line `// @traces` comment naming its `1381-FR-<n>` ids.

_From 1381-mechanic-scope._

### 099-FR-001 — Panou (`/app/garage`) MUST be built from one declared list of sections, each with a key, a title, the dashboard view it opens, the capability it needs, the garage feature switch it needs (if any) and a release mark, in this default order: `kpi` "Cifrele zilei" / "Today's numbers" (the slot for the four numbers of #119), `now` "În lucru acum" / "In work now", `req` "Cereri de ofertă" / "Quote requests", `load` "Încărcarea mecanicilor azi" / "Mechanics' load today", `sched` "Programul de azi, pe elevatoare" / "Today's schedule, by lift", `funnel` "De la profil la cerere, pe săptămâni" / "From profile to request, by week", `brands` "Mărci cerute luna asta" / "Brands requested this month", `reviews` "Recenzii noi" / "New reviews". The list is the one later stories (#119, #133, #20, #131, #132, #190) fill and the one MF-32 stores layouts against; no other order or key is introduced for Panou.

_From 099-overview-sections._

### 011-FR-002 — Panou MUST read, in the browser, the person's layout for the garage role the session holds (the first of `garage`, `receptionist`, `mechanic` it holds) before it draws its sections, and draw only the sections that are both in the person's list (099-FR-002) and visible in the layout, in the list's order: the hidden step comes after the four of 099-FR-002, so a feature switched off, a missing capability or an unreleased mark leaves a section out whatever the layout says; a section hidden by the layout is absent from Panou and its data is not requested. While the read is in flight Panou shows no section and no count (the strip row's pill and button, the legal-check panel and the first-steps card stay); a failed read draws the default (every section the person may see) (modifies 099-FR-002).

_From 011-dashboard-sections._

### 099-FR-003 — Each section's title MUST be a heading; when the person's allowed views (`allowedViews` over the same account) include the section's target view, the heading MUST be a link to it — `now` and `sched` → `schedule`, `req` → `requests`, `load` → `team`, `kpi`, `funnel` and `brands` → `profile`, `reviews` → `reviews` — that opens the view on click and on Enter or Space, with a visible focus ring, a tap target at least 44 px high on phones and the section's name as its accessible name. When the target view is not in the person's allowed views, the heading MUST be plain text and nothing is navigable.

_From 099-overview-sections._

### 099-FR-004 — A section whose story has not shipped MUST show, under its title, one empty-state sentence saying what will appear there and nothing else — `kpi` "Aici apar cifrele zilei: cereri, programări, lucrări și încasări." / "Today's numbers appear here: requests, bookings, jobs and takings."; `now` "Aici apar lucrările în curs, cu poze, video și live din atelier." / "Jobs in progress appear here, with photos, video and live from the workshop."; `load` "Aici apare încărcarea fiecărui mecanic pe ziua de azi." / "Each mechanic's load for today appears here."; `sched` "Aici apare programul de azi, elevator cu elevator." / "Today's schedule appears here, lift by lift."; `funnel` "Aici apare drumul de la vizitele pe profil la cereri, pe săptămâni." / "The path from profile views to requests appears here, by week."; `brands` "Aici apar mărcile cele mai cerute luna asta." / "The most requested brands this month appear here." — and MUST NOT show sample numbers, rows, charts, names or dates. The sections already built keep their own empty states (343-FR-006, 074-FR-001).

_From 099-overview-sections._

### 011-FR-003 — The strip of 099-FR-005 MUST become a row holding, in order: the verified pill with its check line when the person sees it today (1354-FR-005, unchanged), the count "{x} din {y} secțiuni afișate" / "{x} of {y} sections shown" where y is the number of sections the person may see (FR-002's list before the hidden step) and x those not hidden, and the button "Personalizează panoul" / "Customise dashboard". The row is shown to everyone with sections (a verified garage's owner, a receptionist, a mechanic, a suspended garage's people) and is absent for a `draft` garage; the legal-check panel keeps its place under it (modifies 099-FR-005).

_From 011-dashboard-sections._

### 099-FR-006 — A mechanic (a person holding `garage.own_jobs` but neither `garage.profile` nor `garage.feature_switches`) MUST keep her own-jobs section and her "Foaia mea de zi" link of 423-FR-001 and 423-FR-003, placed right after `req` (or first, when `req` is absent) and before `load`; the placeholder line "shell.frame.coming.garage.dashboard" MUST no longer be shown to anyone, the section frame taking its place.

_From 099-overview-sections._

### 099-FR-007 — Each section that reads data MUST load on its own, show its own skeleton while its first read is in flight, and on a failed read (the final failure, after the interceptor's own sign-in resend) MUST show an error line with "Reîncearcă" / "Try again" inside that section only, announced to assistive technology (`role="alert"`); one failing section MUST NOT blank, delay or hide another. The sections this story adds read nothing and show at once.

_From 099-overview-sections._

### 099-FR-008 — For the owner (the role holding `garage.feature_switches`) of an `approved` garage whose request lists Panou already reads (waiting, quoted, closed) and whose review list are all empty, Panou MUST show, below the strip and the legal-check panel and above the numbers slot, a card titled "Primii pași" / "First steps" with the line "Service-ul tău e verificat. Până la prima cerere, pregătește-l:" / "Your garage is verified. Until the first request, get it ready:" and these rows, each a link: "Verifică lucrările din Prețuri" / "Check the jobs on Prices" → Prețuri; "Adaugă poze în Profilul service-ului" / "Add photos to your garage profile" → Profilul service-ului; "Invită echipa în Mecanici" / "Invite the team in Mechanics" → Mecanici, only while the `team` view is among the person's allowed views. The card MUST disappear once the garage has a request of any status or a review, and MUST be absent for a receptionist, a mechanic, a `suspended` or `draft` garage, and while either read is loading or has failed.

_From 099-overview-sections._

### 099-FR-009 — Panou MUST follow the account re-read the frame already performs on `garage.features_changed`, `mechanic.updated`, `verification.decided`, `garage.suspended` and `garage.restored` from `garage:{garageId}`, so that a section whose feature was switched off leaves within 5 seconds without a page reload, a section switched back on returns the same way, and the strip, banner and card follow the garage's status; this story adds no event, sender, audience, channel or endpoint for it.

_From 099-overview-sections._

### 099-FR-010 — Panou MUST lay out phones first: at 320 px and 390 px the strip, the card, the numbers slot and every section stack in the default order, each full width, with no horizontal scroll, light and dark; `funnel` and `brands` share one row only when the content column holds two 420 px columns side by side (the mock's rule: two-up on the 1440 px board, stacked on phones, tablets and a 1024 px desktop beside the menu), the other sections keeping full width; the section headings MUST form the page's heading outline (one heading per section and one for the first-steps card, the view title above them) so a screen reader lists the sections.

_From 099-overview-sections._

### 099-FR-011 — Every text of FR-001, FR-004 and FR-008 MUST come from the garage area's translation files in Romanian and English (016-FR-002), with comma-below diacritics; axe MUST report no violation on Panou for the owner, the receptionist and the mechanic.

_From 099-overview-sections._

### 099-FR-012 — This story MUST write nothing on the server, emit no event, record no audit entry and add no endpoint and no read: every section and the card are decided from the access context and the reads Panou already performs.

_From 099-overview-sections._

### 099-FR-013 — Tests MUST exist before the code (Principle II), each test file carrying one whole-line `// @traces` comment naming this feature's ids. In Jest: the section table for the owner, the receptionist, a mechanic with and without `can_answer_quotes`, each feature off, and the release mark on and off (FR-002); the default order and the keys (FR-001); the title link present and absent by the target view (FR-003); the empty states hold no data (FR-004); the own-jobs placement and the placeholder gone (FR-006); the first-steps rule in every branch (FR-008); the section list re-filtering when the account signal changes (FR-009). In Playwright, end to end: the owner of a new garage sees the strip, the first-steps card and every released section empty, in the default order, each title opening its view; with `lift_schedule` switched off the lift section is gone; a mechanic without permissions sees only her sections.

_From 099-overview-sections._

### 011-FR-004 — "Personalizează panoul" MUST open, as a task of the overlays capability (a drawer on the right at 768 px and wider, a bottom sheet on a phone, 1127-FR-001 and 1127-FR-002), the panel titled "Alege ce vezi pe panou" / "Choose what your dashboard shows" with the line "Oprește secțiunile de care nu ai nevoie. Se salvează în contul tău." / "Switch off the sections you don’t need. It is saved to your account.", one row per section of FR-003's y in Panou's order, and the button "Gata" / "Done". Each row shows its position (1 upwards in that list), its name and its one-line description, and a switch (`role="switch"`, named by the section's name, checked while the section is shown) that works by click, tap, Space and Enter with a visible focus ring and a tap target at least 44 px high. A row whose switch is off is dimmed (still readable: its text keeps at least 4.5:1 contrast).

_From 011-dashboard-sections._

### 011-FR-005 — The panel's names and descriptions MUST be: `kpi` "Cifrele zilei" / "Today's numbers" — "Cereri noi, programări, notă, lucrări estimate" / "New requests, bookings, rating, estimated work"; `now` "În lucru acum" / "In work now" — "Mașinile de pe elevatoare, cu foto, video și live pentru client" / "Cars on the lifts, with photos, video and live for the customer"; `req` "Cereri de ofertă" / "Quote requests" — "Cererile la care nu ai răspuns încă" / "Requests you haven’t answered yet"; `load` "Încărcarea mecanicilor" / "Mechanic load" — "Câte ore are fiecare mecanic azi" / "Hours booked per mechanic today"; `sched` "Programul pe elevatoare" / "Schedule by lift" — "Util doar dacă lucrezi pe elevatoare" / "Only useful if you work on lifts"; `funnel` "De la profil la cerere" / "From profile view to request" — "Vizualizări și cereri, pe săptămâni" / "Views and requests, by week"; `brands` "Mărci cerute" / "Brands requested" — "Ce mașini te caută luna asta" / "Which cars look for you this month"; `reviews` "Recenzii noi" / "New reviews" — "Ultimele recenzii, cu buton de răspuns" / "Latest reviews, with a reply button". Every text of this story MUST come from the garage area's translation files in Romanian and English (016-FR-002), with comma-below diacritics.

_From 011-dashboard-sections._

### 011-FR-006 — Switching a row MUST apply at once and save: Panou shows or hides the section and the count follows before the server answers; the save sends the whole layout the server last answered with that key's and every other pending switch's visibility changed (every key, the server's order; 1263-FR-004); after a failed read it sends only the pending switches and the server fills the rest visible. On a failed save the switch, the section and the count MUST return to the state the server last answered (a later save that carried the switch keeps it, and that switch counts as saved) and the panel MUST show "Nu am putut salva. Încearcă din nou." / "We could not save. Try again." as an alert (`role="alert"`), cleared by the next successful switch. A save the server refuses with a `sign_in_required` 401 shows the sign-in dialog and resends once (the web interceptor); if that is dismissed or fails, it is a failed save as above. While a save is in flight the row's switch is disabled (a press is dropped, nothing is queued) and other rows stay usable.

_From 011-dashboard-sections._

### 011-FR-007 — "Gata", Escape, the X and a click outside MUST close the panel at once with no discard question (nothing is pending; the task is opened with 157-FR-010's question off); focus MUST return to "Personalizează panoul" (157-FR-008); reopening MUST show the server's current layout. Closing never saves: every change was saved on its switch.

_From 011-dashboard-sections._

### 011-FR-008 — When every section of FR-003's y is hidden, Panou MUST show, under the strip row (and the legal-check panel and first-steps card when they apply), the line "Ai ascuns toate secțiunile. Pornește cel puțin una din „Personalizează panoul”." / "You have hidden every section. Switch at least one on from “Customise dashboard”." and no section; the strip reads "0 din {y} secțiuni afișate"; the mechanic's own-jobs section and its day-sheet link (099-FR-006), which have no switch, stay. The message goes as soon as one section is shown again.

_From 011-dashboard-sections._

### 011-FR-010 — The panel MUST be one shared component that knows nothing of the garage: it takes the rows (key, position, name, description, shown) and the panel line, and reports a switch as (key, shown) with a way to flip it back on failure; the garage's Panou wires it to the garage's list and the layout read and save. The admin's (ST-1391) and driver's (ST-1262) dashboards reuse it unchanged; this story builds no admin or driver wiring.

_From 011-dashboard-sections._

### 011-FR-011 — The panel and the strip row MUST lay out phones first: at 320 px and 390 px the row's pill, count and button wrap without sideways scroll, every panel row is readable with no text under 12 px, long names and descriptions wrap and are never truncated, in light and dark, Romanian and English; the count is a polite live region (`aria-live="polite"`) so a switch's effect on it is announced, and the dimmed row and the error line never rely on colour alone (the switch state and the alert text carry the meaning); axe MUST report no violation on Panou with the panel closed and open, for the owner, the receptionist and the mechanic.

_From 011-dashboard-sections._

### 011-FR-012 — This story MUST add no table, no column, no endpoint, no event, no audit entry and no new metric: the server change is the three roles and their keys joining the one list, counted by the existing layout counter by role (1263-FR-008's inventory entries cover the routes). The AI assistant gets no tool for the layout.

_From 011-dashboard-sections._

### 011-FR-013 — Tests MUST exist before the code (Principle II), each test file carrying one whole-line `// @traces` comment naming this feature's ids. In Jest, unit: the shared panel's rows, positions, switch names and states, the dimmed row, the failed save flipping back with its alert, "Gata"; Panou's hidden step after the four of 099-FR-002, the count for the owner, the receptionist, a mechanic with and without `can_answer_quotes`, a feature off and a hidden section, the empty message, the default on a failed read, the re-read on the event, and nothing drawn before the read answers. Against a real database: the three garage roles' layouts read, saved and read back by the same account, each with the eight keys; `driver` still 404; a mechanic's save with `sched: false` kept; another account's layout never returned; a key outside the eight refused with 400. In Playwright, end to end: the owner hides two sections, reloads, they stay hidden, the menu still opens their views, and the count reads "5 din 7 secțiuni afișate"; a mechanic without permissions sees only her two rows.

_From 011-dashboard-sections._

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
- `1203-FR-010` — superseded by `005-FR-014` (2026-10-17)
- `250-FR-006` — superseded by `1359-FR-011` (2026-10-20)
- `1359-FR-011` — superseded by `116-FR-003` (2026-10-21)
- `291-FR-007` — superseded by `292-FR-001` (2026-10-23)
- `082-FR-011` — superseded by `500-FR-005` (2026-10-24)
- `129-FR-004` — superseded by `140-FR-012` (2026-10-24)
- `129-FR-014` — superseded by `140-FR-015` (2026-10-24)
- `082-FR-016` — superseded by `003-FR-008` (2026-10-24)
- `129-FR-001` — superseded by `003-FR-012` (2026-10-24)
- `500-FR-006` — superseded by `500-FR-008` (2026-10-24)
- `500-FR-005` — superseded by `500-FR-011` (2026-10-24)
- `082-FR-023` — superseded by `1370-FR-006` (2026-10-24)
- `1370-FR-006` — superseded by `1372-FR-004` (2026-10-24)
- `244-FR-002` — superseded by `947-FR-004` (2026-10-24)
- `244-FR-005` — superseded by `947-FR-004` (2026-10-24)
- `244-FR-006` — superseded by `947-FR-003` (2026-10-24)
- `244-FR-007` — superseded by `947-FR-003` (2026-10-24)
- `243-FR-002` — superseded by `947-FR-005` (2026-10-24)
- `500-FR-008` — superseded by `500-FR-016` (2026-10-24)
- `500-FR-009` — superseded by `500-FR-017` (2026-10-24)
- `1372-FR-005` — superseded by `1373-FR-006` (2026-10-24)
- `244-FR-013` — superseded by `1204-FR-008` (2026-10-25)
- `243-FR-013` — superseded by `1204-FR-010` (2026-10-25)
- `132-FR-007` — superseded by `1204-FR-012` (2026-10-25)
- `079-FR-010` — superseded by `102-FR-002` (2026-10-25)
- `079-FR-013` — superseded by `102-FR-007` (2026-10-25)
- `130-FR-003` — superseded by `102-FR-007` (2026-10-25)
- `102-FR-005` — superseded by `423-FR-001` (2026-10-25)
- `099-FR-002` — superseded by `011-FR-002` (2026-10-29)
- `099-FR-005` — superseded by `011-FR-003` (2026-10-29)
- `082-FR-020` — superseded by `1316-FR-006` (2026-10-30)
- `394-FR-006` — superseded by `1316-FR-007` (2026-10-30)
- `029-FR-009` — superseded by `1316-FR-005` (2026-10-30)
- `102-FR-004` — superseded by `1369-FR-001` (2026-10-30)
