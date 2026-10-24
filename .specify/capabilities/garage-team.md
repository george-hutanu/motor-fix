---
capability: garage-team
updated: 2026-10-24
features:
  - 131-invite-garage-staff
  - 389-confirm-booking-lift-mechanic
  - 129-delete-account
  - 055-team-list
---

# Capability: Garage team

How a garage's owner brings mechanics and receptionists into the garage: the staff invite, its link and e-mail, acceptance into an existing or new account, and the move of a mechanic between garages.

## Requirements

### 131-FR-001 — The system MUST store a staff invite with garage, kind (`mechanic` or `receptionist`), invitee name (2 to 80 characters, trimmed), e-mail (trimmed, lower-case, at most 254 characters), the three permissions (`can_move_bookings`, `can_answer_quotes`, `can_record_final_price`, all false by default, only meaningful for kind `mechanic` and stored false for a `receptionist` whatever the request carries), the hash of a single-use token of 32 random bytes, status (`sent`, `accepted`, `revoked`; `expired` is never written: a `sent` invite past its expiry reads as `expired`), expiry (7 days from sending or resending) and creation time.

_From 131-invite-garage-staff._

### 131-FR-002 — Only the owner of that garage MUST be able to send, resend or revoke its invites: a receptionist or a mechanic of the garage gets 403; the owner of another garage, or any other actor, gets 404.

_From 131-invite-garage-staff._

### 131-FR-003 — Sending MUST refuse a second open invite (status `sent` and not past its expiry) for the same garage and e-mail (409), a mechanic invite for a garage whose `team_mechanics` feature is off (404 `feature_off`), an e-mail whose account already holds the invited kind at that garage (409), and the owner's own e-mail (409).

_From 131-invite-garage-staff._

### 131-FR-004 — Sending and resending MUST send a STAFF_INVITE e-mail to the invited address, whether or not an account holds it, with the link `/{lang}/invite/:token` in the language of the owner's interface; the send happens within the request, and the answer says whether the e-mail went out; when it could not be sent the invite MUST stay `sent` and the answer MUST carry the link so the owner can copy it (the link is returned only then).

_From 131-invite-garage-staff._

### 131-FR-005 — Resending MUST issue a new token, void the old one, and restart the expiry, for a `sent` invite whether or not it is past its expiry; revoking MUST set `revoked`. Both MUST answer 409 `invite_invalid` for an `accepted` or `revoked` invite.

_From 131-invite-garage-staff._

### 131-FR-006 — Opening a link MUST answer, without a session, the garage name, the kind and the invitee name for a valid `sent` invite; `invite_expired` past the expiry; 404 `feature_off` for a mechanic invite while the garage's `team_mechanics` is off; `invite_invalid` for a revoked, used, voided, unknown or malformed token, without revealing which.

_From 131-invite-garage-staff._

### 131-FR-007 — Accepting MUST require a session and a valid `sent` invite (a link past its expiry answers `invite_expired`, a revoked, used, voided or unknown one `invite_invalid`; of two simultaneous accepts of one link only one succeeds and the other answers `invite_invalid`), and MUST in one transaction: grant the invite's role to the signed-in account if not held; for a mechanic, create the mechanic row (garage, account, the invite's permissions; the row existing is what puts the mechanic on the public profile) or move the account's existing mechanic row to this garage with these permissions; for a receptionist, create the garage membership with role `receptionist`; set the invite `accepted`; write the audit entry; emit `invite.accepted` and, on a move, `mechanic.updated`. The answer is 204 with no session; the web then switches the session to the invited role through the role switch (a new access token, `lastRole` set), so the garage dashboard opens in that role, and a failed switch is retried without accepting again.

_From 131-invite-garage-staff._

### 131-FR-008 — Accepting MUST be refused with `invite_invalid` when the signed-in account owns this garage, is receptionist at another garage (receptionist invite), or when the invite's `team_mechanics` feature is off (404 `feature_off`); an account already holding the invited role at this garage completes with no change beyond the invite status.

_From 131-invite-garage-staff._

### 131-FR-009 — After acceptance the system MUST notify the garage owner with STAFF_JOINED (its catalogue channels; it can be muted) and publish a live update on `garage:{garageId}` for the new garage and, on a move, the old one.

_From 131-invite-garage-staff._

### 131-FR-010 — Every invite sent, resent, revoked and accepted MUST be written to the audit history with the actor and the permissions chosen, and `invite.sent`, `invite.revoked`, `invite.accepted` MUST be emitted in the same transaction as the change.

_From 131-invite-garage-staff._

### 131-FR-011 — The garage dashboard frame MUST offer "Invită în echipă" to the owner only, opening a dialog with name, e-mail, kind (mechanic, offered only when `team_mechanics` is on; receptionist), the three permission ticks shown only for mechanic and unticked by default, and a send button; it MUST show the field problems before sending and the API's message after, including "Nu am putut trimite invitația" with "Copiază linkul".

_From 131-invite-garage-staff._

### 131-FR-012 — The public acceptance screen at `/{lang}/invite/:token` MUST show "{garage} te invită să te alături echipei ca {rol}." and, for a mechanic, the line about appearing on the garage's public profile; signed out, it MUST offer sign-in and account creation (the existing dialogs, with the invited name and e-mail filled in) and, when the account is created from the link, accept in the same flow; signed in (including after signing in from the link), it MUST accept only on an explicit "Acceptă"; after acceptance it MUST open the garage dashboard in the account's language; an invalid or expired link MUST show "Invitația nu mai este valabilă. Cere service-ului una nouă."

_From 131-invite-garage-staff._

### 131-FR-013 — Every new text MUST exist in Romanian and English, and text typed by a person (names, e-mails, garage names) MUST never be shown back as markup.

_From 131-invite-garage-staff._

### 131-FR-014 — The invite endpoints MUST be REST with OpenAPI and DTOs in the contracts library, validated at the edge; the web app MUST call them through the generated client.

_From 131-invite-garage-staff._

### 389-FR-005 — With `team_mechanics` off, `mechanicId` MUST be refused (400 `validation_failed` naming it), the booking MUST store no `mechanic_id` of its own (the owner counts as every booking's mechanic, and no mechanic overlap is checked), and the JOB MUST carry the owner's own MECHANIC row, looked up by the owner's account (`mechanic.account_id` is unique; one garage per account at launch, X20) and created in the same transaction at this garage's first confirmation when none exists (`account_id` the owner's account, `name` the account's display name, not on the profile); the booking DTO's `mechanic` MUST read that row, so every read sees the owner as the mechanic. A row for the owner's account at another garage answers 409 `mechanic_unavailable`, nothing written.

_From 389-confirm-booking-lift-mechanic._

### 055-FR-004 — The account deletion's detach (129-FR-009) MUST, in one transaction, clear the MECHANIC row's `account_id`, set its `on_profile` false, delete the account's receptionist GARAGE_MEMBER rows, and set `removed_at` (a time, null by default) on the row; nothing else writes `removed_at` in this story. The row, its reviews and its bookings' mechanic reference are kept, so the figures are unchanged and the owner reassigns those bookings through the existing mechanic change. A card with `removed_at` set is never offered, matched or assigned again: the team list, the booking's confirm options and mechanic check, the day sheet's lookup, the step-4 re-save and the team switch's count all leave it out. A migration adds the nullable column.

_From 055-team-list._

### 055-FR-001 — The API MUST offer `GET /api/v1/garages/:garageId/mechanics`, answering 200 with `{ items: [...] }`, each item carrying `id`, `name`, `speciality` (nullable), `onProfile`, `hasAccount`, `rating` (string with one decimal, or null) and `reviewCount`, read from the MECHANIC rows of that garage, ordered by name A–Z with `Intl.Collator('ro', { sensitivity: 'base' })`, equal names by `id` so the order is stable between reads, leaving out the row whose account is the caller's own (the owner's row of 389-FR-005) and every row with `removed_at` set. The DTO lives in the contracts library, the route in the OpenAPI document, and the web app calls it through the regenerated client.

_From 055-team-list._

### 055-FR-002 — The read MUST be open to the owner of that garage only: a receptionist or a mechanic of the garage gets 403 `forbidden`; any other actor (another garage's owner, a driver, an admin, a signed-out call's 401 aside) gets 404 `not_found`, as the garage's other owner-only routes do (398-FR-004). The check runs on the server before any row is read.

_From 055-team-list._

### 055-FR-003 — While the garage's `team_mechanics` is off (`featureOn`, a missing row is on), the read MUST answer 404 `feature_off` to the owner, after FR-002's check (a receptionist or mechanic still gets 403, any other actor 404 `not_found`), with the same body shape as the invites' refusal (131-FR-003); the web menu's entry and route stay hidden as 097-FR-007 and 398-FR-009 already hold.

_From 055-team-list._

### 055-FR-005 — The garage dashboard's Mecanici view (path `team`, capability `garage.team`, feature `team_mechanics`, already in the menu) MUST gain a body: the title "Mecanici" / "Mechanics", under it the count line, and the panel "Echipa" / "Team" with one row per item of FR-001, in the API's order.

_From 055-team-list._

### 055-FR-006 — Each row MUST show the name; under it the speciality when set (no years, no separator when empty); a lamp with its text; and the rating cell. The lamp MUST be green with "pe profil" / "on the profile" when `onProfile` is true; grey with "nu apare pe profil · fără cont" / "not on the profile · no account" when `hasAccount` is false; grey with "nu apare pe profil" / "not on the profile" otherwise. The state MUST be readable without colour (the text is always shown, the lamp is decorative for assistive technology).

_From 055-team-list._

### 055-FR-007 — The rating cell MUST read "{rating} · {count} recenzii" / "{rating} · {count} reviews" with the rating in the interface language's format (RO "4,9", EN "4.9") and the count with Romanian plural rules ("1 recenzie", "2 recenzii", "20 de recenzii"); with a count of 0 it reads "fără recenzii" / "no reviews".

_From 055-team-list._

### 055-FR-008 — The count line MUST count the items with `onProfile` true: "{n} mecanici pe profil" / "{n} mechanics on the profile" with Romanian plural rules ("1 mecanic pe profil", "20 de mecanici pe profil"); when the list has items and none is on the profile it reads "Echipa nu apare pe profil" / "The team is not on the profile"; with no items it is absent.

_From 055-team-list._

### 055-FR-009 — With no items the panel MUST show the dashboard's empty state (the existing component, icon `wrench`) with "Încă nu ai adăugat mecanici" / "You have not added mechanics yet" and the button "Adaugă un mecanic" / "Add a mechanic", which opens the staff invite dialog (131-FR-011) with kind mechanic chosen.

_From 055-team-list._

### 055-FR-010 — While the first read is in flight the panel MUST show three skeleton rows; a failed first read (any non-2xx or a network error) MUST show "Nu am putut încărca echipa. Reîncearcă." / "We could not load the team. Try again." in a `role="alert"` with a button "Reîncearcă" / "Try again" that reads again; a 404 (the feature switched off meanwhile, or the garage gone) MUST send the view to the dashboard home as the frame's re-read does. A re-read that fails while a list is on screen (a live refresh, the return from offline) MUST keep that list and show no error panel; the next event or the return of the connection reads again.

_From 055-team-list._

### 055-FR-011 — With a loaded list and the browser offline the view MUST keep the list and show the shared offline note (shell "live.offline": "Fără conexiune. Ce vezi poate fi vechi." / "No connection. What you see may be out of date.") until the connection returns, then read again.

_From 055-team-list._

### 055-FR-012 — The view MUST read the list again, without a reload, when the live stream delivers `mechanic.updated`, `invite.accepted` or `rating.updated` for the garage (the dashboard's live view helper, 253-FR-004, 398-FR-008), and on the stream's resync; a row that appears, changes or goes MUST be on screen within 5 seconds of the event.

_From 055-team-list._

### 055-FR-013 — Every text of FR-005–FR-011 MUST come from the garage area's translation files in Romanian and English (016-FR-002), with comma-below diacritics; text typed by a person (name, speciality) MUST never be shown as markup (131-FR-013).

_From 055-team-list._

### 055-FR-014 — The view MUST lay out phones first: at 320 px and 390 px the row stacks (name, speciality, lamp, rating on their own lines) with no horizontal scroll; from a tablet the lamp and the rating sit on the name's line; light and dark follow the Cockpit theme's tokens; the panel is a Cockpit card as the dashboard's other panels.

_From 055-team-list._

### 055-FR-015 — The read route MUST be listed in `infra/observability/inventory.json` as an endpoint with its reason (a read; the API's request-duration histogram labels the route, 876-FR-008; the `api-error-rate` and `api-latency` rules cover it); no new metric, log, service or queue is added, and no id reaches a metric label (876-FR-011).

_From 055-team-list._

### 055-FR-016 — Tests MUST cover, failing first: Jest on real PostgreSQL for FR-001 (the shape, the order with "Ștefan", "stan", "Tudor" reading stan, Ștefan, Tudor, the owner's own row and a `removed_at` row left out, `rating` null with count 0, figures across garages: 40 reviews here and 18 at a previous garage read 58), FR-002 (owner 200, receptionist and mechanic 403, driver, admin and another owner 404, signed out 401), FR-003 (owner 404 `feature_off` with the switch off, a receptionist 403 and another owner 404 `not_found` with it off, 200 again when on), FR-004 (the deletion writes `removed_at`, the figures and bookings stay, and the same person accepting a new invite shows one row); Jest for the lamp text by state, the rating cell (RO and EN, 0, 1, 2 and 20 reviews), the count line (0, 1, 2, 20 on the profile; items with none on the profile) and the empty state's button opening the invite dialog; Playwright (the PR QA sweep) as an owner with three seeded cards: the rows and the count line at 320 px, 390 px, tablet and desktop, light and dark, RO and EN, and the live refresh: a mechanic accepting an invite in a second browser appears in the first within 5 seconds.

_From 055-team-list._

## Retired

- `129-FR-009` — superseded by `055-FR-004` (2026-10-24)
