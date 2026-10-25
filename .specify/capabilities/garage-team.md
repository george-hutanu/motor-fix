---
capability: garage-team
updated: 2026-10-25
features:
  - 131-invite-garage-staff
  - 389-confirm-booking-lift-mechanic
  - 129-delete-account
  - 531-garage-feature-tabs
  - 055-team-list
  - 056-mechanic-dialog
  - 102-garage-members
  - 1255-invite-mechanic
---

# Capability: Garage team

How a garage's owner brings mechanics and receptionists into the garage: the staff invite, its link and e-mail, acceptance into an existing or new account, and the move of a mechanic between garages.

## Requirements

### 1255-FR-001 — The staff invite MUST gain `mechanic_id` (nullable, the card it was sent for, of the same garage) and `phone` (nullable, E.164, at most 20 characters); `email` becomes nullable and exactly one of `email` or `phone` MUST be set (a database CHECK); an invite by phone has the same kind, permissions, token, status and 7-day expiry as one by e-mail (131-FR-001 otherwise unchanged). Receptionist invites keep e-mail only.

_From 1255-invite-mechanic._

### 131-FR-002 — Only the owner of that garage MUST be able to send, resend or revoke its invites: a receptionist or a mechanic of the garage gets 403; the owner of another garage, or any other actor, gets 404.

_From 131-invite-garage-staff._

### 1255-FR-003 — With `mechanicId`, the send MUST check, after 131-FR-002's access and `team_mechanics` (404 `feature_off`): the card exists, belongs to the garage and is not removed (else 404 `not_found`); the card is not the owner's row (409 `owner_row`); the card has no account (409 `card_linked`); the card has no `sent` invite that has not expired (409 `invite_open`, with `inviteId`); a new send sets the card's older (expired) `sent` invites to `revoked` in its transaction, so a card holds at most one `sent` invite; the card checks run again in that transaction under the card's row lock, so of two sends for one card at once one stores its invite and the other answers 409 `invite_open`; then the e-mail or phone checks of 131-FR-003, also by phone (an account found by `phone` that is already a mechanic here: 409 `already_in_team`).

_From 1255-invite-mechanic._

### 131-FR-004 — Sending and resending MUST send a STAFF_INVITE e-mail to the invited address, whether or not an account holds it, with the link `/{lang}/invite/:token` in the language of the owner's interface; the send happens within the request, and the answer says whether the e-mail went out; when it could not be sent the invite MUST stay `sent` and the answer MUST carry the link so the owner can copy it (the link is returned only then).

_From 131-invite-garage-staff._

### 131-FR-005 — Resending MUST issue a new token, void the old one, and restart the expiry, for a `sent` invite whether or not it is past its expiry; revoking MUST set `revoked`. Both MUST answer 409 `invite_invalid` for an `accepted` or `revoked` invite.

_From 131-invite-garage-staff._

### 131-FR-006 — Opening a link MUST answer, without a session, the garage name, the kind and the invitee name for a valid `sent` invite; `invite_expired` past the expiry; 404 `feature_off` for a mechanic invite while the garage's `team_mechanics` is off; `invite_invalid` for a revoked, used, voided, unknown or malformed token, without revealing which.

_From 131-invite-garage-staff._

### 1255-FR-006 — Accepting an invite that names a card MUST, in the transaction of 131-FR-007, lock and re-read the card and the account's mechanic row: a removed card, a card of another garage, or an account that already holds a mechanic row at this garage answers `invite_invalid`; an account whose mechanic row is at another garage answers 409 `move_required` with that garage's name (the move is ST-1256) and nothing changes (a frame invite with no card keeps 131-FR-007's move at once); otherwise it sets the card's `account_id` to the account, `on_profile` true, copies the three permissions from the invite onto the card, keeps every other card field, grants the `mechanic` role, sets the invite `accepted`, writes the audit entry and records `invite.accepted` and `mechanic.updated` (payload: the card id, `fields: ['account']`) to the garage audience and, since the card is now on the profile, to `public:garage:{garageId}` and `public:mechanic:{mechanicId}` (056-FR-005's channels). Of two accepts at once by an account with no mechanic row, for two cards, one links its card and the other answers `invite_invalid` (never a 500). After the commit the owner gets STAFF_JOINED and the live update reaches `garage:{garageId}` (131-FR-009).

_From 1255-invite-mechanic._

### 131-FR-008 — Accepting MUST be refused with `invite_invalid` when the signed-in account owns this garage, is receptionist at another garage (receptionist invite), or when the invite's `team_mechanics` feature is off (404 `feature_off`); an account already holding the invited role at this garage completes with no change beyond the invite status.

_From 131-invite-garage-staff._

### 131-FR-009 — After acceptance the system MUST notify the garage owner with STAFF_JOINED (its catalogue channels; it can be muted) and publish a live update on `garage:{garageId}` for the new garage and, on a move, the old one.

_From 131-invite-garage-staff._

### 131-FR-010 — Every invite sent, resent, revoked and accepted MUST be written to the audit history with the actor and the permissions chosen, and `invite.sent`, `invite.revoked`, `invite.accepted` MUST be emitted in the same transaction as the change.

_From 131-invite-garage-staff._

### 531-FR-003 — The invite dialog MUST read `team_mechanics` for its garage from the session's garage entry at open and follow it while open: off → "Mecanic" is not offered, "Recepționer" is preselected, the permission ticks are hidden and no invite of kind `mechanic` is sent; on or unset → unchanged. The server's 404 `feature_off` answer MUST still withdraw "Mecanic" as today, for a session that has not heard of the switch.

_From 531-garage-feature-tabs._

### 1255-FR-010 — The public acceptance screen (131-FR-012) MUST, for a phone invite, open the phone sign-in with the number filled in instead of the e-mail sign-up; MUST show "Vei părăsi echipa {garage}" / "You will leave the team of {garage}" above "Acceptă" when `leaving` is set, and after a 409 `move_required` show "Mutarea la alt service nu este disponibilă încă." / "Moving to another garage is not available yet." and keep the page; a removed card's link shows the invalid-link message. After acceptance the person lands on the garage dashboard in the mechanic role (its existing limited menu).

_From 1255-invite-mechanic._

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

### 1255-FR-012 — Each row's lamp (055-FR-006) MUST read, grey, "nu apare pe profil · invitație trimisă" / "not on the profile · invite sent" when `invite` is set and not past `expiresAt`, and "nu apare pe profil · invitație expirată" / "not on the profile · invite expired" when past it; the other states are unchanged. The view MUST read again on `invite.sent` and `invite.revoked` too (056-FR-013's bound).

_From 1255-invite-mechanic._

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

### 1255-FR-014 — Removing a card (056-FR-006) MUST also set every `sent` invite naming that card to `revoked` in the same transaction.

_From 1255-invite-mechanic._

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

### 056-FR-017 — The dialog MUST show the field problems under their fields before and after the call: "Numele este obligatoriu" / "The name is required" for a name empty or under 2 characters, "Între 0 și 60 de ani" / "Between 0 and 60 years" for the years, and the limit for the other fields ("Cel mult 80 de caractere" / "At most 80 characters", "Cel mult 6 specialități" / "At most 6 specialties", "Cel mult 10 certificări" / "At most 10 certifications", "Cel mult 40 de caractere pe etichetă" / "At most 40 characters per tag", and under the brand ticks "Marcă pe care service-ul nu o acceptă" / "A brand the garage does not take"); while saving the button shows a spinner and the fields are disabled; a refusal or a network failure keeps the dialog open with the field errors and a toast in the person's language, except a 404 `not_found` on an edit (the card removed elsewhere), which closes the dialog with a toast and the list reads again; a success closes the dialog and the list shows the card at once.

_From 056-mechanic-dialog._

### 056-FR-018 — The edit dialog MUST offer "Elimină" / "Remove" for every card but the owner's (absent, not disabled, for `isOwner`); it opens a confirmation reading "{name} are {n} programări viitoare. Vor trebui realocate." / "{name} has {n} future bookings. They will need reassigning." with Romanian plural rules when `futureBookings` is above 0, else "Elimini pe {name} din echipă?" / "Remove {name} from the team?", with "Elimină" and "Renunță" / "Cancel"; confirming calls FR-006 and closes both on 204, and on a 404 `not_found` (the card already removed) as well; any other refusal shows a toast and keeps the dialog.

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

### 102-FR-011 — The API MUST offer `GET /api/v1/garages/:garageId/members` answering 200 with `{ members: [...], invites: [...] }`: each member carries `accountId`, `name`, `role` (`owner`, `receptionist` or `mechanic`), `since` (the membership's joined time; for a mechanic the time their invite was accepted when the system holds it, otherwise null) and, for a mechanic, `permissions` (the three flags; null for the others); each invite carries `id`, `email`, `kind` (`mechanic` or `receptionist`) and `sentAt`, and is listed only while `sent` and not past its expiry (131-FR-003). Members are ordered owner, receptionists, mechanics, each group by name in Romanian collation (as 055-FR-001); invites by `sentAt` ascending. The DTOs live in the contracts library and the web calls it through the generated client (Constitution V).

_From 102-garage-members._

### 102-FR-012 — The read MUST be open to the garage's owner only, through the held `assertGarageOwner` check (`garage-brands.service.ts`): a receptionist or a mechanic of the garage gets 403 `forbidden`; any other actor (another garage's owner, a driver, an admin) gets 404. A call without a session answers 401 `sign_in_required` (the app-wide guard), a `garageId` that is not a UUID answers 400, and a garage that does not exist answers 404. Nothing is written: no audit entry, no event.

_From 102-garage-members._

### 102-FR-013 — The garage's Setări view MUST show, to the owner only (`garage.feature_switches`, under the "Funcții" panel, 398-FR-001), a panel "Persoane cu acces" / "People with access": one row per member "{name} · {role}" with " · din {date}" when `since` is set and, for a mechanic, the names of the ticked permissions joined with ", " after " · " ("poate muta programări", "poate răspunde la cereri", "poate înregistra prețul final" / "can move bookings", "can answer requests", "can record the final price"); then "Invitații în așteptare" / "Pending invites" with one row per invite "{email} · {role} · trimisă {when}" (`when` the relative day: "azi", "ieri", else the date in the viewer's language, `14 oct. 2026` / `Oct 14, 2026`), or "Nicio invitație în așteptare." / "No pending invites." when none. Roles read "proprietar", "recepție", "mecanic" / "owner", "front desk", "mechanic". Revoke, remove and permission actions are not here: they belong to #811, #364, #202 and #10.

_From 102-garage-members._

### 102-FR-014 — While the first read is in flight the panel MUST show three skeleton rows; a failed read (any non-2xx or a network error) MUST show "Nu am putut încărca persoanele cu acces." / "We could not load the people with access." with a "Reîncearcă" / "Try again" button that reads again. The panel MUST read again, without a reload and within 5 seconds of the event (SC-002's figure), when the dashboard's live stream delivers `invite.sent`, `invite.revoked`, `invite.accepted`, `mechanic.updated` or `member.removed` for the garage.

_From 102-garage-members._

### 102-FR-017 — Every new text MUST exist in Romanian and English in the garage and shell translation files (016-FR-002), with comma-below diacritics; names and e-mails typed by a person MUST never be shown back as markup.

_From 102-garage-members._

### 102-FR-018 — The panel MUST lay out phones first: at 320 px and 390 px each row wraps onto its own lines with no horizontal scroll, light and dark; from a tablet (768 px, the `md` breakpoint) the fragments sit on one line. Every control is reachable and operable by keyboard with a visible focus ring, the rows form a list for assistive technology, and the loading, error and lost-access texts are announced (`role="status"` / `role="alert"`); text and controls meet WCAG AA contrast in light and dark.

_From 102-garage-members._

### 102-FR-019 — The members read MUST be listed in `infra/observability/inventory.json` as an endpoint with its reason (a read; the API's request-duration histogram labels the route, 876-FR-008; no panel or alert of its own), and the PR's Notes MUST say so.

_From 102-garage-members._

### 102-FR-020 — Tests MUST be written first and cover: Jest on the table for FR-001–FR-002 (every role × capability "may not", each permission on and off, every view's capability in the table); Jest on `allowedViews` for the three menus of FR-004 and on Panou for FR-005; Jest on real PostgreSQL for FR-007 (403 for same-garage staff, 404 outside, 404 `feature_off` to the owner only), FR-008, FR-009 (no `phone` key in any garage read as a mechanic), FR-011–FR-012; Jest on the live hub for FR-010; Jest on the frame and the panel for FR-013–FR-016; Playwright: a seeded mechanic signs in and sees the limited menu, the owner opens Persoane cu acces and sees the members and a pending invite the test creates through the invite API (`POST …/invites`, held), the seed untouched. The permission-tick half of the brief's end-to-end flow waits for #202, which owns the tick.

_From 102-garage-members._

### 1255-FR-002 — The invite send MUST accept `mechanicId` (optional, UUID) and `phone` (optional, E.164 after the phone sign-in's normalisation: a Romanian number without a prefix reads as +40) beside `email` (now optional), refusing a body with both or neither of `email` and `phone` (validation refusal), a `phone` with kind `receptionist` (validation refusal), and with `mechanicId` a kind other than `mechanic` (validation refusal). With `mechanicId` the name of the invite is the card's name and `name` is optional (ignored when sent); without `mechanicId`, `name` stays required (2–80 characters), a validation refusal otherwise.

_From 1255-invite-mechanic._

### 1255-FR-004 — The send MUST refuse the owner's own e-mail or own phone (the signed-in account's, compared normalised) with 409 `self_invite`, shown as "Nu te poți invita pe tine." / "You cannot invite yourself." (replacing 131-FR-003's `already_in_team` for that case).

_From 1255-invite-mechanic._

### 1255-FR-005 — Sending and resending an invite by phone MUST send STAFF_INVITE by WhatsApp to that number, through the provider's approved template for STAFF_INVITE in the owner's language with the garage name and the link, straight from the request as the sign-in code is (not through the notifications queue, which addresses accounts); never by SMS. When the message was not sent (sending off, number not allowed outside production, template missing, provider refusal) the invite MUST stay `sent` and the answer MUST carry `emailSent: false` and the link, exactly as a refused e-mail (131-FR-004); the answer's field keeps its name.

_From 1255-invite-mechanic._

### 1255-FR-007 — (#548) For every accept, the account's mechanic row MUST be read inside the transaction, after the invite row is taken, so that `mechanic.updated`'s `from` is the garage the row was in when this move committed; a concurrent move cannot leave a stale `from`.

_From 1255-invite-mechanic._

### 1255-FR-008 — (#550) The `invite_accepted` audit entry MUST carry `newValue` with `kind`, `name` and `permissions` (the three flags the row was created or linked with) in the same shape as `invite_sent`'s, plus `mechanicId` when the invite named a card; `oldValue` and `field` record the status change as before; the `invite_sent` entry is unchanged.

_From 1255-invite-mechanic._

### 1255-FR-009 — Opening a link (`check`, 131-FR-006) MUST answer `phone` (nullable) beside `email` (now nullable) and, when the call carries a session (the route takes an optional actor and the web sends its bearer) whose account has a mechanic row at another garage than the invite's, `leaving`: that garage's public name (else null); a session of the invite garage's own owner answers `invite_invalid`, as accept does; it still needs no session and reveals nothing else.

_From 1255-invite-mechanic._

### 1255-FR-011 — The team list (056-FR-011) MUST carry on each item `invite`: null, or `{ id, email, phone, sentAt, expiresAt }` of the card's one `sent` invite (the newest, when an old row exists), so the row and the card can show it; nothing else about the invite is listed.

_From 1255-invite-mechanic._

### 1255-FR-013 — The card dialog (056-FR-016) MUST, for a saved card with no account other than the owner's, offer "Invită" / "Invite": it opens the invite dialog (131-FR-011) in card mode: title "Invită pe {name}", no name field and no role choice (mechanic), one field that takes an e-mail or a phone ("E-mail sau telefon" / "E-mail or phone"; a value containing "@" is an e-mail, otherwise a phone; one that is neither a valid e-mail nor a valid phone shows "Introdu un e-mail sau un număr de telefon valid." / "Enter a valid e-mail or phone number." under the field and sends nothing), the three ticks unticked, and sends with `mechanicId`; the sent and not-sent outcomes are those of 131-FR-011. When the card's `invite` is set, expired or not, the card dialog MUST instead show "Invitație trimisă pe {to} · expiră {date}" / "Invite sent to {to} · expires {date}" (or "a expirat" / "expired") with "Retrimite" / "Resend" and "Anulează invitația" / "Cancel the invite", calling the resend and revoke routes; while a send, resend or revoke is in flight its button is disabled and shows progress, so a second tap sends nothing; the date reads in the page language's short format (dd.MM.yyyy); a success closes nothing and refreshes the list; a 409 `invite_invalid` (answered elsewhere meanwhile) refreshes the list and shows a toast.

_From 1255-invite-mechanic._

### 1255-FR-015 — A card with no account MUST still be given bookings as any mechanic (389-FR-005, 056-FR-015 unchanged) and is not public (`on_profile` false until acceptance); covered by a test on the confirm path with a card that has an open invite.

_From 1255-invite-mechanic._

### 1255-FR-016 — Every new text MUST exist in Romanian and English (016-FR-002), with comma-below diacritics; names, e-mails, phones and garage names typed by a person MUST never be shown as markup (131-FR-013). The dialog and the page MUST lay out phones first: 320 px and 390 px with no horizontal scroll, light and dark, Romanian and English; every control reachable by keyboard; the field has a visible label and its error is tied to it and announced, focus returns to the control that opened the dialog on close and to the invite block's first button after a refresh, and the leaving warning and the `move_required` message are announced as alerts. Refusals reaching the dialog (`invite_open`, `self_invite`, `already_in_team`, `feature_off`, 403) each have a Romanian and English text; `owner_row` and `card_linked` are not reachable from the UI (no button) and fall back to a generic "Nu am putut trimite invitația." / "The invite could not be sent."

_From 1255-invite-mechanic._

### 1255-FR-017 — No new endpoint is added: the existing send, resend, revoke, check and accept routes gain the fields above; the DTOs live in the contracts library and the web calls the regenerated client (Constitution V). `infra/observability/inventory.json` gains no entry: the WhatsApp send goes through the existing `brevo` outside-call entry and the routes are already listed; the PR's Notes say so.

_From 1255-invite-mechanic._

### 1255-FR-018 — Tests MUST be written first and cover: Jest on real PostgreSQL for FR-001–FR-008 and FR-014 (the card named and the permissions false by default; by phone, WhatsApp called with the template, SMS never, the not-sent fallback with the link; `owner_row`, `card_linked`, `invite_open`, `self_invite` by e-mail and by phone, `already_in_team` by phone, 403/404/`feature_off`; accept: a new account and an existing driver account linking the same card with `on_profile` true and the permissions copied, the card's fields kept, `move_required` for a mechanic elsewhere, `invite_invalid` for a removed card and for a second row at the garage, the frame invite unchanged; the concurrent move's `from` (FR-007); the `invite_accepted` entry's permissions, failing on today's code (FR-008); the card's invites revoked on removal; the list's `invite` field); Jest for the web (the card's "Invită" absent for a linked card and the owner's row, the card-mode dialog's fields, the lamp texts by state, the card's invite block with resend and revoke, the landing page's phone sign-in, the "Vei părăsi" line and the `move_required` message); Playwright (`web-e2e`): the owner invites Elena from her card by e-mail (Brevo stubbed), Elena opens the link in a second browser, creates her account, accepts and lands on the garage dashboard as a mechanic, and the owner's row turns "pe profil" live; the PR QA sweep: the card dialog's invite block and the landing page at 320 px, 390 px, tablet and desktop, light and dark, RO and EN.

_From 1255-invite-mechanic._

## Retired

- `129-FR-009` — superseded by `055-FR-004` (2026-10-24)
- `131-FR-011` — superseded by `531-FR-003` (2026-10-24)
- `055-FR-001` — superseded by `056-FR-011` (2026-10-24)
- `055-FR-009` — superseded by `056-FR-012` (2026-10-24)
- `055-FR-012` — superseded by `056-FR-013` (2026-10-24)
- `055-FR-004` — superseded by `056-FR-014` (2026-10-24)
- `389-FR-005` — superseded by `056-FR-015` (2026-10-24)
- `131-FR-001` — superseded by `1255-FR-001` (2026-10-25)
- `131-FR-003` — superseded by `1255-FR-003` (2026-10-25)
- `131-FR-007` — superseded by `1255-FR-006` (2026-10-25)
- `131-FR-012` — superseded by `1255-FR-010` (2026-10-25)
- `055-FR-006` — superseded by `1255-FR-012` (2026-10-25)
- `056-FR-006` — superseded by `1255-FR-014` (2026-10-25)
