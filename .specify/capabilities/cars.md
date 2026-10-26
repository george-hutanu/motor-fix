---
capability: cars
updated: 2026-10-26
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

### 089-FR-007 — In the same transaction the system MUST write one audit entry "car added" (action `create`, subject `car`, the new values without the plate, which stays the owner's alone (FR-011), actor the account in its role in use) through the audit writer (390-FR-001), and hand `car.added` (car id, owner id, the saved fields) to the event port; the reminders this event feeds are a later story's.

_From 089-add-a-car._

### 089-FR-009 — The dialog MUST be a `dialog` task of the overlays service (158-FR-010) using the shared form-saving helper (159-FR-001..004), titled "Adaugă o mașină" / "Add a car", with the lead line of scenario 1, the fields Marcă (a search field over the brand catalogue, `GET /api/v1/brands`, case- and accent-insensitive, popular first; one brand chosen from the offered list), Model, An, Kilometri, Combustibil (Benzină, Motorină, Hibrid, Electric / Petrol, Diesel, Hybrid, Electric), a section "Opțional" / "Optional" with Număr de înmatriculare, Motor, ITP valabil până la, RCA valabilă până la, Rovinietă valabilă până la (date fields), and one main button "Adaugă mașina" / "Add the car". The year field's message, the plate warnings (pattern; same plate already held, from the loaded car list) and the brand-load failure with "Reîncearcă" / "Try again" are shown as the scenarios say. On success the task closes with the car and the view shows it at once without re-reading the list; the first field gets the focus on a computer (157-FR-007). The brand list is operable by keyboard (arrow keys move, Enter picks, Escape closes it) and each field has a visible label and its message tied to it for screen readers (157-FR-007, the overlays' dialog rules).

_From 089-add-a-car._

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

### 029-FR-007 — The view Mașinile mele's card MUST show the oil-service line (FR-003) after the rovinietă line when the car has a next-service km, and no line otherwise.

_From 029-overview-panels-own-data._

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

### 092-FR-009 — Mașinile mele's car card MUST show the brand and model, "<year> · <km> km", the plate grouped as today when the car has one, then the ITP due-date line (090-FR-001..005), then the RCA and rovinietă lines below; a car added or edited from its dialog shows its lines at once (supersedes 090-FR-006). The card MUST carry a "⋯" menu (accessible name "Acțiuni pentru <brand model>" / "Actions for <brand model>", operable by keyboard, a 44 px touch target) with "Modifică" / "Edit" and "Șterge mașina" / "Remove the car". The card MUST show, after the ITP line, an RCA due-date line and a rovinietă due-date line (the shared line of 090-FR-001 with their own texts, the lamp states of 090-FR-003): "RCA valabilă până în <month> <year>" / "RCA valid until <Month> <year>", "RCA-ul expiră în <n> <zile>" / "RCA expires in <n> days" (mâine/azi as the ITP), "RCA-ul a expirat pe <day>" / "RCA expired on <day>", and the same for "Rovinieta" ("Rovinieta e valabilă până în …", "Rovinieta expiră în …", "Rovinieta a expirat pe …" / "Rovinietă valid until …", "Rovinietă expires in …", "Rovinietă expired on …"); no garage link on these two. With no date the grey line reads "RCA: adaugă data" / "RCA: add the date" and "Rovinietă: adaugă data" / "Rovinietă: add the date"; the ITP's grey sentence stays 090-FR-004's. Each of the three grey lines is a button that opens the edit dialog with the focus on that date's field.

_From 092-edit-remove-car._

### 092-FR-010 — The edit dialog MUST be a `dialog` task of the overlays service using the shared form-saving helper (158-FR-010, 159-FR-001..004), titled "Modifică mașina" / "Edit the car", with the add dialog's fields, sections, limits, messages and brand search (089-FR-009), pre-filled with the car's values, and one main button "Salvează" / "Save". A kilometre reading below the saved one MUST ask scenario 4's question (the saved reading in the person's number format) with "Salvează" / "Save" and "Renunță" / "Cancel" before the request is sent. The button shows progress while saving; a server error keeps the values and shows the reason (159-FR-002). On success the task closes with the car and the view updates its card without re-reading the list.

_From 092-edit-remove-car._

### 092-FR-011 — The removal MUST be confirmed in a dialog with scenario 1's text (User Story 2) naming the car as "<brand> <model>", with "Șterge mașina" / "Remove the car" as the main button and "Renunță" / "Cancel"; a refusal (FR-003's `open_request`, or any other error) MUST show its reason inside that dialog, which stays open; on success the dialog closes and the card leaves the list at once.

_From 092-edit-remove-car._

### 092-FR-012 — A removed car's repairs and figures MUST stay stored and be hidden with the car: Istoric reparații and the spend figures (when they exist) read only cars not removed. Selling a car and passing its history on is out of scope (#287).

_From 092-edit-remove-car._

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
### 029-FR-003 — The oil-service line MUST use the shared lamp and sentence line. Distance left = next-service km − odometer km; estimated days = distance left ÷ (1,000 ÷ 30.44) km a day (the default 1,000 km a month of MF-23 rule 5, until ST-91 brings the readings), rounded to whole days; the lamp applies the ITP thresholds to those days (green over 60, amber 8 to 60, red 7 or fewer, red when 0 or passed). Sentences, with the kilometres in the person's number format: above 0 km "Schimb de ulei peste <n> km" / "Oil service due in <n> km"; at 0 km "Schimb de ulei acum" / "Oil service due now"; below 0 "Schimbul de ulei a trecut de <n> km" / "Oil service overdue by <n> km" (n positive). The colour is never the only signal (090-FR-004's rule). No grey oil line: ST-91 adds it with the field that writes the value.

_From 029-overview-panels-own-data._

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

### 091-FR-002 — A `driver` reading MUST be written when a car is added (its odometer, today) and whenever an edit changes `odometer_km` (the new value, today), in the same transaction as the car; an edit that leaves the kilometres unchanged writes none. `CAR.odometer_km` MUST equal the car's newest reading (by `read_on`, then creation time). A migration MUST back-fill one `driver` reading per existing car (its current `odometer_km`, `read_on` the day of its `updated_at`), so every car has at least one reading.

_From 091-oil-service-due._

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
