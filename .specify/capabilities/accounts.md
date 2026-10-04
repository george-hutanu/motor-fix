---
capability: accounts
updated: 2026-10-04
features:
  - 079-account-model
  - 082-sign-in
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

### 079-FR-011 — Every protected call MUST resolve an actor (account id, role in use, garage id for garage-side roles, mechanic permissions) from a bearer access token; without a valid token it MUST answer 401 `sign_in_required`; for a suspended account it MUST answer 403 `account_suspended`, before any right is checked. The garage id comes from the membership (or mechanic link) matching the role in use; when none exists it is empty and every garage capability answers 404.

_From 079-account-model._

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

### 082-FR-013 — The dialog MUST be the shared overlay's `dialog` shape titled "Autentificare" with the name MotorFix under it, and hold "E‑mail" (placeholder "tu@exemplu.ro"), "Parolă" (placeholder "Parola ta"), "Ține‑mă autentificat" ticked by default, and the main button "Intră în cont"; it MUST NOT show the controls of flows not built yet (Apple, Google, "Ai uitat parola?", "Creează un cont", the driver/garage switch).

_From 082-sign-in._

### 082-FR-014 — Before sending, the dialog MUST check that the e-mail is filled in and looks like an address (text, "@", a domain with a dot) and that the password is filled in, through the shared task saving of `libs/overlays`; each problem MUST show under its field, be tied to the field by `aria-describedby`, and move the focus to the first wrong field.

_From 082-sign-in._

### 082-FR-015 — While a sign-in is on its way the main button MUST be disabled and show progress, and a second tap MUST send nothing.

_From 082-sign-in._

### 082-FR-016 — The dialog MUST show the message for the answer's code in the person's language — `invalid_credentials`, `too_many_attempts`, `account_suspended`, `maintenance`, offline (no answer while the device reports no connection), and the shared messages for a failed call while online and for any other code — in a region screen readers announce; the typed e-mail MUST stay, and the password MUST be cleared after `invalid_credentials`.

_From 082-sign-in._

### 082-FR-017 — After a successful sign-in the dialog MUST close and the role's landing (`/app/driver`, `/app/garage` for garage owner, receptionist and mechanic, `/app/admin`) MUST open, in the account's language.

_From 082-sign-in._

### 082-FR-018 — The web app MUST hold the access token in memory only and send it as a bearer token on every API call except the three `auth` calls; on a 401 from a call that carried the token it MUST renew once (one renewal shared by concurrent calls) and repeat the call, and when renewal fails forget the token and the "who am I" answer in memory (navigation stays with the guards and 082-FR-020). The sign-in and renewal answers carry only the access token; landing and language come from "who am I".

_From 082-sign-in._

### 082-FR-019 — When the app needs the session and holds no access token (a reload, a reopened browser), it MUST renew from the cookie before asking "who am I"; a failed renewal means signed out.

_From 082-sign-in._

### 082-FR-020 — "Ieși din cont" MUST call sign-out, forget the session in memory even when the call fails, and open Home.

_From 082-sign-in._

### 082-FR-022 — Every new text MUST exist in Romanian and English, Romanian words joined by a hyphen MUST use U+2011, and text the person typed MUST never be shown back as markup.

_From 082-sign-in._

### 082-FR-023 — The seed MUST add, outside production, one account per role (driver; garage owner of a seeded garage; receptionist and mechanic of that garage; admin), one driver-and-garage account whose last role is `garage`, and one suspended driver, all with e-mails under `example.test` and the password `parola-de-test` in development and test, which MUST come from `SEED_PASSWORD` in every other environment, an unset or unknown `APP_ENV` included (refused without it); an account whose e-mail exists is left as it is, so running it twice changes nothing.

_From 082-sign-in._

## Retired

- `079-FR-017` — superseded by `082-FR-021` (2026-10-04)
