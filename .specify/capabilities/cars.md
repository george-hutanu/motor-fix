---
capability: cars
updated: 2026-10-08
features:
  - 089-add-a-car
  - 090-itp-status-lamp
---

# Capability: Cars

The cars a driver keeps on their account: adding one, the owner's own list and card, the limits, and the plate kept private to its owner.

## Requirements

### 089-FR-001 — The system MUST store a car with: id, owner account, brand (a catalogue brand), model (text), year, fuel (`petrol`, `diesel`, `hybrid`, `electric`), engine (optional text), odometer in km, plate (optional), ITP, RCA and rovinietă expiry dates (optional, dates without time), next service km (optional, written by a later story), removed time (optional, written by a later story) and creation time. The existing reminder's `car_id` MUST reference it.

_From 089-add-a-car._

### 089-FR-002 — `POST /api/v1/cars` MUST create a car for the actor's own account and answer 201 with the car as the owner sees it; it MUST require the capability `driver.cars`; the one exception to that policy is an account holding the `garage` role and no `driver` row at all, which may also add a car (any other actor answers 404); the body is validated at the edge from the contracts library. `GET /api/v1/cars` MUST answer the actor's own cars (not removed, newest first) for the capability `driver.cars`. No other endpoint of this story returns a car.

_From 089-add-a-car._

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

### 090-FR-006 — Mașinile mele's car card MUST show the brand and model, "<year> · <km> km", the plate grouped as today when the car has one, and then the ITP due-date line in place of ST-89's plain ITP line. A car added from the dialog shows its line at once. Modifies 089-FR-008 (the ITP line becomes the due-date line).

_From 090-itp-status-lamp._

### 090-FR-007 — Tests MUST cover: the state and sentence for 61, 60, 8, 7, 1, 0 and −1 days and for no date, with a fixed clock in Europe/Bucharest, including just before and after midnight and the change to and from summer time; the Romanian plural and both languages' month names; the link only on a passed date, with its address (Jest); end to end (Playwright): a new driver adds a car with an ITP 36 days ahead and sees the amber line, then adds a car with an ITP 400 days ahead and sees the green line (dates relative to today in Europe/Bucharest, never literal).

_From 090-itp-status-lamp._

## Retired

- `089-FR-008` — superseded by `090-FR-006` (2026-10-08)
