---
capability: cars
updated: 2026-10-31
features:
  - 089-add-a-car
  - 090-itp-status-lamp
  - 092-edit-remove-car
  - 1169-prefetch-intent
  - 290-save-garage
  - 029-overview-panels-own-data
  - 291-saved-garages
  - 129-delete-account
  - 094-itp-reminders
  - 091-oil-service-due
  - 415-car-transfer-link
  - 276-job-start-done
  - 1265-car-transfer-accept
  - 1386-oil-service-lamp
  - 409-garage-corrects-repair
  - 061-repair-list
  - 1267-admin-corrects-repair
  - 1400-garage-corrects-repair-web
  - 1379-provider-calls-worker
  - 293-save-garage-suggest
---

# Capability: Cars

The cars a driver keeps on their account: adding one, the owner's own list and card, the limits, and the plate kept private to its owner.

## Requirements

### 091-FR-003 — The owner MUST be able to set, change or clear (`null`) `nextServiceKm` through the existing `PATCH /api/v1/cars/:id` and, optionally, when adding a car through `POST /api/v1/cars` (judged against the new car's odometer), as one more editable field (092-FR-001's merge patch, version check and 404 for another account's car unchanged). It MUST be a whole number greater than the car's odometer and at most 100,000 km above it and never above the odometer ceiling the kilometres field already has (a value over it is refused as `next_service_too_far`), judged against the odometer the same request leaves (new or unchanged), and checked only when the patch carries `nextServiceKm` with a value different from the stored one (an odometer raised past a kept value saves, and the line turns red); otherwise 400 with codes `next_service_not_above_odometer` and `next_service_too_far` and nothing saved. (Modifies 029-FR-006: `nextServiceKm` is no longer read-only; modifies 092-FR-001: the editable fields gain it; modifies 089-FR-001: this is the later story that writes next service km.)

_From 091-oil-service-due._

### 094-FR-008 — The cars service's "at most five years ahead" check and the adversary helper that builds a date five years ahead MUST compute it with one shared rule, so that on 29 February they land on the same day (29 February + 5 years = 28 February of that year, the last day the month has); a fixed-clock test on 2028-02-29 MUST pass for both (#630). (Modifies 089-FR-003: the five-years limit now says what day it falls on in a leap year.)

_From 094-itp-reminders._

### 089-FR-004 — An account MUST hold at most 20 cars not removed; the 21st is refused with 409 `car_limit`; the count and the insert run in one transaction that first locks the account row (`SELECT … FOR UPDATE`), so two parallel saves at 19 cars create one car, not two and the dialog shows "Poți avea cel mult 20 de mașini." / "You can have at most 20 cars.".

_From 089-add-a-car._

### 089-FR-005 — The save MUST be idempotent: the request carries the key the form-saving helper issues per dialog (159-FR-004) in the `Idempotency-Key` header (as 255-FR-007 and `apps/web/src/app/dashboard/waiting.ts:227` do); a second request with the same key from the same account answers the car the first created, 201 again, and creates nothing. The key is stored on the car itself, unique per owner (`owner_id`, `idempotency_key`), in PostgreSQL (never only in Redis, Principle VI); cars are never hard-deleted, so the key lives as long as the car. A request without the header, or with a key of 0 or more than 64 characters, answers 400 `validation_failed` on the field `idempotency-key` and creates nothing.

_From 089-add-a-car._

### 1265-FR-002 — Adding a car (089) MUST open its `owner` ownership row in the same transaction as the car, the audit entry and `car.added` (089-FR-007 unchanged in what it writes; this row joins it).

_From 1265-car-transfer-accept._

### 1386-FR-001 — The add dialog and the edit dialog MUST carry, after Kilometri, the optional field "Următorul schimb de ulei la (km)" / "Next oil service at (km)", with the kilometres' input rules (a whole number written with or without thousands separators, at most the odometer ceiling), pre-filled in the edit dialog with the car's value in the person's number format and empty without one; the add dialog MUST send it only when filled, and the edit dialog MUST send it only when it differs from the car's stored value, a blank as a cleared value (`null`) when the car had one (092-FR-010's "only the fields that differ" rule). The dialog opened from the grey oil line (FR-004) MUST place the focus in this field, as it does for the three date fields. (Modifies 089-FR-009: the add dialog's fields gain it; modifies 092-FR-010: the edit dialog's fields and focus targets gain it.)

_From 1386-oil-service-lamp._

### 089-FR-011 — The plate MUST appear only in the owner's own answers (FR-002); the public-routes test list MUST be unchanged (both routes need a session); another account's car by id answers 404 (079-FR-013).

_From 089-add-a-car._

### 089-FR-012 — Tests MUST cover: every validation limit, plate normalising and grouping, the 20-car limit, the idempotency key (same key → same car, different key → new car), 404 for another account's car, the audit entry and `car.added` written in the same transaction (a failing audit write rolls the car back), the role granted once to a garage-only account and never to a driver, no plate outside the owner's answers (Jest, on real PostgreSQL where the repository is used); the dialog's fields and messages in both languages, the brand search, the card's three ITP lines and the km separator (Jest); end to end (Playwright): sign in as a new driver, add BMW 320d 2019 with an ITP date, see the card at once, sign out and in, still there; switch to EN and add a second car; the garage-only owner adds a car from the account block and the driver chip appears.

_From 089-add-a-car._

### 090-FR-001 — The web app MUST have one due-date line, used by every car card: a lamp (the shared indicator lamp, `mf-lamp`, 051) with its sentence, and an optional link after it. It MUST take the item's expiry date (a calendar day or none) and the texts of that item (key prefix), so the RCA, rovinietă and oil lines reuse it by passing their own texts; this story uses it for the ITP only.

_From 090-itp-status-lamp._

### 090-FR-002 — The days left MUST be the whole calendar days from today in Europe/Bucharest to the expiry day (expiry day minus today), whatever the device's own time zone, and MUST be computed from the clock on every change-detection pass of the card (a pure function of expiry and now, no timer). The item is valid through its expiry day.

_From 090-itp-status-lamp._

### 090-FR-003 — The lamp state MUST be: green above 60 days left; amber from 8 to 60; red at 7 or fewer, including 0 and any passed date; grey with no date.

_From 090-itp-status-lamp._

### 090-FR-004 — The ITP sentence MUST be, by state: green "ITP valabil până în <month> <year>" / "ITP valid until <Month> <year>" (Romanian month in lower case, English capitalised); amber and red not passed: "ITP-ul expiră în <n> <zile>" / "ITP expires in <n> days", with the Romanian plural ("2 zile", "20 de zile"), "ITP-ul expiră mâine" / "ITP expires tomorrow" at 1 and "ITP-ul expiră azi" / "ITP expires today" at 0; passed: "ITP-ul a expirat pe <day>" / "ITP expired on <day>" with the day in the person's date format ("1 oct. 2026" / "1 Oct 2026"); grey: "ITP: adaugă data din talon" / "ITP: add the date from the registration". The colour is never the only signal: the sentence states the status, and the lamp's dot stays hidden from assistive technology.

_From 090-itp-status-lamp._

### 090-FR-005 — A passed ITP line MUST end with the link "Caută un service" / "Find a garage" to the garage results in the person's language for the car's brand, `/<lang>/garages?brand=<brand id>`; no other state carries a link. The link is a native anchor (keyboard-reachable, focus visible) with at least a 44 px touch target, and its accessible name includes the car ("Caută un service pentru BMW Seria 3" / "Find a garage for BMW 3 Series") so several cards do not offer identical links.

_From 090-itp-status-lamp._

### 1386-FR-004 — A car with no next-service value MUST show the grey oil line "Schimb de ulei: adaugă kilometrajul" / "Oil service: add the reading" after the rovinietă line on Mașinile mele's card, as a button operable by keyboard with at least a 44 px touch target, opening the edit dialog with the focus in the next-service field (FR-001), as the grey date lines of 092-FR-009 do; Panou's car panel keeps showing no oil line for such a car (its three date lines always rank before a grey oil line). (Modifies 029-FR-007: the card shows a grey line, not no line, without a value; modifies 092-FR-009: the card's fourth grey line and its button.)

_From 1386-oil-service-lamp._

### 090-FR-007 — Tests MUST cover: the state and sentence for 61, 60, 8, 7, 1, 0 and −1 days and for no date, with a fixed clock in Europe/Bucharest, including just before and after midnight and the change to and from summer time; the Romanian plural and both languages' month names; the link only on a passed date, with its address (Jest); end to end (Playwright): a new driver adds a car with an ITP 36 days ahead and sees the amber line, then adds a car with an ITP 400 days ahead and sees the green line (dates relative to today in Europe/Bucharest, never literal).

_From 090-itp-status-lamp._

### 092-FR-002 — The car MUST carry an update time (`updated_at`, set on creation and on every change), returned to the owner in every car answer as its version; an edit MUST send the version it loaded as a required `version` body field, and a mismatch MUST answer 409 `stale_version` and change nothing. The dialog then reloads the car, shows scenario 6's message and keeps the dialog open with the current values.

_From 092-edit-remove-car._

### 092-FR-003 — The system MUST let the owner remove a car through `DELETE /api/v1/cars/:id` (capability `driver.cars`; 404 as FR-001): a soft removal that sets `removed_at` and answers 204; the car is never hard-deleted (089-FR-005). It MUST be refused with 409 `open_request` when the car has a quote request in `sent`, `quoted`, `booked` or `in_work`; the check and the removal run in one transaction. A removed car MUST be absent from `GET /api/v1/cars` (089-FR-002, unchanged) and from the 20-car count (089-FR-004, unchanged), so every screen that reads the list (Mașinile mele, the home page's cars panel, the request-quote car picker) no longer shows it. There is no undo.

_From 092-edit-remove-car._

### 092-FR-004 — In the same transaction as the change, the system MUST write audit entries through the audit writer (390-FR-001): for an edit, one entry per changed field with old and new value (action `update`, subject `car`, actor the account in its role in use; values as the car answer carries them: the brand id, dates as `YYYY-MM-DD`, numbers and text as such; the plate's entry names the field with both values `null`); for a removal, one entry "car removed" (action `delete`, subject `car`). An edit that changes no field writes no entry.

_From 092-edit-remove-car._

### 092-FR-005 — In the same transaction, the system MUST hand to the event port `car.updated` (car id, owner id and the names of the changed fields; the worker reads the dates from the car, FR-006) and `car.removed` (car id, owner id); neither carries the plate or the model (089-FR-007). Nobody is notified and nothing updates live.

_From 092-edit-remove-car._

### 091-FR-010 — The worker MUST, on `car.added` and on `car.updated` with `nextServiceKm` or `odometerKm` changed, set the car's `service` reminder from the car as it is when the event is handled: `due_on` = the estimated date of FR-005, `due_km` = the car's next-service value; when `nextServiceKm` changed (or the car was added with one), the row takes a new id with both sent flags reset (a stage whose day is already past is marked sent, 094-FR-003's rule); when only `odometerKm` changed, `due_on` moves and the flags and id stay, so a stage already sent for this value is not sent again, and a stage whose day the move put in the past is marked sent, not caught up; the row is upserted, so when none exists (cancelled earlier) it is created with a new id and flags reset; with no next-service value, or a null estimate (due now or passed), the `service` reminder is cancelled (its row deleted). A retried or out-of-order event MUST reach the same rows (092-FR-006's rule). (Modifies 092-FR-006: the worker's car events now also drive the `service` kind.)

_From 091-oil-service-due._

### 092-FR-007 — A removed car MUST get no reminder from the daily run: its rows are gone (FR-006), and the run MUST also skip any reminder whose car has `removed_at` set, so a removal that commits between a run's read and its send sends nothing.

_From 092-edit-remove-car._

### 094-FR-003 — A new ITP date MUST reset the flags, and the old date's remaining stages MUST never be sent; a stage whose day is already past when the date is entered or changed MUST be skipped (marked sent), while a stage whose day is today is still sent by today's run. (Modifies 092-FR-008 for the ITP, with scenario 2.2 and the edge cases of this spec as its tests.)

_From 094-itp-reminders._

### 092-FR-011 — The removal MUST be confirmed in a dialog with scenario 1's text (User Story 2) naming the car as "<brand> <model>", with "Șterge mașina" / "Remove the car" as the main button and "Renunță" / "Cancel"; a refusal (FR-003's `open_request`, or any other error) MUST show its reason inside that dialog, which stays open; on success the dialog closes and the card leaves the list at once.

_From 092-edit-remove-car._

### 1265-FR-012 — `GET /api/v1/cars/sold` (capability `driver.cars`) MUST answer the caller's `former_owner_read_only` rows, newest sale first (ties by closing instant, newest first), each with the car's `id`, `brandName`, `model`, `year` and `saleDate` (`to_date`), the car's removal notwithstanding; `GET /api/v1/cars/sold/:id/repairs` MUST answer, for a car the caller has such a row for (else 404), the repairs that row may read (FR-010; done on or before the sale date), in FR-011's shape and order. A car the caller owns again (a second transfer back) is listed by both its open row (in `GET /api/v1/cars`) and its closed row (here). These reads are read-only: no write of this story or of 092 accepts a car through a closed row. (Modifies 092-FR-012: selling a car and passing its history on is this story's, and the former owner's read is the one exception to "repairs read only cars not removed".)

_From 1265-car-transfer-accept._

### 092-FR-013 — The two endpoints MUST be listed in `infra/observability/inventory.json` with the existing cars module's metrics, logs and traces; no new service, queue, outside call or dashboard panel is needed, and the PR's Observability section says so.

_From 092-edit-remove-car._

### 092-FR-014 — Tests MUST cover: every field editable within the add-dialog limits and each limit refused; the plate added, changed and cleared and absent from events, audit values and other accounts' answers; a date change resets the flags and a sent stage never repeats for the same date; a cleared date cancels its reminder; removal refused with an open request in each of the four states and allowed in `done` and `closed`; removed cars absent from `GET /api/v1/cars`, from the 20-car count and from the reminder run; 404 for another driver's car and for a removed car; 409 on a stale version; the audit entries and events written in the same transaction (a failing audit write rolls the change back) (Jest, on real PostgreSQL where the repository is used); the card menu, the three due-date lines and their grey lines, the edit dialog pre-filled, the lower-kilometres question and the removal confirmation with its refusal, in both languages (Jest); end to end (Playwright): a driver edits a car's ITP date and sees the line change; removes a car and sees it gone from Mașinile mele and the home page's cars panel.

_From 092-edit-remove-car._

### 1169-FR-003 — For a session opened as a driver the warm MUST read, as the home reads them, the account's car list (`GET /api/v1/cars`, first page, no query) and request list (`GET /api/v1/requests`, first page, no query), each stored under kind `driver-home`, the account id and the list's name, tagged `warm:account:{accountId}`.

_From 1169-prefetch-intent._

### 290-FR-001 — The system MUST store a saved garage as SAVED_GARAGE in the `cars` module: account (the driver's account), garage, and `saved_at` (UTC). The pair (account, garage) MUST be unique; a row is deleted on removal (no soft delete). No limit on the number of rows per account.

_From 290-save-garage._

### 290-FR-002 — `PUT /api/v1/me/saved-garages/:garageId` MUST save the garage for the actor's own account and answer 201 with `{ garageId, savedAt }` when a row was created, or 200 with the existing row when it already existed, changing nothing. An optional body `{ savedAt }` (an undo) MUST set `saved_at` to that time on a created row; a `savedAt` in the future (later than the server's now) MUST be refused with 422 `saved_at_in_future` and create nothing; a malformed body, or a `:garageId` that is not a valid id, answers 400 `validation_failed` on all three routes that take one (save and remove).

_From 290-save-garage._

### 290-FR-003 — Only an `approved` garage MAY be saved: a `draft`, `suspended` or unknown garage id answers 404 `not_found` with no garage data, and nothing is stored.

_From 290-save-garage._

### 290-FR-004 — `DELETE /api/v1/me/saved-garages/:garageId` MUST delete the actor's row for that garage and answer 200 with `{ garageId, savedAt }` (the removed row's time, which the undo sends back); when no row exists it MUST answer 204 and change nothing. It MUST work whatever the garage's status.

_From 290-save-garage._

### 290-FR-005 — `GET /api/v1/me/saved-garages/ids` MUST answer `{ ids: [garageId, …] }`, the actor's saved garage ids, every row whatever the garage's status, in no promised order; it is uncached and is the only read of this story (the list with names and dates is #169).

_From 290-save-garage._

### 290-FR-006 — An account whose role in use is not `driver` (no `driver` role, or acting in another role) MUST be answered 403 `driver_role_required` on all three routes (the Build brief's rule; a role check ahead of the capability check); the capability check `driver.saved_garages` stays after it, so a driver whose capabilities ever lack it keeps the capability policy's 404 (130-FR-003 unchanged; today every driver holds it, so no test reaches that branch); a visitor 401 `sign_in_required` as every gated route (130-FR-001). An account never reads or writes another account's rows: the routes are under `/me` and take no account id.

_From 290-save-garage._

### 290-FR-007 — The save and the removal MUST each write, in the same transaction as the row (390-FR-001), one audit entry — "garage saved" (action `create`, subject `saved_garage`, new values `{ garageId, savedAt }`) and "garage removed from saved" (action `delete`, old values the same) — as the driver's action, with **no** `garage_id` (and no car or job id), so the garage's audit view (391) never shows who saved it. An idempotent save (200) and a removal of nothing (204) write no entry.

_From 290-save-garage._

### 290-FR-016 — The three routes MUST be listed with their logs, metrics, dashboard panel and alert (or why not) in `infra/observability/inventory.json` in the same PR, as the constitution asks of every new endpoint.

_From 290-save-garage._

### 290-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Redis: save (201, the row, the audit entry and the event in one transaction, rolled back together on a failed write), save twice (200, one row, no second entry or event), remove (200 with the time), remove when not saved (204), undo with `savedAt` (the first time kept) and a future `savedAt` (422), 404 for a `draft`, `suspended` and unknown garage, 403 without the `driver` role, 401 for a visitor, the ids read with none and several rows, and the audience of both event kinds. In Playwright: as a visitor, tap save on a profile, sign in, see "Salvat"; remove it and undo.

_From 290-save-garage._
### 1386-FR-003 — The oil line MUST judge its lamp by the car answer's `serviceDueOn`: the calendar days from today (Europe/Bucharest) to that day, read on every check as the date lines do; green over 60 days, amber from 8 to 60, red at 7 or fewer (the line's ranking days are those calendar days; with `serviceDueOn` null they are the km-derived days of today's rule, 0 or negative); red whenever the distance left (`nextServiceKm` − `odometerKm`) is 0 or below, whatever the date. Sentences, kilometres in the person's number format: above 0 km "Schimb de ulei peste <n> km" / "Oil service due in <n> km"; at 0 km "Schimbul de ulei este scadent acum" / "Oil service is due now"; below 0 "Schimbul de ulei a trecut de <n> km" / "Oil service overdue by <n> km" (n positive). An answer without the `serviceDueOn` field, or with it null while the distance left is positive, MUST fall back to the default estimate of 1,000 km a month exactly as today. Panou's car ranking and each car's two most urgent lines MUST use this same judgement for the oil line (one rule in the web for the card and the panel). (Modifies 029-FR-003: the days come from `serviceDueOn`, the default is the fallback only, and the 0 km sentence changes.)

_From 1386-oil-service-lamp._

### 291-FR-001 — `GET /api/v1/me/saved-garages?near={lat},{lng}&cursor=` in the `cars` module MUST answer the actor's own saved garages, 20 a page, ordered by `saved_at` newest first then garage id, with `nextCursor` (opaque; the last row's saved time and id) when more follow; a cursor this list never gave out answers 400 `invalid_cursor`. The read covers every row whatever the garage's status; a driver with no saved garage answers an empty page. The answer is private: `Cache-Control: no-store`. The account whose list is read is always the actor's own: the route takes no account id, so another person's list cannot be asked for (the brief's 404 is moot). An account whose role in use is not `driver` answers 403 `driver_role_required` as 290-FR-006; a visitor 401 `sign_in_required`.

_From 291-saved-garages._

### 291-FR-002 — Each item MUST carry: `garageId`, `name`, `slug`, `rating` (null when unrated), `reviewCount`, `available` (true only for `approved`), `businessKind`, `savedAt`, `brands` (the brands that count, FR-003, as `{ id, name }` in the order of FR-003), and, only when `near` is given, `distanceKm` (one decimal; null for a mobile mechanic or a garage without a position) and, for a mobile mechanic, `comesToYou` (true when the place lies within its service radius of its seat, 229-FR-011; its seat never leaves the server). The answer MUST also carry `total` (every saved garage) and `workingCount` (those whose `brands` is not empty), both over the whole list, not the page.

_From 291-saved-garages._

### 291-FR-003 — A brand counts for a garage when at least one of the driver's cars not removed has that brand, the garage's row for the brand has stance `works_on`, and the row ticks that car's fuel. No row, `does_not_take`, or an unticked fuel leaves the brand out (OD-15: unmarked is a refusal). `brands` names each brand once, in the order the driver's cars are listed (newest first, 089-FR-002, by the first car of that brand); a driver with no car gets an empty `brands` for every garage. The join runs in the database in one query per page (no read per garage).

_From 291-saved-garages._

### 291-FR-004 — `near` MUST be validated as the garage search validates it (two numbers inside Romania's bounding box, else 400 `validation_failed`), and the distance MUST be the straight-line distance over the earth computed in the database through the shared area code of the `search` module (229-FR-013), rounded to one decimal; no radius limits the list (the 25 km search distance does not apply). Without `near`, items carry neither `distanceKm` nor `comesToYou`.

_From 291-saved-garages._

### 291-FR-005 — The route MUST be listed with its logs, metrics, dashboard panel and alert (or why not) in `infra/observability/inventory.json` in the same PR; reads are not recorded in the audit history. Removal from a row goes through ST-290's `DELETE /api/v1/me/saved-garages/:garageId` and its undo through the `PUT` with `savedAt` (290-FR-002, FR-004), unchanged.

_From 291-saved-garages._

### 291-FR-015 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the brand line with a `works_on` brand with the fuel ticked, a `does_not_take` brand, an unmarked brand and an unticked fuel; two cars of one brand named once; a removed car not counting; empty `brands` with no car; the order of the brands; `distanceKm` with `near` and neither field without; a mobile mechanic inside and outside its area; `available` for `suspended` and `draft`; `total` and `workingCount` over the whole list; the order and the cursor (21 rows: 20 then 1; a cursor that does not decode 400; a cursor whose row was removed still pages); 403 without the driver role; 401 for a visitor; 400 for a `near` outside Romania. In Jest for the web app: the lamp line in every state and language, the subtitle's forms (1, 0, 2–19 and the "de" form from 20), the panel's 3-row cut and "Vezi toate", the skeletons, the error with retry, the empty state, the remove with undo and with a failed removal, the re-read on a live event. End to end (Playwright): as a driver with two cars, save two garages, open Service-uri salvate, check both lines and the subtitle, remove one and undo.

_From 291-saved-garages._

### 129-FR-011 — The worker MUST, on `account.deleted`, clear the plates of the account's cars in the cars module, idempotently; other modules' rows that hold no personal field are kept under the retention config (#1156).

_From 129-delete-account._

### 094-FR-001 — For every car with an ITP date and a living owner account, the system MUST send one DUE_ITP 30 days before the date and one 7 days before it, each on the day the daily run (09:00 Europe/Bucharest) falls on `due_on − 30` and `due_on − 7`, recording `sent_30` and `sent_7` on the car's one `itp` reminder (`due_on` = the car's `itp_until`), and writing the bell row of each. A stage whose flag is set MUST NOT go again for the same date setting.

_From 094-itp-reminders._

### 094-FR-002 — A run repeated on the same day, or a retried send, MUST produce one message per stage: the send is identified by the reminder (one per car and kind `itp`, given a new id by each new date), the due date and the stage, so two attempts write one bell row and send one message.

_From 094-itp-reminders._

### 094-FR-004 — No reminder MUST go for a car removed before the send day, for a car removed between the run's read and its send, or for an account that is deleted; with the driver's Scadențe switch off, no e-mail, push, SMS or WhatsApp MUST go and the bell row MUST still be written.

_From 094-itp-reminders._

### 094-FR-005 — A daily run that was missed (an outage) MUST send the missed stage at its next run while the date is still ahead, once; once 7 or fewer days remain only the 7-day stage goes and the 30-day stage counts as sent; a message that ended `failed` MUST NOT be sent again by a later run.

_From 094-itp-reminders._

### 094-FR-006 — A Playwright test in `apps/web-e2e` MUST seed a signed-in driver who adds a car whose ITP is due in 30 (shortened) days, let the worker the test run starts do the reminders job on shortened days, and show the DUE_ITP row in the driver's bell; advancing to the 7-day stage MUST show the second DUE_ITP row. Its spec file MUST set Playwright retries to 0, pass in the PR's CI runs, and MUST never shorten a day in staging or production (#447).

_From 094-itp-reminders._

### 094-FR-007 — The `car()` fixture of the reminder specs MUST live once in `fixtures()` of `libs/domain/src/notifications/notifications.testing.ts`, and the three reminder integration specs (service, worker, adversary) MUST import it and keep no copy (#629).

_From 094-itp-reminders._

### 094-FR-009 — Tests MUST cover, with a fixed clock on a real database: the 30-day and 7-day send days, the skipped window, the catch-up, idempotency on a double run, the reset on a date change and no resend of the old date, no send for a removed car, a deleted account or Scadențe off, SMS cap to WhatsApp, push to e-mail, no confirmed phone to e-mail, a retry held to 08:00, Brevo failing through the queue's retries to the e-mail fallback or `failed`, and not resent, and the Romanian and English texts; the e2e of FR-006; and the fixture and leap-year checks of FR-007 and FR-008. Each test file names the ids it covers in one whole-line `// @traces` comment.

_From 094-itp-reminders._

### 091-FR-001 — The system MUST store a car's odometer readings in one table, ODOMETER_READING: id, car, km (a whole number), read_on (a calendar day), source (`driver`, `reception` or `repair`), source_id (optional, the record the reading came from: none for `driver`), creation time; a reading is removed with its car's row. It MUST be modelled for the later sources too: a `reception` row (#163) or a `repair` row (#62, #103) MUST be usable by this story's average and odometer rule without a change to them.

_From 091-oil-service-due._

### 276-FR-008 — The API MUST offer `POST /api/v1/garage/jobs/:id/receive` with `{ odometerKm }`, a whole number 0 … 2,000,000 (else a validation failure), allowed to the owner, a receptionist and the job's mechanic of the garage (403 to another mechanic of the garage, 404 outside it), while the job is `to_do` or `in_work` (409 `job_closed` otherwise; a `paused` job is answered 409 `invalid_state`). It MUST, in one transaction locking the job row: set `JOB.odometer_km` and, when not yet set, `JOB.received_at` = now; write one ODOMETER_READING (the job's car, the reading, today in Europe/Bucharest, source `reception`, `source_id` = the job); set `CAR.odometer_km` to the reading when the new row is the car's newest (091-FR-002's invariant) with the car's `odometerKm` audit entry and `car.updated` naming `odometerKm` as 091-FR-009 asks, so the service-due estimate follows; record the job's audit entry (`job.odometer_km`, old and new value, the actor and role; a repeat is the brief's audited correction); and emit `job.received` `{ odometerKm }` with the `job` audience. It answers the job.

_From 276-job-start-done._

### 091-FR-004 — The average monthly mileage of a car MUST be computed from its readings with `read_on` on or after the same calendar day 12 months before today (so a reading exactly 12 months old counts and one a day older does not; today included): (newest km − oldest km) ÷ days between them × 30.44, when the newest and oldest are 30 or more days apart and the difference in km is positive; otherwise 1,000 km a month. One pure rule in the domain library MUST compute it, used by the API answer and by the worker alike (Principle V).

_From 091-oil-service-due._

### 091-FR-005 — The estimated due date MUST be the newest reading's `read_on` + round(distance left ÷ daily average) days in Europe/Bucharest (for a reading taken today, today + the days), where distance left = `next_service_km` − `odometer_km` and daily average = monthly average ÷ 30.44; it MUST be null when the car has no next-service value or when distance left is 0 or below (the service is due now or passed). Every car answer MUST carry it as `serviceDueOn` (a calendar day or null) beside `nextServiceKm`. For the brief's car, 3,800 km left on an average of ≈ 44.7 km a day is 85 days, 1 January 2027 (± 1 day); 1,500 km is 34 days; the default average makes 3,800 km 116 days, as today.

_From 091-oil-service-due._

### 091-FR-009 — In the same transaction as the change, the audit entries of 092-FR-004 MUST cover `nextServiceKm` and `odometerKm` with old and new value; a reading row writes no audit entry of its own (it is derived from the car's change); `car.updated` MUST name `nextServiceKm` or `odometerKm` among the changed fields (092-FR-005), never the plate or the model.

_From 091-oil-service-due._

### 091-FR-013 — The API MUST answer 404 for a car of another account on every read and write this story touches (092-FR-001), and the readings MUST never be listed to anyone but through the car's own answers (no readings endpoint in this story).

_From 091-oil-service-due._

### 091-FR-014 — The driver's account data export (140) MUST include each car's readings (km, read_on, source); the account deletion's cascade MUST remove them with the car rows, and a removed car's readings are hidden with the car (092-FR-012's rule).

_From 091-oil-service-due._

### 091-FR-015 — `infra/observability/inventory.json` MUST list the `odometer_reading` table with the cars module and SERVICE_DUE under the reminders job where the inventory lists the job's types; the existing cars endpoints, the reminders job and the notifications queue carry the change with their metrics, logs and traces, and the PR's Observability section says no new service, queue, outside call, endpoint or panel is needed.

_From 091-oil-service-due._

### 091-FR-017 — Tests MUST cover, with a `// @traces` line per spec file: the average with two readings a year apart, with one reading, with readings under 30 days apart, with a reading older than 12 months and with a lowered odometer; the estimated date and lamp at 3,800 km (green, 85 days from the brief's readings), 1,500 km (amber), 0 and −200 km (red, null date) and at the 60/61 and 7/8 day boundaries; the field refused at, below and more than 100,000 km above the odometer by the API, and an unchanged stored value not rechecked; a reading on add, on each change and none on an unchanged odometer; the back-fill; `serviceDueOn` in the car answers and null without a value; the audit entries and the event's changed fields; the worker's new id and reset on a new value, the moved date with kept flags on an odometer change, the cancel on null or passed; SERVICE_DUE at 30 and 7 days once each, the reset on a new value, the skipped past stage, no send for a removed car, a deleted account or a muted group, a send held from 22:00–08:00 to 08:00, the templates in both languages.

_From 091-oil-service-due._

### 415-FR-001 — The system MUST hold a REPAIR record per car (the minimal shape this story reads: the car, the job when the repair was done through MotorFix (unique, optional), the source (`motorfix` or `logged`), what was done, the garage name, the garage when on MotorFix (optional), the date done, a soft-deletion time and the creation time), with no writer in this story: ST-61 and ST-62 add the writers and the remaining columns. A repair's history in the sale dialog reads these rows only; a deleted logged repair never shows and cannot be ticked.

_From 415-car-transfer-link._

### 415-FR-002 — The system MUST hold a CAR_TRANSFER record (the car, the seller, the buyer's phone in E.164, the hash of the link's token, the status `sent` | `accepted` | `cancelled` | `expired`, the sending time, the expiry = sending + 7 days (`CAR_TRANSFER_LINK_VALID_DAYS` = 7), the buyer and the sale date left empty for ST-1265) and a CAR_TRANSFER_REPAIR record per ticked repair (the transfer, the repair; unique per pair). The raw token is never stored and never logged; only its hash is.

_From 415-car-transfer-link._

### 1265-FR-013 — ST-415's sale read (`GET /api/v1/cars/:id/sale`, 415-FR-003) MUST list only the repairs the seller's open ownership row may read (FR-010), and the send (415-FR-004) MUST accept a tick only on an active `logged` repair among them (else 400 `repair_not_tickable` as today), so a car sold twice passes on what the second seller received and never what the first seller kept.

_From 1265-car-transfer-accept._

### 415-FR-005 — The link MUST be `<PUBLIC_WEB_URL>/<lang>/transfer/<token>` with the seller's interface language, the token at least 32 random bytes in URL-safe form, looked up by its hash; a token is shown to the seller in the 201 answer and in the WhatsApp message and never again (a later read of the car's sale answers the expiry, not the link).

_From 415-car-transfer-link._

### 1379-FR-003 — Each caller MUST keep its response contract exactly, treating a job result that is a failure kind, a job that failed, a wait that hit the cap, and a queue that could not be reached or written as the same failure: the sign-in code answers 502 `whatsapp_failed`, stores no code and leaves the number's hourly share uncounted (393-FR-004, 393-FR-005); the phone change answers 503 `send_failed` with nothing kept (139-FR-011); the staff invite answers `emailSent: false` with the link, the invite staying `sent` (131-FR-004, 1255-FR-005); the car transfer answers `whatsapp: 'failed'` with the link, the transfer staying `sent` (415-FR-006). The success answers are unchanged.

_From 1379-provider-calls-worker._

### 415-FR-007 — `POST /api/v1/cars/:id/transfers/:transferId/cancel` (capability `driver.cars`; 404 for another account's car, a transfer of another car or an unknown transfer) MUST set a `sent` transfer `cancelled` in one transaction with its audit entry and the outbox event `car_transfer.cancelled`, answering 204; a transfer not `sent` answers 409 `not_sent`.

_From 415-car-transfer-link._

### 1265-FR-003 — `GET /api/v1/car-transfers/:token` MUST stay public (415-FR-008's 404 and 410 answers and its signed-out 200 `{ status: 'sent' }` unchanged) and gain an optional actor: with a session that resolves to an account other than the seller, the 200 answer MUST add the car (`brand`, `model`, `year`), `repairCount` (the car's active MotorFix repairs plus the transfer's ticked repairs still active) and `sellerName` (the seller's short name: the first word of the account's name and the initial of its last word with a dot when the name has two or more words, the one word as it is, `null` for an empty name); with a session that resolves to the seller it MUST answer 403 `own_transfer` (after the gone states: a cancelled own link still answers 410). It MUST never carry the buyer's phone, the plate, the seller's phone, the seller's account id or the token. An `accepted` transfer keeps answering 410 `transfer_accepted`.

_From 1265-car-transfer-accept._

### 415-FR-009 — A car MUST have at most one `sent` transfer at a time: sending a new one cancels the earlier `sent` transfer of that car in the same transaction (its own audit entry and `car_transfer.cancelled` event), and a cancellation by the seller (FR-007) does the same; the cancelled link answers 410 `transfer_cancelled`.

_From 415-car-transfer-link._

### 415-FR-010 — The worker MUST, through the existing daily mechanism (bucharestDaily), set every `sent` transfer whose expiry has passed to `expired`, each in its own transaction with its audit entry (actor `system`) and the outbox event `car_transfer.expired`; a transfer is within its time only while its expiry is later than now (at the expiry instant it is expired), and one past its time but not yet swept is treated as expired by every read (FR-008, FR-003's `sent` transfer is answered only while within its time).

_From 415-car-transfer-link._

### 415-FR-011 — The events `car_transfer.sent`, `car_transfer.cancelled` and `car_transfer.expired` (added to the contracts' event kinds) MUST carry `{ transferId, carId, sellerAccountId, status }` and nothing more (no phone, no token, no plate), and MUST reach `account:{sellerAccountId}` alone through the live audience resolver, so the seller's open Mașinile mele re-reads without a reload.

_From 415-car-transfer-link._

### 415-FR-012 — Removing a car (092-FR-003) MUST, in its transaction, cancel the car's `sent` transfer (as FR-009, actor the driver), so a sold-then-removed car's link answers 410 `transfer_cancelled`.

_From 415-car-transfer-link._

### 415-FR-014 — Every transfer step MUST write one audit entry in the step's transaction through the audit writer (390-FR-001): the send a `create` on subject type `car_transfer` (subject the transfer id, scope the car id) whose new value holds the car id, the ticked repair ids and the expiry; a cancellation (by the seller, by a new send, or by the car's removal) and an expiry an `update` on field `status` with old `sent` and new `cancelled` or `expired`, actor the driver or `system`. No entry holds the buyer's phone or the token.

_From 415-car-transfer-link._

### 415-FR-020 — Observability: the new endpoints join the API's endpoint inventory with their panels and alerts (`infra/observability/inventory.json`, `scripts/observability-inventory.ts`); the WhatsApp send is counted by outcome (`sent`, `failed` by kind) and the sweep logs the number of transfers it expired.

_From 415-car-transfer-link._

### 415-FR-021 — Tests MUST cover: the send creating the transfer, the ticked rows, the audit entry and the event in one transaction (a failing audit write rolls everything back); the phone normalised from the three writings, an invalid phone and the own phone refused; a tick on a MotorFix, deleted, foreign or unknown repair refused; `open_request` in each of the four states and allowed in `done` and `closed`; the second send cancelling the first; the cancel endpoint and its 409 and 404s; the link answering 200, 404, 410 for cancelled, expired-by-sweep, expired-by-time and accepted; the sweep expiring only past-due `sent` transfers; the removal cancelling the transfer; the WhatsApp failure leaving the transfer `sent` with `whatsapp: 'failed'`; the events' payload and audience; no phone or token in any log, event or audit value (Jest on real PostgreSQL where the repository is used); the menu item, the three dialog steps, the empty state, the refusal, the done states, the copy button, the transfer line and its cancel, and the public page's five states in both languages (Jest); end to end (Playwright): a driver sells a car, ticks one repair, sends, copies the link, opens it and sees the valid line; cancels and sees "Linkul nu mai e valabil".

_From 415-car-transfer-link._

### 415-FR-022 — The cars list answer (`GET /api/v1/cars`, 089) MUST carry, per car, `transfer: { id, expiresAt } | null`: the car's `sent` transfer while within its time, otherwise null; the card reads it (FR-015) with no per-car request.

_From 415-car-transfer-link._

### 1265-FR-001 — The system MUST hold a CAR_OWNERSHIP record per period an account held a car: the car, the account, the access (`owner` | `former_owner_read_only`), `from_date` and `to_date` (Europe/Bucharest calendar days; `to_date` empty while open), the transfer that opened it (empty for the car's original owner), and the exact instants it opened and closed (the visibility rule of FR-010 reads them). Every car MUST have exactly one open `owner` row at any time; the migration MUST open one per existing car, removed cars included, with `from_date` the Bucharest day of the car's creation and the opening instant its creation time.

_From 1265-car-transfer-accept._

### 1265-FR-004 — `POST /api/v1/car-transfers/:token/accept` MUST take any signed-in account (no capability: a garage-only account may accept, FR-006) and, in one transaction that locks the seller's and the buyer's account rows `FOR UPDATE` in ascending id order (the buyer's is the 20-car count's lock, 089-FR-004; the seller's is the lock a quote request's creation takes, so a request sent in the same instant as the acceptance and the acceptance cannot both succeed), then the car row, then the transfer row, re-reading its status under the lock (the order the send and the cancel already take, so none of them can deadlock with the acceptance): answer 404 `not_found` for no transfer, 410 `transfer_cancelled` | `transfer_expired` | `transfer_accepted` by 415-FR-008's rule (the time decides an expiry; a removed car's transfer is cancelled), 403 `own_transfer` when the buyer is the seller, 409 `car_limit` when the buyer holds 20 cars not removed, 409 `open_request` when the car has a quote request in `sent`, `quoted`, `booked` or `in_work` (the refusals are tested in exactly this order, the first that holds is the one answered: 404, 410, 403, `car_limit`, `open_request`); then: set the car's owner to the buyer and clear its add-car idempotency key (the seller's spent dedupe key; kept it could collide with the buyer's `(owner, key)` unique pair); close the seller's open ownership row (`to_date` = the sale date, access `former_owner_read_only`, closing instant now); open the buyer's (`owner`, `from_date` = the sale date, this transfer as origin); set the transfer `accepted` with the buyer and the sale date (the Bucharest day of now); clear the car's plate, RCA date and rovinietă date; move the reminders (FR-005); grant the role when due (FR-006); write the audit entries (FR-007), the event (FR-008) and the notification (FR-009); and answer 200 `{ carId }`. The acceptance emits no `car.updated`: FR-005 does the reminder work in the transaction, and `car_transfer.accepted` is the change's one event. A second accept of the same token, in a race or after, answers 410 `transfer_accepted` and changes nothing.

_From 1265-car-transfer-accept._

### 1265-FR-005 — In the acceptance's transaction the car's reminder rows MUST move to the buyer's account, keeping their kinds, due dates, stages and ids (a stage already sent is not sent again), except the `rca` and `rovinieta` rows, which are deleted with their dates; the ITP, service and tyre reminders then reach the buyer from the next daily run. The buyer sets new RCA and rovinietă dates through the edit dialog as for any car, which creates their reminders as today.

_From 1265-car-transfer-accept._

### 1265-FR-006 — A buyer whose account lacks the `driver` role MUST be granted it in the acceptance's transaction with the role's audit entry (as adding a car grants it, 089-FR-012); an account that holds it, whatever role it acts in, gets no grant and no entry.

_From 1265-car-transfer-accept._

### 1265-FR-007 — The acceptance MUST write, in its transaction, through the audit writer (390-FR-001): one `update` on subject `car_transfer` (field `status`, old `sent`, new `accepted`, scope the car, actor the buyer in the role in use); on subject `car`, actor the buyer in the role in use (the role grant's own entry records `driver`, FR-006), one `update` per field changed by the acceptance as 092-FR-004 writes an edit's (owner with the seller's and the buyer's account ids; RCA and rovinietă dates with old value and `null`; the plate's entry with both values `null`). No entry holds the phone or the token.

_From 1265-car-transfer-accept._

### 1265-FR-008 — The event `car_transfer.accepted` (already a contracts event kind) MUST carry `{ transferId, carId, sellerAccountId, buyerAccountId, status: 'accepted' }` and nothing more, and reach both `account:{sellerAccountId}` and `account:{buyerAccountId}` through the live audience resolver, so the seller's Mașinile mele and the buyer's open screens re-read without a reload.

_From 1265-car-transfer-accept._

### 1265-FR-009 — The acceptance MUST bring CAR_TRANSFER_ACCEPTED to the seller as every `event` kind goes: the outbox event `car_transfer.accepted` written in the acceptance's transaction (FR-008) is fanned out by the worker to the notification (the catalogue entry as listed: event; e-mail, push or WhatsApp; muted by the seller's "Recenzii și istoric" switch, the bell row still written), in the seller's interface language, naming the car's brand and model and saying its history stays with them read-only up to the sale date; never the buyer's phone or name.

_From 1265-car-transfer-accept._

### 1265-FR-010 — One visibility rule MUST decide which repairs of a car an ownership row may read, used by every read of this story and by ST-415's sale read: every MotorFix repair of the car whatever its date; a logged repair when it was created during that ownership (at or after its opening instant and, for a closed row, before its closing instant) or is a ticked repair of the transfer that opened the ownership; never a soft-deleted repair; for a `former_owner_read_only` row both cuts apply to every source: only repairs done on or before its `to_date` and created before its closing instant (nothing recorded after the sale reaches the former owner). A repair is `fromPreviousOwner` for a row when it was created before the row's opening instant.

_From 1265-car-transfer-accept._

### 061-FR-007 — Every row of the three history reads (`GET /api/v1/repairs`, `/cars/:id/repairs`, `/cars/sold/:id/repairs`) MUST carry, beside `id`, `doneOn`, `what`, `garageName`, `source`, `fromPreviousOwner`, `odometerKm`, `costBani` and `correctedBy` (1265-FR-011, 409-FR-015): `car` (`id`, `brandName`, `model`, `year`), `mechanicName` (for a MotorFix repair the job's mechanic's `MECHANIC.name`, hidden from the profile or not; null for a logged repair, a job with no mechanic or a deleted mechanic row) and `review`: null for every row, MotorFix or logged, until ST-26 (#91) adds the state, per the owner's resolution of 2026-10-15 on #102; the field stays nullable in the contract so ST-26 can fill it.

_From 061-repair-list._

### 1265-FR-014 — After the acceptance, the seller MUST get 404 from every car route taking the car's id (`GET /api/v1/cars/:id`, the edit, the removal, the sale, the transfer cancel), and the car MUST be absent from the seller's `GET /api/v1/cars` and present in the buyer's with `plate`, `rcaUntil` and `rovinietaUntil` `null` (the existing owner check does this: the owner changed); both accounts' warm car lists (`driver-home`, 1169-FR-003) MUST be dropped in the acceptance's request.

_From 1265-car-transfer-accept._

### 1265-FR-015 — Observability: the four new routes (the accept, the owner's repairs, the sold list, the sold car's repairs) join the API's endpoint inventory with their panels and alerts (`infra/observability/inventory.json`, `scripts/observability-inventory.ts`); the acceptance is counted by outcome (`accepted`, and each refusal code), beside ST-415's send counter.

_From 1265-car-transfer-accept._

### 1265-FR-016 — Tests MUST cover, in Jest on real PostgreSQL and Valkey (`*.integration.spec.ts` where the repository is used), each file naming its ids in one whole-line `// @traces` comment: the migration's backfill (one open row per car, removed included) and the add-car row; the read signed out, as another account, as the seller, for each gone state and with a deleted ticked repair in the count; the short name from an empty, one-word, two-word and three-word name; the acceptance's every write in one transaction, rolled back together when the audit or the event write fails; the owner's, the buyer's and the car's rows before and after; the cleared fields and the kept ITP date, kilometres and next service; the reminders moved with their stages and the two dropped; the role granted once to a garage-only account and never to a driver; 404, each 410, `own_transfer`, `car_limit` at 20 and allowed at 19 with a removed car, `open_request` in each of the four states and allowed in `done` and `closed`; two concurrent accepts: one 200, one 410; the event's payload and both channels; the notification's type, recipient, language and muting; no phone, token or plate in any log, event, audit value or answer; the owner's repairs with the flag, the unticked repair absent, a later repair unflagged, the deleted one absent; the sold list and the sold car's repairs cut at the sale date and at the closing instant, 404 to the buyer and for a car never sold; the sale read and the tick narrowed to the seller's visible repairs (a second sale); the seller's 404s and the buyer's list after the acceptance; the warm lists dropped; the public-routes list unchanged (the token route stays public; the accept route needs a session).

_From 1265-car-transfer-accept._

### 1386-FR-002 — The dialog MUST refuse, on leaving the field or on save and before anything is sent, a next-service value not greater than the kilometres in the same form with "Valoarea trebuie să fie mai mare decât kilometrajul actual (<km> km)." / "The value must be greater than the current odometer (<km> km)." (the form's kilometres in the person's number format), and one more than 100,000 km above them with "Valoarea poate fi cu cel mult 100.000 km peste kilometrajul actual." / "The value can be at most 100,000 km above the current odometer."; the check runs only when the driver changed the field, that is when its parsed number differs from the car's stored value (null on add) — so on edit a value equal to the stored one, in any writing, is not rechecked, and a raised odometer past a kept value saves. The refusal comes before the existing "kilometres lower" confirmation, which is asked only of a valid form. The API's 400 codes `next_service_not_above_odometer` and `next_service_too_far` MUST show the same two sentences on the field, the dialog staying open with its values (159-FR-002's rule).

_From 1386-oil-service-lamp._

### 1386-FR-005 — After a save from the add or the edit dialog, Mașinile mele's card and Panou's panel MUST show the new "<year> · <km>" line, the distance left and the lamp from the saved car answer at once, without a reload and without reading the list again (092-FR-010's rule, extended to the next-service value and the estimate); a car added from Panou shows its oil line there at once.

_From 1386-oil-service-lamp._

### 1386-FR-006 — Every text this story shows (the field's label, the two refusal sentences, the four line sentences) MUST exist in the driver area's Romanian and English files, never inline in a template; kilometres MUST use the person's number format (locale-formats 019-FR-004); no new metric, panel or alert: the change rides the existing cars endpoints, and the PR's Observability section says so.

_From 1386-oil-service-lamp._

### 1386-FR-007 — Tests MUST cover, with a `// @traces` line per spec file: the grey, green, amber and red lines in both languages; the 60/61 and 7/8 day boundaries of `serviceDueOn` with a fixed clock in Europe/Bucharest; 0 and −200 km with a null date; the fallback for an answer without the field; the field refused at, below and more than 100,000 km above the form's kilometres, with the sentence quoting the form's kilometres; an unchanged stored value not rechecked and not sent; a blank cleared on edit and absent on add; the API's two codes shown as the sentences; the grey line opening the dialog focused on the field; Panou showing no oil line for a car without a value; the card updated at once after a save (Jest). Playwright, end to end: sign in, add a car, set the next service, see the green line with the distance left, raise the odometer and see it amber.

_From 1386-oil-service-lamp._

### 1386-FR-008 — The next-service field MUST be reachable and operable by keyboard in the dialog's tab order after Kilometri, with a visible label and a visible focus ring in light and dark; its refusal sentence MUST sit in the field's own error element, tied to the input (`aria-describedby`, `aria-invalid` while refused) and announced when it appears, and a save that fails the check MUST move the focus to the first refused field; the oil line's sentence is its accessible name, so the lamp's colour is never the only signal; the field, the dialog and the card lines MUST show no sideways scroll at 320 px (the dialog scrolls vertically), with text contrast kept at the existing lamp and helm tokens in light and dark (design.md, States).

_From 1386-oil-service-lamp._

### 409-FR-001 — The repair (`REPAIR` in the `cars` module) MUST gain, in one migration: `odometer_km` (whole kilometres, optional: a MotorFix repair without a reception reading has none), `cost_bani` (optional), `shared_with_garage` (default off), `shared_at` (optional, the time sharing was last turned on), `updated_at` (set on creation and on every change; the version, as 092-FR-002), `updated_by` (the account that last changed it, optional) and `updated_by_role` (`driver`, `owner` or `admin`, optional, set with `updated_by`). Existing rows get `updated_at` = `created_at`. The driver's log, share, unshare and edit operations (ST-62, ST-63, ST-64) are not this story's.

_From 409-garage-corrects-repair._

### 409-FR-002 — The system MUST add the capability `garage.client_repairs` to the garage capability table for the `garage` (owner) role only; the existing guard then answers 403 `forbidden` to a receptionist and a mechanic of the garage and 404 `not_found` to a driver and an admin (A31, `policy.ts` `requireCapability`) on every route that requires it, and 401 to a visitor without a session (`ActorGuard`, app-wide).

_From 409-garage-corrects-repair._

### 409-FR-003 — `GET /api/v1/garage/client-repairs` (capability `garage.client_repairs`) MUST answer the logged repairs (`source` `logged`) whose `garage_id` is the actor's garage, with `shared_with_garage` on and `deleted_at` empty, newest `done_on` first, ties newest `created_at` first, at most the 200 newest (unpaged: a garage's shared repairs are few; the answer carries `truncated` true when more exist, so the cap is never silent); it MUST answer 404 `not_found` when the actor's garage is not `approved` (suspended or draft alike; a suspended garage cannot correct, MF-26 edge case), through the status check the garage routes already use where one exists, never a second rule.

_From 409-garage-corrects-repair._

### 409-FR-004 — Each item MUST carry: `id`, `driver.shortName` (the first name and the initial of the family name, through the existing `shortName`; the deleted-author label when the car has no open owner), `car` (`brandName`, `model`, `year`), `what`, `doneOn`, `odometerKm` (or null), `costBani` (or null), `version` (`updated_at`) and `correctedAt` (the `updated_at` when `updated_by_role` is `owner`, else null); never the plate, the driver's full name, phone or e-mail.

_From 409-garage-corrects-repair._

### 409-FR-005 — `PATCH /api/v1/garage/client-repairs/:id` (capability `garage.client_repairs`) MUST correct the repair's `what`, `doneOn`, `odometerKm` and `costBani` (each optional in the body; a body with none changes nothing, FR-010, as the car edit; `costBani` may be `null` to clear it; `odometerKm` may not be null) and MUST carry the required `version` the caller loaded; a body with any other field (car, garage, source, sharing) is refused 400 by the edge validation; the answer is the corrected item as FR-004 shapes it.

_From 409-garage-corrects-repair._

### 409-FR-006 — The correction's limits MUST be: `what` 1 to 200 characters after trimming; `doneOn` a calendar date not after today in Europe/Bucharest; `odometerKm` a whole number from 0 to 2 000 000; `costBani` a whole number from 0 to 92 000 000 or null; each refused 400 with the field named.

_From 409-garage-corrects-repair._

### 409-FR-007 — The correction MUST answer 404 `not_found` and change nothing when the repair does not exist, is deleted, is not `logged`, names another garage or no garage, is not shared with the garage (`shared_with_garage` off — including a sharing stopped after the garage loaded it), or the actor's garage is not `approved`. A garage that reads the car's history through a booking's history tick (ST-416) gains nothing from it here: only the named garage with sharing on passes.

_From 409-garage-corrects-repair._

### 409-FR-008 — Refusals run in this order: 401, 403, edge validation 400 (FR-005, FR-006), 404 (FR-007), 409. The correction MUST answer 409 `stale_version` and change nothing when the body's `version` differs from the repair's `updated_at`, checked before any comparison of values (a stale version is 409 even when the body changes nothing); the check and the write run in one transaction so two concurrent saves with the same version let exactly one through.

_From 409-garage-corrects-repair._

### 409-FR-009 — `DELETE /api/v1/garage/client-repairs/:id` (capability `garage.client_repairs`) MUST answer 403 `forbidden` and change nothing: the named garage never deletes a logged repair (MF-26 rule 8).

_From 409-garage-corrects-repair._

### 409-FR-010 — A correction that changes no value MUST answer 200 with the unchanged item and write no audit entry, event or notification; `updated_at`, `updated_by` and `updated_by_role` MUST change only when a value changes, and then to the time of the write, the actor and `owner`.

_From 409-garage-corrects-repair._

### 1267-FR-006 — The admin's correction MUST run through the same use case as the garage's (409-FR-011: no second use case), generalised by the scope of repairs it may reach: the garage's scope stays as it is (shared, named garage approved, 409-FR-007); the admin's scope is every logged repair not deleted, whatever its sharing, its garage or that garage's status. The row lock, the version check before the values, the unchanged save (409-FR-010), the one transaction and the refusal order (401, 404 for a non-admin, edge validation 400, 404 for the repair, 409 `stale_version`) are the same code; `updated_by` is the admin and `updated_by_role` `admin`.

_From 1267-admin-corrects-repair._

### 409-FR-012 — In the same transaction, the system MUST hand to the event port `repair.updated` with: the repair id, the car id, the car's current owner's account id (the open ownership row's account when it is not deleted, or none), the garage id, the changed field names and `by` = `owner`; audience the car owner's `account` channel and the garage's `garage` channel (MF-26 live updates), so open history and client-repairs screens re-read.

_From 409-garage-corrects-repair._

### 1267-FR-010 — The correction counter `motorfix_repair_corrections_total` (409-FR-016) MUST count the admin's corrections with `by` `admin` and the same outcomes (`corrected`, `unchanged`, `stale`, `not_found`); the one log line per correction MUST say an admin made it, naming the repair and the changed fields (no values).

_From 1267-admin-corrects-repair._

### 409-FR-017 — Tests MUST cover, in Jest on real PostgreSQL and Redis: the list's membership (the six seeds of User Story 2), order and shape; each field corrected alone and together, the amount cleared, the unchanged save; every 400 limit; 403 for a receptionist and a mechanic, 404 for a driver and an admin; every 404 of FR-007; 409 and the concurrent-save race; the delete's 403; the audit entries' values and role; the event's payload and audience and the rollback on failure; REPAIR_UPDATED with the switch on and off, to the current owner after a sale, none when the car has no owner, and once on a redelivered event; the driver's reads with `correctedBy`; the capability table (the owner alone); the migration's backfill (`updated_at` = `created_at`, sharing off); the list's cap and `truncated`. Each test file carries a `// @traces` line naming its `409-FR-<n>` ids.

_From 409-garage-corrects-repair._

### 061-FR-001 — The `cars` module MUST consume `job.handed_over` and `job.final_price_corrected` as the worker's other event consumers do (one queue, `repair-from-job`, fed by the outbox relay, each run retried on failure with the same backoff as `final-price-corrected`, no requeue), and nothing on `job.done`, a cancellation, a lapse or a no-show. The handler is in the `cars` module, not in `workshop`.

_From 061-repair-list._

### 061-FR-002 — Each run MUST bring the job's repair row in step with the job in one use case: when no row holds the job's id, it creates a REPAIR with `source` `motorfix`, `car_id` the booking's car, `job_id` the job, `garage_id` the job's garage and `garage_name` a copy of its name, `what` the names of the included jobs of the booking's accepted quote (`QUOTE_JOB.included`) joined with ", " in Romanian, `done_on` the day of `JOB.finished_at` in Europe/Bucharest, `odometer_km` `JOB.odometer_km` (none when none), `cost_bani` `JOB.final_price_bani`. The row's insertion is idempotent on the unique `job_id` (a second run, a second relay or a concurrent run leaves one row and one audit entry).

_From 061-repair-list._

### 061-FR-003 — When a row holds the job's id and its `cost_bani` differs from `JOB.final_price_bani`, the same use case MUST set `cost_bani` to the job's; when they are equal it MUST change nothing and write nothing. A missing job ends the run with a log line and no retry.

_From 061-repair-list._

### 061-FR-004 — The creation and each cost change MUST run in their own transaction with their audit entries through the audit writer (390-FR-001): a `create` on subject type `repair` (the repair id; scope the car id and the garage id) whose new value holds the stored fields, and an `update` on field `cost_bani` with the old and new amounts; actor `system`, the job named on the entry. A failing audit write rolls the row back. The same transaction MUST record `repair.updated` (payload `by` `system`, `carId`, `changed`, `garageId`, `ownerId`, `repairId`; audience the car's owner) so the driver's screen re-reads once the row is written; the repair-updated fan-out MUST tell nobody for `by` `system`, as for `driver`.

_From 061-repair-list._

### 061-FR-005 — `GET /api/v1/repairs` (capability `driver.cars`) MUST answer the repairs of every car the caller owns through an open ownership row whose car is not removed, each row's repairs as the visibility rule decides (1265-FR-010; a soft-deleted repair never), mixed across cars, ordered by `done_on` newest first, ties by `created_at` newest first, ties by id descending; paged by a cursor (`cursor` in, `nextCursor` out, null on the last page; a cursor that is not a row of this list for the caller, malformed or unknown, answers 400 `invalid_cursor`; no cars or no repairs answer `items` empty and `nextCursor` null) with `limit` 1 to 20, default 20 (else 400 `validation_failed`).

_From 061-repair-list._

### 061-FR-006 — `GET /api/v1/repairs` MUST take an optional `carId`: a car the caller owns through an open row narrows the list to it; any other id (another driver's car, a removed car, a sold car, an unknown id) answers 404 `not_found` with one body for every case. `GET /api/v1/cars/:id/repairs` and `/cars/sold/:id/repairs` keep their 404s (1265-FR-011, FR-012).

_From 061-repair-list._

### 061-FR-008 — A MotorFix row's `what` MUST be answered in the reader's language (the interface language the request carries, as the quotes reads do) from the job's included quoted jobs' names, falling back to the stored `what` when the job or its quoted jobs are gone; a logged row's `what` is as stored.

_From 061-repair-list._

### 061-FR-009 — The reads MUST never carry the plate, the driver's or the mechanic's account, phone or e-mail, the garage's internal ids beyond `garageId`, nor any `removed` or `deleted_by_author` review's text or rating; the sold car's read keeps its cut at the sale date (1265-FR-012) and answers `review` null, as every row (FR-007).

_From 061-repair-list._

### 061-FR-010 — `PATCH /api/v1/repairs/:id` and `DELETE /api/v1/repairs/:id` (capability `driver.cars`) MUST answer 404 `not_found` when the repair is not among the repairs the caller may read through an open ownership row (another driver's, deleted, of a removed or sold car, unknown), and 409 `motorfix_repair` with the message "Reparația vine dintr-o lucrare MotorFix" (Romanian only, as every refusal in the repo; the English "This repair comes from a MotorFix job" is the client's text) for a `motorfix` row, in that order after 401; a path id that is not a uuid answers 400 `validation_failed`, as on every route, and a well-formed id the caller cannot use answers 404; each changes nothing and writes no audit entry.

_From 061-repair-list._

### 061-FR-011 — For a `logged` row the two routes MUST answer 501 `not_implemented` (message "Editarea reparațiilor adăugate vine cu o versiune următoare", Romanian only; the client's English is "Editing added repairs comes with a later release") and change nothing; ST-64 replaces this answer with the edit and the soft delete. The `PATCH` reads no body field. A body that is not valid JSON answers 400 from the body parser before the route runs, as on every route.

_From 061-repair-list._

### 061-FR-012 — Observability: the three routes MUST be listed in `infra/observability/inventory.json` with the cars module's existing metrics, logs and traces; the queue `repair-from-job` with its counter `motorfix_repairs_from_jobs_total` by `outcome` (`created`, `cost_updated`, `unchanged`, `job_missing`), one log line per run naming the job, the repair and the outcome (no amounts), the worker queue alerts, a panel on the cars dashboard, and a counter `motorfix_repair_edit_refusals_total` by `code` (`motorfix_repair`, `not_implemented`); no alert of its own (a lost run is retried by the queue, whose alerts cover a stuck queue; the API error-rate alert covers the reads).

_From 061-repair-list._

### 061-FR-013 — Tests MUST be written first and cover, in Jest on real PostgreSQL and Valkey (`*.integration.spec.ts` where the repository is used), each file naming its ids in one whole-line `// @traces` comment: the row created from `job.handed_over` with every field, once only over two runs and two concurrent runs, none from `job.done`, a cancelled, a lapsed or a no-show booking; `done_on` across the Bucharest midnight; no reading at reception; the cost from the handover and its correction, an equal correction writing nothing, a correction before the row; the missing job; the audit entries and the rollback on a failing audit write; the list's order across two cars, the tie, the cursor pages and `limit`, the removed car, the previous owner's repairs, `carId` of own, other, removed and sold cars; the row's car, mechanic (named, the owner's row, hidden, deleted), `what` in both languages and the fallback, `correctedBy`; every `review` state at days 10, 60 and 61 and for `published`, `reported`, `removed` and `deleted_by_author`; the same shape on `/cars/:id/repairs` and the sold read; 401, 404, 409 and 501 on `PATCH` and `DELETE` with nothing changed; no personal data in any answer or log; the generated client regenerated from `apps/api/openapi.json`; one `repair.updated` with `by` `system` per creation and per cost change, none for an unchanged run, and the repair-updated fan-out telling nobody for it.

_From 061-repair-list._

### 1400-FR-001 — (409-FR-018) The garage dashboard MUST gain the view "Reparații adăugate de clienți" / "Repairs added by clients", a garage view behind the capability `garage.client_repairs` (the owner alone; hidden for a draft garage as the view registry already decides, no new status rule), reached from the garage navigation, with a title, a subtitle and the texts of a garage view in both languages; it MUST read the owner's shared logged repairs through the generated client and show them in the order the API answers.

_From 1400-garage-corrects-repair-web._

### 1400-FR-002 — (409-FR-018) Each row MUST read "<driver short name> · <brand> <model> <year> · <what> · <date in the locale's day format> · <odometer, grouped> km · <amount> lei" with a Corectează / Correct action, "fără sumă" / "no amount" when there is no amount, a line "Corectată pe <date>" / "Corrected on <date>" when `correctedAt` is set, and the empty state "Niciun client nu a partajat încă o reparație cu tine" / "No client has shared a repair with you yet" when the list is empty; when the answer is truncated the view MUST say the newest 200 are shown; on a phone the what, the date and the action come first with the client, the car and the figures beneath.

_From 1400-garage-corrects-repair-web._

### 1400-FR-003 — (constraint, Principle I and the bundle budget) The view and its dialog MUST be loaded only when the view is opened, inside the garage area's lazily loaded code; nothing of this story joins the first-page bundle and its 1 MB budget is not raised.

_From 1400-garage-corrects-repair-web._

### 1400-FR-004 — (409-FR-019) Corectează MUST open a `dialog` task of the overlays service using the shared form-saving helper, titled "Corectează reparația" / "Correct the repair", with the car and the client shown read-only ("<brand> <model> <year> · client <short name>") and the fields what was done, date, odometer and amount prefilled from the row; the dialog and the view MUST offer no delete action.

_From 1400-garage-corrects-repair-web._

### 1400-FR-005 — (409-FR-019) Before sending, the dialog MUST refuse inline a date after today in Romania and the limits of the API (what 1 to 200 characters, odometer a whole number 0 to 2 000 000, amount 0 to 920 000 lei with at most two decimals, the amount optional and clearable), the limit named at the field; an odometer below the reading the dialog loaded MUST ask the owner to check once, the next Salvează sending it; the confirmation holds for the value confirmed only, and editing the odometer or a 409 reload clears it.

_From 1400-garage-corrects-repair-web._

### 1400-FR-006 — (409-FR-019) Salvează / Save MUST send only the fields whose value changed, compared after normalising to the request shape (trimmed what, ISO date, integer km, amount in bani), with the version the dialog loaded; a save with nothing changed MUST close the dialog and send nothing.

_From 1400-garage-corrects-repair-web._

### 1400-FR-007 — (409-FR-020) On 409 the dialog MUST say "Reparația a fost modificată între timp. Am reîncărcat valorile." / "The repair changed meanwhile. We reloaded the values.", re-read the owner's list, replace all four fields (the owner's unsent edits included) with the item's current values and version and stay open; when the re-read no longer holds the item, FR-008 applies.

_From 1400-garage-corrects-repair-web._

### 1400-FR-008 — (409-FR-020) On 404 the dialog MUST close, the row MUST leave the list and the view MUST show "Clientul nu mai partajează această reparație" / "The client no longer shares this repair" in the dashboard's transient notice; on a 400 naming a field of the form the dialog MUST show the problem at that field and stay open (a 400 naming no known field reads as the shared "could not save" problem); on any other failure it MUST show the shared "could not save" problem and stay open.

_From 1400-garage-corrects-repair-web._

### 1400-FR-009 — (409-FR-020) On success the dialog MUST close and the row MUST update in place from the answer, its "Corectată pe" line now set.

_From 1400-garage-corrects-repair-web._

### 1400-FR-010 — (409-FR-021, the garage half) The view MUST re-read on `repair.updated`, `repair.shared` and `repair.unshared` on the garage's live channel, and on the channel's reconnection as the other live views do; an open dialog is not closed by a re-read (its save answers 404 or 409 as the API decides).

_From 1400-garage-corrects-repair-web._

### 1400-FR-011 — (409-FR-023) Every text of the view, the navigation entry and the dialog MUST live in the garage and shell language files in Romanian and English; one Playwright flow MUST sign in as a garage owner with a seeded shared logged repair, open the view, correct the odometer, see the row update and "Corectată pe", then sign in as the driver and see the REPAIR_UPDATED bell row; the view and the dialog MUST pass the QA sweep at 320 px, 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll and no axe violation; the unit specs (Jest, colocated) MUST cover FR-002, FR-005 to FR-010 with the generated client stubbed.

_From 1400-garage-corrects-repair-web._

### 1267-FR-001 — `GET /api/v1/admin/accounts/:id/repairs` (capability `admin.users`, the account page's) MUST answer the logged repairs (`source` `logged`, `deleted_at` empty) of the cars the account currently owns (an ownership row with no end, the rule 1265-FR-010 reads ownership by), newest `done_on` first, ties newest `created_at` first, at most the 200 newest with `truncated` true when more exist (as 409-FR-003); it MUST answer 404 `not_found` for an account id that is unknown, malformed or of a deleted account, as the account page does, and 404 to every actor without the capability (401 to a visitor, `ActorGuard` app-wide). Sharing and the named garage's status are not read: the admin sees every logged repair.

_From 1267-admin-corrects-repair._

### 1267-FR-002 — Each list item MUST carry `id`, `doneOn` and `car` (`brandName`, `model`, `year`) and nothing more: not what was done, the odometer, the amount, the garage, the version or the plate (acceptance criterion 1: "only date and car").

_From 1267-admin-corrects-repair._

### 1267-FR-003 — `GET /api/v1/admin/repairs/:id` (capability `admin.users`) MUST answer the repair's content: `id`, `car` (`brandName`, `model`, `year`), `what`, `garageName`, `doneOn`, `odometerKm` (or null), `costBani` (or null), `version` (`updated_at`, sent back with a correction) and `correctedBy` (`garage`, `admin` or null, as 409-FR-015 tells it); it MUST answer 404 `not_found` when the repair does not exist, the id is malformed, the repair is deleted or is not `logged`; never the plate, the driver's full name, phone or e-mail.

_From 1267-admin-corrects-repair._

### 1267-FR-004 — In the same transaction as the read of FR-003 (a failed write answers no content: both commit or neither), the system MUST write one audit entry through the audit writer (390-FR-001): action `open`, subject `repair`, actor the admin's account with role `admin`, the car's id and, when the repair is shared with the garage on MotorFix it names, the garage's id on the entry (an unshared repair's entries carry no garage id), no field and no values; one entry per read, a re-read included; a refused read (404) writes none; the list (FR-001) writes none.

_From 1267-admin-corrects-repair._

### 1267-FR-005 — `PATCH /api/v1/admin/repairs/:id` (capability `admin.users`) MUST correct the repair's `what`, `doneOn`, `odometerKm` and `costBani` with the same body as the garage's correction (`CorrectClientRepairDto`: each field optional, `costBani` nullable, the required `version`, any other field refused 400, the limits of 409-FR-006), and answer the item as FR-003 shapes it (the use case returns the saved row, each route maps it, so no driver block reaches the admin); the car, the named garage and the source are never changed.

_From 1267-admin-corrects-repair._

### 1267-FR-007 — The audit entries of the admin's correction MUST be the garage's (409-FR-011) with actor the admin's account and role `admin`: one `update` entry per changed field, subject `repair`, old and new values as stored, the car's id and, when the repair is shared with the garage on MotorFix it names, the garage's id on the entry (an unshared repair's entries carry no garage id).

_From 1267-admin-corrects-repair._

### 1267-FR-008 — The event MUST be the garage's `repair.updated` (409-FR-012) with `by` `admin`, the garage id when the repair names a garage on MotorFix (else none) and the rest unchanged; its audience MUST be the car's current owner's `account` channel and, when the repair is shared with the garage it names, that garage's `garage` channel (so an open client-repairs screen re-reads), else the owner's channel alone.

_From 1267-admin-corrects-repair._

### 1267-FR-009 — The admin MUST answer 404 `not_found` and write nothing on a correction of a repair that does not exist, is deleted or is not `logged` (a MotorFix repair is corrected on the job, ST-406), and 409 `stale_version` and write nothing when the body's `version` differs from the repair's (409-FR-008's rule and race).

_From 1267-admin-corrects-repair._

### 1267-FR-011 — `DELETE /api/v1/admin/repairs/:id` (capability `admin.users`) MUST answer 403 `forbidden` with the message "Doar șoferul poate șterge reparația" and change nothing, whether or not the repair exists (the refusal reads nothing, so an unknown, malformed or deleted id answers 403 too): an admin never deletes a logged repair (MF-26 rule 8); the garage's delete (409-FR-009) keeps its own message.

_From 1267-admin-corrects-repair._

### 1267-FR-013 — The four routes MUST be listed in `infra/observability/inventory.json` (story ST-1267) with the API's existing metrics, logs and traces and the counter of FR-010; the open read's record is its audit entry, so it adds no counter; no alert of its own (an admin's correction is rare and user-driven; the API error-rate alert covers failures), stated as the reason.

_From 1267-admin-corrects-repair._

### 1267-FR-014 — Tests MUST cover, in Jest on real PostgreSQL and Redis (`*.integration.spec.ts` where the repository is used), each file naming its ids in one whole-line `// @traces` comment: the list's membership (shared, not shared, deleted, MotorFix-sourced, a garage not on MotorFix, a car sold away and one bought), order, the item's three fields and nothing more, the cap and `truncated`, 404 for an unknown, malformed and deleted account; the open read's content and its `open` entry once per read, none on a 404, none from the list, and no content answered when the entry's write fails (rollback); each field corrected alone and together, the amount cleared, the unchanged save; every 400 limit; 404 for each non-admin role on each of the four routes, a non-admin's invalid body included (404 before 400), 401 for a visitor; the 404s of FR-009; 409 and the concurrent-save race; the delete's 403 and message; the audit entries' values, role `admin` and scopes; the event's payload, `by`, audience with and without sharing, and the rollback on failure; REPAIR_UPDATED naming MotorFix in both languages with the switch on and off, to the current owner after a sale, none when the car has no owner, once on a redelivered event; the garage's own list, correction and message unchanged (the scope generalisation changes nothing for the owner); the public-routes list unchanged (every route needs a session).

_From 1267-admin-corrects-repair._

### 293-FR-001 — The system MUST store a dismissed save suggestion as SAVE_SUGGESTION_DISMISSAL in the `cars` module beside SAVED_GARAGE: `account_id` (the driver's account), `garage_id`, `dismissed_at` (UTC, the first dismissal's time). The pair (account, garage) is the primary key; a row is deleted with its account or its garage (cascade); rows are never updated or removed otherwise. The table ships with its migration in the module's schema.

_From 293-save-garage-suggest._

### 293-FR-002 — `POST /api/v1/me/save-suggestions/:garageId/dismiss` MUST record the dismissal for the actor's own account and answer 204 with no body, whether a row was created or one already existed (the first `dismissed_at` is kept). It MUST answer 404 `not_found` and store nothing when the actor has no job at that garage whose status is `done` — a job of a booking of one of the actor's quote requests at that garage, handed over or not — or when the garage id names no garage. Access is ST-290's (290-FR-006): an account whose role in use is not `driver` 403 `driver_role_required`, then the capability `driver.saved_garages` (a missing capability is the policy's own 403 refusal, as on the save route); a visitor 401 `sign_in_required`; a `:garageId` that is not a valid id 400 `validation_failed`; when two faults coincide the order is 401, then 403, then 400. The route is under `/me` and takes no account id, so another person's dismissal cannot be asked for.

_From 293-save-garage-suggest._

### 293-FR-004 — A dismissal MUST write no audit entry, emit no event and send no notification, push or e-mail: it is a display preference (the brief). The suggestion itself writes nothing. The save, when the driver takes it, is ST-290's with its audit entry and `saved_garage.added` event, unchanged.

_From 293-save-garage-suggest._

### 293-FR-006 — The dismiss route MUST be listed with its logs, metrics, dashboard panel and alert (or why not) in `infra/observability/inventory.json` in the same PR, as 290-FR-016 lists the saved-garage routes; the active request read gains a field, not a new endpoint.

_From 293-save-garage-suggest._

### 293-FR-007 — Tests MUST be written first (Principle II) and cover, in Jest on real PostgreSQL and Valkey, each file naming its ids in one whole-line `// @traces` comment: the read's `saveSuggestion` with a `done` job at an approved garage neither saved nor dismissed (set, with the garage's id and name); null for a job `to_do`, `in_work` and `paused`, for a saved garage, for a dismissed garage, for a garage `suspended` before or after the job became `done`, and for a request with no live booking; the dismissal of garage A not hiding the suggestion of garage B (per garage); the dismiss route's 204 and row on the first call, 204 and the kept time on the second, 404 for a garage with no `done` job of the actor (a job `in_work` there, another driver's `done` job there, an unknown id), 403 without the driver role, 401 for a visitor, 400 for a malformed id; no audit entry and no event after a dismissal; the cascade when the account row or the garage row is deleted. In Jest without a database: the OpenAPI document lists the route and the field. The web tests and the Playwright flow are title 2's (FR-014).

_From 293-save-garage-suggest._

## Retired

- `089-FR-008` — superseded by `090-FR-006` (2026-10-08)
- `090-FR-006` — superseded by `092-FR-009` (2026-10-11)
- `089-FR-002` — superseded by `029-FR-006` (2026-10-17)
- `092-FR-009` — superseded by `029-FR-007` (2026-10-17)
- `092-FR-008` — superseded by `094-FR-003` (2026-10-25)
- `089-FR-003` — superseded by `094-FR-008` (2026-10-25)
- `029-FR-006` — superseded by `091-FR-003` (2026-10-26)
- `092-FR-001` — superseded by `091-FR-003` (2026-10-26)
- `089-FR-001` — superseded by `091-FR-003` (2026-10-26)
- `092-FR-006` — superseded by `091-FR-010` (2026-10-26)
- `091-FR-002` — superseded by `276-FR-008` (2026-10-26)
- `089-FR-007` — superseded by `1265-FR-002` (2026-10-29)
- `415-FR-008` — superseded by `1265-FR-003` (2026-10-29)
- `092-FR-012` — superseded by `1265-FR-012` (2026-10-29)
- `415-FR-003` — superseded by `1265-FR-013` (2026-10-29)
- `415-FR-004` — superseded by `1265-FR-013` (2026-10-29)
- `089-FR-009` — superseded by `1386-FR-001` (2026-10-30)
- `092-FR-010` — superseded by `1386-FR-001` (2026-10-30)
- `029-FR-003` — superseded by `1386-FR-003` (2026-10-30)
- `029-FR-007` — superseded by `1386-FR-004` (2026-10-30)
- `092-FR-009` — superseded by `1386-FR-004` (2026-10-30)
- `1265-FR-011` — superseded by `409-FR-015` (2026-10-30)
- `409-FR-015` — superseded by `061-FR-007` (2026-10-30)
- `409-FR-011` — superseded by `1267-FR-006` (2026-10-30)
- `409-FR-016` — superseded by `1267-FR-010` (2026-10-30)
- `415-FR-006` — superseded by `1379-FR-003` (2026-10-30)
