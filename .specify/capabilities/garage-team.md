---
capability: garage-team
updated: 2026-10-24
features:
  - 131-invite-garage-staff
  - 389-confirm-booking-lift-mechanic
  - 129-delete-account
  - 531-garage-feature-tabs
  - 055-team-list
  - 056-mechanic-dialog
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

### 531-FR-003 — The invite dialog MUST read `team_mechanics` for its garage from the session's garage entry at open and follow it while open: off → "Mecanic" is not offered, "Recepționer" is preselected, the permission ticks are hidden and no invite of kind `mechanic` is sent; on or unset → unchanged. The server's 404 `feature_off` answer MUST still withdraw "Mecanic" as today, for a session that has not heard of the switch.

_From 531-garage-feature-tabs._

### 131-FR-012 — The public acceptance screen at `/{lang}/invite/:token` MUST show "{garage} te invită să te alături echipei ca {rol}." and, for a mechanic, the line about appearing on the garage's public profile; signed out, it MUST offer sign-in and account creation (the existing dialogs, with the invited name and e-mail filled in) and, when the account is created from the link, accept in the same flow; signed in (including after signing in from the link), it MUST accept only on an explicit "Acceptă"; after acceptance it MUST open the garage dashboard in the account's language; an invalid or expired link MUST show "Invitația nu mai este valabilă. Cere service-ului una nouă."

_From 131-invite-garage-staff._

### 131-FR-013 — Every new text MUST exist in Romanian and English, and text typed by a person (names, e-mails, garage names) MUST never be shown back as markup.

_From 131-invite-garage-staff._

### 131-FR-014 — The invite endpoints MUST be REST with OpenAPI and DTOs in the contracts library, validated at the edge; the web app MUST call them through the generated client.

_From 131-invite-garage-staff._

### 056-FR-015 — (389-FR-005 modified) Garage creation at the end of the listing form MUST create the owner's MECHANIC row in the same transaction: `is_owner` true, the owner's account and display name, `working_hours` copied from the garage's `hours`, `on_profile` false, the three permissions true, no specialities; the confirm's fallback row (389-FR-005, for garages created before this story) MUST set `is_owner` true too, and the rest of 389-FR-005 holds (with the team off every confirmed booking uses that row and may overlap the owner's other bookings). The step-4 re-save MUST never match, change or delete a row with `is_owner` true. The owner's row can be edited (FR-002) and never removed (FR-006).

_From 056-mechanic-dialog._

### 056-FR-014 — (055-FR-004 modified) The account deletion's detach MUST record `mechanic.removed` (payload `from: 'account_deleted'`) instead of `mechanic.updated`, with the same writes; its future confirmed bookings read `toReassign` true (FR-008); reviews stay as they do.

_From 056-mechanic-dialog._

### 056-FR-011 — (055-FR-001 modified) The list MUST include the owner's row first (`isOwner` true), then the other current rows by name as before, still leaving out every row with `removed_at` set; each item gains `roleTitle` (nullable), `specialties` (array), `certifications` (array), `years` (nullable), `brandIds` (array), `isOwner` and `futureBookings` (the count of that card's `confirmed` bookings starting after now); the answer gains `brands`: the garage's `works_on` brands as `{ id, name }`, by name A–Z, for the dialog's choice. `id`, `name`, `speciality`, `onProfile`, `hasAccount`, `rating` and `reviewCount` are unchanged.

_From 056-mechanic-dialog._

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

### 056-FR-012 — (055-FR-009 modified) The empty state MUST show when the list holds no row other than the owner's, with the same texts, and its "Adaugă un mecanic" MUST open the card dialog (FR-016) for a new card, as the panel header's button does; the staff invite stays in the frame's "Invită în echipă" (131-FR-011). The count line and the panel still render the owner's row when it is the only one: "Echipa nu apare pe profil" is replaced by nothing when only the owner's row (off the profile) exists. Otherwise the owner's row counts in 055-FR-008's line like any row.

_From 056-mechanic-dialog._

### 055-FR-010 — While the first read is in flight the panel MUST show three skeleton rows; a failed first read (any non-2xx or a network error) MUST show "Nu am putut încărca echipa. Reîncearcă." / "We could not load the team. Try again." in a `role="alert"` with a button "Reîncearcă" / "Try again" that reads again; a 404 (the feature switched off meanwhile, or the garage gone) MUST send the view to the dashboard home as the frame's re-read does. A re-read that fails while a list is on screen (a live refresh, the return from offline) MUST keep that list and show no error panel; the next event or the return of the connection reads again.

_From 055-team-list._

### 055-FR-011 — With a loaded list and the browser offline the view MUST keep the list and show the shared offline note (shell "live.offline": "Fără conexiune. Ce vezi poate fi vechi." / "No connection. What you see may be out of date.") until the connection returns, then read again.

_From 055-team-list._

### 056-FR-013 — (055-FR-012 modified) The view MUST read the list again on `mechanic.added` and `mechanic.removed` too, with the same 5-second bound.

_From 056-mechanic-dialog._

### 055-FR-013 — Every text of FR-005–FR-011 MUST come from the garage area's translation files in Romanian and English (016-FR-002), with comma-below diacritics; text typed by a person (name, speciality) MUST never be shown as markup (131-FR-013).

_From 055-team-list._

### 055-FR-014 — The view MUST lay out phones first: at 320 px and 390 px the row stacks (name, speciality, lamp, rating on their own lines) with no horizontal scroll; from a tablet the lamp and the rating sit on the name's line; light and dark follow the Cockpit theme's tokens; the panel is a Cockpit card as the dashboard's other panels.

_From 055-team-list._

### 055-FR-015 — The read route MUST be listed in `infra/observability/inventory.json` as an endpoint with its reason (a read; the API's request-duration histogram labels the route, 876-FR-008; the `api-error-rate` and `api-latency` rules cover it); no new metric, log, service or queue is added, and no id reaches a metric label (876-FR-011).

_From 055-team-list._

### 055-FR-016 — Tests MUST cover, failing first: Jest on real PostgreSQL for FR-001 (the shape, the order with "Ștefan", "stan", "Tudor" reading stan, Ștefan, Tudor, the owner's own row and a `removed_at` row left out, `rating` null with count 0, figures across garages: 40 reviews here and 18 at a previous garage read 58), FR-002 (owner 200, receptionist and mechanic 403, driver, admin and another owner 404, signed out 401), FR-003 (owner 404 `feature_off` with the switch off, a receptionist 403 and another owner 404 `not_found` with it off, 200 again when on), FR-004 (the deletion writes `removed_at`, the figures and bookings stay, and the same person accepting a new invite shows one row); Jest for the lamp text by state, the rating cell (RO and EN, 0, 1, 2 and 20 reviews), the count line (0, 1, 2, 20 on the profile; items with none on the profile) and the empty state's button opening the invite dialog; Playwright (the PR QA sweep) as an owner with three seeded cards: the rows and the count line at 320 px, 390 px, tablet and desktop, light and dark, RO and EN, and the live refresh: a mechanic accepting an invite in a second browser appears in the first within 5 seconds.

_From 055-team-list._

### 056-FR-001 — The MECHANIC row MUST gain `role_title` (text, null, at most 40 characters), `specialties` (text array, at most 6, each at most 40), `certifications` (text array, at most 10, each at most 80), `years` (integer, null, 0 to 60), `brand_ids` (uuid array, each a brand the garage holds with stance `works_on`), `is_owner` (boolean, default false) and `working_hours` (json, null, the garage's `WeeklyHours` shape), by a migration that backfills `is_owner` true for every existing row whose account is the owner member of its garage and creates the owner's row (as FR-015 makes it) for every existing garage whose owner member has none. `speciality` stays and is written on every add and edit as the specialties joined with ", " (null with none), so every reader of the line is unchanged. No slug, photo, bio or languages column is added.

_From 056-mechanic-dialog._

### 056-FR-002 — The API MUST offer `POST /api/v1/garages/:garageId/mechanics` (201, the card) and `PATCH /api/v1/garages/:garageId/mechanics/:mechanicId` (200, the card; every field optional, only the given ones change: an omitted field is left as it is, `null` clears `roleTitle` or `years`, `[]` clears an array; `name` cannot be cleared), taking `name` (required on add, 2 to 80 characters trimmed), `roleTitle`, `specialties`, `certifications`, `years` and `brandIds` within FR-001's limits and refusing anything outside them, a non-integer `years`, a `brandIds` entry the garage does not take or a duplicate, as the API's validation refusal (`validation_failed`, each field named). The card in the answer carries the list item's shape (FR-011). The DTOs live in the contracts library, the routes in the OpenAPI document, and the web app calls them through the regenerated client.

_From 056-mechanic-dialog._

### 056-FR-003 — The three routes MUST be open to the owner of that garage only, checked on the server before anything else, in the order of 055-FR-002 and 055-FR-003: a receptionist or a mechanic of the garage gets 403 `forbidden`; any other actor 404 `not_found` (a signed-out call 401); then, with `team_mechanics` off, the owner gets 404 `feature_off`; then an unknown card, a card with `removed_at` set or a card of another garage answers 404 `not_found`.

_From 056-mechanic-dialog._

### 056-FR-004 — A body of an add or an edit that carries `photo`, `bio` or `languages` (any of them, with any value) MUST be refused 403 with a named code (`mechanic_owned_field`), before any write and before the other fields are judged (A34: the mechanic's own fields, #342).

_From 056-mechanic-dialog._

### 056-FR-005 — Every add MUST write an audit `create` entry and every edit one `update` entry per field of the request whose value changed (field, old value, new value, an array as its entries joined with ", "; none for an unchanged field; the derived `speciality` gets no entry of its own), each with the actor and the role; `mechanic.added` and `mechanic.updated` (payload naming the changed fields) MUST be recorded in the same transaction as the change, to the garage audience and, for a card on the profile, to `public:garage:{garageId}` and `public:mechanic:{mechanicId}`.

_From 056-mechanic-dialog._

### 056-FR-006 — `DELETE /api/v1/garages/:garageId/mechanics/:mechanicId` MUST answer 204 and, in one transaction: set `removed_at`, set `on_profile` false, clear `account_id`, set every open (`sent`) invite of kind `mechanic` of this garage to the linked account's current e-mail, lower-cased, to `revoked`, write an audit `delete` entry with the actor and role, and record `mechanic.removed` (to the garage audience and, for a card that was on the profile, to the public channels of FR-005). The row, its reviews, its jobs and its bookings' mechanic reference are kept. A card with `is_owner` true MUST answer 409 `owner_row`, nothing written.

_From 056-mechanic-dialog._

### 056-FR-007 — A removed card's linked account MUST lose the garage at once: the account's garage and permissions are read from its card per request, and a detached card gives none, so the next request has no garage dashboard; a later accepted invite makes a new row (the detached row is never matched, as 055-FR-004 holds).

_From 056-mechanic-dialog._

### 056-FR-008 — The garage's booking DTO MUST carry `toReassign` (true for a booking that is `confirmed`, starts after now and whose mechanic has `removed_at` set; false otherwise; no booking column), and every garage booking view that names the mechanic MUST show "de realocat" / "to reassign" beside the name when it is true; the owner reassigns through the existing mechanic change.

_From 056-mechanic-dialog._

### 056-FR-009 — The catalogue MUST gain STAFF_REMOVED (trigger event, channels e-mail and push, no group, transactional: never WhatsApp and never muted), with templates in Romanian and English (bell "Nu mai faci parte din echipa {garage}." / "You are no longer part of the team of {garage}.", e-mail with the same line and a button to the app's home in the account's language; never muted as STAFF_INVITE's e-mail is not, by the same catalogue attribute), sent to the removed card's account after the commit, in the account's language; a card with no account gets nothing.

_From 056-mechanic-dialog._

### 056-FR-010 — The live hub MUST carry `mechanic.added` and `mechanic.removed` as the `garage.team` family carries `mechanic.updated` (`KIND_CAPABILITY`), MUST re-read access on `mechanic.removed` as on `mechanic.updated` (`REREAD_ACCESS`), and MUST let `public:garage:` and `public:mechanic:` streams hear both.

_From 056-mechanic-dialog._

### 056-FR-016 — The Mecanici view MUST open a card dialog, a component in its own folder `apps/web/src/app/dashboard/mechanic-card/`, through the shared Overlays dialog (a bottom sheet on a phone), from the panel header's "Adaugă un mecanic", from the empty state's button (a new card) and from a tap on any row, the owner's included (that card, filled in). It MUST carry: name, role title, specialties and certifications (one comma-separated input each, split into tags on ",", trimmed, empties dropped), years (a whole number) and one tick per brand of the list's `brands`; for a card with an account, a read-only block listing photo, bio and languages marked "Le completează mecanicul" / "The mechanic fills these in".

_From 056-mechanic-dialog._

### 056-FR-017 — The dialog MUST show the field problems under their fields before and after the call: "Numele este obligatoriu" / "The name is required" for a name empty or under 2 characters, "Între 0 și 60 de ani" / "Between 0 and 60 years" for the years, and the limit for the other fields ("Cel mult 80 de caractere" / "At most 80 characters", "Cel mult 6 specialități" / "At most 6 specialties", "Cel mult 10 certificări" / "At most 10 certifications", "Cel mult 40 de caractere pe etichetă" / "At most 40 characters per tag", and under the brand ticks "Marcă pe care service-ul nu o acceptă" / "A brand the garage does not take"); while saving the button shows a spinner and the fields are disabled; a refusal or a network failure keeps the dialog open with the field errors and a toast in the person's language; a success closes the dialog and the list shows the card at once.

_From 056-mechanic-dialog._

### 056-FR-018 — The edit dialog MUST offer "Elimină" / "Remove" for every card but the owner's (absent, not disabled, for `isOwner`); it opens a confirmation reading "{name} are {n} programări viitoare. Vor trebui realocate." / "{name} has {n} future bookings. They will need reassigning." with Romanian plural rules when `futureBookings` is above 0, else "Elimini pe {name} din echipă?" / "Remove {name} from the team?", with "Elimină" and "Renunță" / "Cancel"; confirming calls FR-006 and closes both on 204; a refusal shows a toast and keeps the dialog.

_From 056-mechanic-dialog._

### 056-FR-019 — Each row of the list MUST read, under the name, the speciality line as before followed by "· {years} de ani" / "· {years} years" when `years` is above 0 (RO: "1 an", "2 ani", "20 de ani"), and the owner's row MUST read "proprietar" / "owner" beside the name; the lamp and the rating cells are unchanged (055-FR-006, FR-007).

_From 056-mechanic-dialog._

### 056-FR-020 — Every new text MUST come from the garage area's translation files in Romanian and English (016-FR-002), with comma-below diacritics; text typed by a person (name, role title, tags, brand names) MUST never be shown as markup (131-FR-013).

_From 056-mechanic-dialog._

### 056-FR-021 — The dialog MUST lay out phones first: at 320 px and 390 px a bottom sheet with the fields stacked, brand ticks wrapping, no horizontal scroll; from a tablet a centred dialog; light and dark follow the Cockpit theme's tokens; the fields are the Cockpit inputs the invite dialog uses. Every field has a visible label, each problem is tied to its field for assistive technology, the dialog traps focus and closes on Escape as the shared Overlays dialog does, and every control is reachable and operable by keyboard.

_From 056-mechanic-dialog._

### 056-FR-022 — The three routes MUST be listed in `infra/observability/inventory.json` as endpoints with their reason (writes; the API's request-duration histogram labels the route, 876-FR-008; the `api-error-rate` and `api-latency` rules cover them), and the product actions `mechanic.added`, `mechanic.updated`, `mechanic.removed` listed as the invites' actions are; no id reaches a metric label (876-FR-011).

_From 056-mechanic-dialog._

### 056-FR-023 — Tests MUST cover, failing first: Jest on real PostgreSQL for FR-001 (the limits at each bound, `speciality` written from the specialties, the backfill), FR-002/FR-003 (owner 201/200, receptionist and mechanic 403, driver, admin and another owner 404, signed out 401, 404 `feature_off` with the switch off after the access check, 404 for an unknown, removed or foreign card), FR-004 (403 before any write, `photo`, `bio`, `languages` each), FR-005 (one audit entry per changed field with old and new, none for an unchanged one; the events in the same transaction, the public channels only for a card on the profile), FR-006/FR-007 (the row's state, the invite revoked, the account's next request has no garage, a new invite makes a new row, the owner's row 409 `owner_row`), FR-008 (`toReassign` true for a future confirmed booking of a removed card, false for a past, cancelled or current card's), FR-009 (STAFF_REMOVED to the account by e-mail and push, no WhatsApp with the garage's WhatsApp on, nothing for a card with no account), FR-011 (the owner's row first, the new fields, `futureBookings`, `brands`), FR-014 (the deletion records `mechanic.removed`, bookings read `toReassign`, reviews stay), FR-015 (the row at creation with the garage's hours, the fallback marks `is_owner`, the re-save leaves it, two overlapping confirmed bookings with the team off); Jest for the dialog (tags from a comma-separated input, the two messages, the brand ticks, the read-only block, "Elimină" absent for the owner, the confirmation's plurals at 0, 1, 2 and 20, the spinner and the kept dialog on a refusal) and the view (the owner's row first with "proprietar", the years tail, the empty state's button opening the dialog, re-read on the two new kinds); Playwright (`web-e2e`): as an owner add Elena, edit her specialties, remove her, and a past job still shows her name; the PR QA sweep: the dialog at 320 px, 390 px, tablet and desktop, light and dark, RO and EN.

_From 056-mechanic-dialog._

## Retired

- `129-FR-009` — superseded by `055-FR-004` (2026-10-24)
- `131-FR-011` — superseded by `531-FR-003` (2026-10-24)
- `055-FR-001` — superseded by `056-FR-011` (2026-10-24)
- `055-FR-009` — superseded by `056-FR-012` (2026-10-24)
- `055-FR-012` — superseded by `056-FR-013` (2026-10-24)
- `055-FR-004` — superseded by `056-FR-014` (2026-10-24)
- `389-FR-005` — superseded by `056-FR-015` (2026-10-24)
