---
capability: cars
updated: 2026-10-17
features:
  - 089-add-a-car
  - 090-itp-status-lamp
  - 092-edit-remove-car
  - 1169-prefetch-intent
  - 029-overview-panels-own-data
---

# Capability: Cars

The cars a driver keeps on their account: adding one, the owner's own list and card, the limits, and the plate kept private to its owner.

## Requirements

### 089-FR-001 — The system MUST store a car with: id, owner account, brand (a catalogue brand), model (text), year, fuel (`petrol`, `diesel`, `hybrid`, `electric`), engine (optional text), odometer in km, plate (optional), ITP, RCA and rovinietă expiry dates (optional, dates without time), next service km (optional, written by a later story), removed time (optional, written by a later story) and creation time. The existing reminder's `car_id` MUST reference it.

_From 089-add-a-car._

### 029-FR-006 — The car answer of `GET /api/v1/cars` (and the other car answers) MUST carry `nextServiceKm` (a whole number or null), read-only: no endpoint of this story writes it. 089-FR-002's rules (own cars only, not removed, newest first) and 089-FR-011's 404 for another account's car MUST hold unchanged and be covered by this story's tests.

_From 029-overview-panels-own-data._

### 089-FR-003 — Validation: brand required and active in the catalogue; model required, trimmed, 1 to 40 characters; year a whole number from 1950 to the current year + 1; odometer a whole number from 0 to 2,000,000; fuel one of the four; engine at most 30 characters, trimmed; plate stored in capitals with spaces and hyphens removed, 2 to 12 characters of letters and digits; each date at most 5 years ahead of today, a past date accepted. A refused body answers 400 `validation_failed` with the fields (472-FR-001), and the dialog shows each message under its field in the person's language (159-FR-002).

_From 089-add-a-car._

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

### 092-FR-001 — The system MUST let the owner of a car change any of its fields through `PATCH /api/v1/cars/:id` in the `cars` module (a merge patch: an omitted field is unchanged, an explicit `null` clears the plate, the engine or a date): brand, model, year, fuel, engine, odometer, plate, ITP, RCA and rovinietă dates, each with the add story's validation (089-FR-003; a refused body answers 400 `validation_failed` with the fields, 472-FR-001); it MUST require the capability `driver.cars`, answer 200 with the car as the owner sees it, and answer 404 for a car another account owns, a car already removed, or an unknown id (079-FR-013), and 400 `validation_failed` for an id that is not a UUID. The plate MAY be added, changed or cleared and stays the owner's alone (089-FR-011). A MotorFix admin does not edit cars.

_From 092-edit-remove-car._

### 092-FR-002 — The car MUST carry an update time (`updated_at`, set on creation and on every change), returned to the owner in every car answer as its version; an edit MUST send the version it loaded as a required `version` body field, and a mismatch MUST answer 409 `stale_version` and change nothing. The dialog then reloads the car, shows scenario 6's message and keeps the dialog open with the current values.

_From 092-edit-remove-car._

### 092-FR-003 — The system MUST let the owner remove a car through `DELETE /api/v1/cars/:id` (capability `driver.cars`; 404 as FR-001): a soft removal that sets `removed_at` and answers 204; the car is never hard-deleted (089-FR-005). It MUST be refused with 409 `open_request` when the car has a quote request in `sent`, `quoted`, `booked` or `in_work`; the check and the removal run in one transaction. A removed car MUST be absent from `GET /api/v1/cars` (089-FR-002, unchanged) and from the 20-car count (089-FR-004, unchanged), so every screen that reads the list (Mașinile mele, the home page's cars panel, the request-quote car picker) no longer shows it. There is no undo.

_From 092-edit-remove-car._

### 092-FR-004 — In the same transaction as the change, the system MUST write audit entries through the audit writer (390-FR-001): for an edit, one entry per changed field with old and new value (action `update`, subject `car`, actor the account in its role in use; values as the car answer carries them: the brand id, dates as `YYYY-MM-DD`, numbers and text as such; the plate's entry names the field with both values `null`); for a removal, one entry "car removed" (action `delete`, subject `car`). An edit that changes no field writes no entry.

_From 092-edit-remove-car._

### 092-FR-005 — In the same transaction, the system MUST hand to the event port `car.updated` (car id, owner id and the names of the changed fields; the worker reads the dates from the car, FR-006) and `car.removed` (car id, owner id); neither carries the plate or the model (089-FR-007). Nobody is notified and nothing updates live.

_From 092-edit-remove-car._

### 092-FR-006 — The worker MUST, on `car.updated` with a changed ITP, RCA or rovinietă date, set that car's reminder of that kind to the date the car holds when the event is handled (creating the row when there is none) with its 30-day and 7-day sent flags reset when the date moved, and cancel that kind's reminder when the car's date is cleared; the dates are read from the car, not the event, so an older event retried after a later edit cannot move a reminder back or recreate one cleared since; on `car.removed`, it MUST cancel every reminder of the car (ITP, RCA, rovinietă, tyres, service). A change of any other field leaves the reminders untouched. The worker's handling MUST be idempotent (an event may be delivered more than once), and a `car.updated` that arrives for a car already removed MUST change nothing, so a late event never recreates a reminder. The reminders service's `setCarDue` and `removeCar` are the hooks.

_From 092-edit-remove-car._

### 092-FR-007 — A removed car MUST get no reminder from the daily run: its rows are gone (FR-006), and the run MUST also skip any reminder whose car has `removed_at` set, so a removal that commits between a run's read and its send sends nothing.

_From 092-edit-remove-car._

### 092-FR-008 — A reminder stage MUST be sent once per date setting: a change of the date resets the flags, and that reset is the one way a stage goes out again. When a date is set or changed, every stage whose day (the due day minus 30, the due day minus 7) is before today in Europe/Bucharest MUST be marked as sent, so it is never sent late; a stage whose day is today is still sent by today's run.

_From 092-edit-remove-car._

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

### 029-FR-003 — The oil-service line MUST use the shared lamp and sentence line. Distance left = next-service km − odometer km; estimated days = distance left ÷ (1,000 ÷ 30.44) km a day (the default 1,000 km a month of MF-23 rule 5, until ST-91 brings the readings), rounded to whole days; the lamp applies the ITP thresholds to those days (green over 60, amber 8 to 60, red 7 or fewer, red when 0 or passed). Sentences, with the kilometres in the person's number format: above 0 km "Schimb de ulei peste <n> km" / "Oil service due in <n> km"; at 0 km "Schimb de ulei acum" / "Oil service due now"; below 0 "Schimbul de ulei a trecut de <n> km" / "Oil service overdue by <n> km" (n positive). The colour is never the only signal (090-FR-004's rule). No grey oil line: ST-91 adds it with the field that writes the value.

_From 029-overview-panels-own-data._

### 029-FR-006 — The car answer of `GET /api/v1/cars` (and the other car answers) MUST carry `nextServiceKm` (a whole number or null), read-only: no endpoint of this story writes it. 089-FR-002's rules (own cars only, not removed, newest first) and 089-FR-011's 404 for another account's car MUST hold unchanged and be covered by this story's tests.

_From 029-overview-panels-own-data._

### 029-FR-007 — The view Mașinile mele's card MUST show the oil-service line (FR-003) after the rovinietă line when the car has a next-service km, and no line otherwise.

_From 029-overview-panels-own-data._

## Retired

- `089-FR-008` — superseded by `090-FR-006` (2026-10-08)

- `090-FR-006` — superseded by `092-FR-009` (2026-10-11)

- `089-FR-002` — superseded by `029-FR-006` (2026-10-17)
- `092-FR-009` — superseded by `029-FR-007` (2026-10-17)
