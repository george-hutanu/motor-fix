---
capability: cars
updated: 2026-10-07
features:
  - 089-add-a-car
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

### 089-FR-008 — Mașinile mele MUST show a button "Adaugă o mașină" / "Add a car" and the account's cars as cards: the brand and model on one line, "<year> · <km> km" with the person's thousands separator (locale-formats) on the next, then the ITP line: grey "ITP: adaugă data din talon" / "ITP: add the date from the registration" with no date, else "ITP valabil până la <date>" / "ITP valid until <date>" in the person's date format (locale-formats); the coloured lamp and its thresholds are ST-90's. The owner's card shows the plate grouped "B 123 ABC" (county letters, digits, letters, space-separated; a plate that does not match the pattern is shown as stored). With no cars the view keeps the shared placeholder "Nimic aici încă." above the button.

_From 089-add-a-car._

### 089-FR-009 — The dialog MUST be a `dialog` task of the overlays service (158-FR-010) using the shared form-saving helper (159-FR-001..004), titled "Adaugă o mașină" / "Add a car", with the lead line of scenario 1, the fields Marcă (a search field over the brand catalogue, `GET /api/v1/brands`, case- and accent-insensitive, popular first; one brand chosen from the offered list), Model, An, Kilometri, Combustibil (Benzină, Motorină, Hibrid, Electric / Petrol, Diesel, Hybrid, Electric), a section "Opțional" / "Optional" with Număr de înmatriculare, Motor, ITP valabil până la, RCA valabilă până la, Rovinietă valabilă până la (date fields), and one main button "Adaugă mașina" / "Add the car". The year field's message, the plate warnings (pattern; same plate already held, from the loaded car list) and the brand-load failure with "Reîncearcă" / "Try again" are shown as the scenarios say. On success the task closes with the car and the view shows it at once without re-reading the list; the first field gets the focus on a computer (157-FR-007). The brand list is operable by keyboard (arrow keys move, Enter picks, Escape closes it) and each field has a visible label and its message tied to it for screen readers (157-FR-007, the overlays' dialog rules).

_From 089-add-a-car._

### 089-FR-011 — The plate MUST appear only in the owner's own answers (FR-002); the public-routes test list MUST be unchanged (both routes need a session); another account's car by id answers 404 (079-FR-013).

_From 089-add-a-car._

### 089-FR-012 — Tests MUST cover: every validation limit, plate normalising and grouping, the 20-car limit, the idempotency key (same key → same car, different key → new car), 404 for another account's car, the audit entry and `car.added` written in the same transaction (a failing audit write rolls the car back), the role granted once to a garage-only account and never to a driver, no plate outside the owner's answers (Jest, on real PostgreSQL where the repository is used); the dialog's fields and messages in both languages, the brand search, the card's three ITP lines and the km separator (Jest); end to end (Playwright): sign in as a new driver, add BMW 320d 2019 with an ITP date, see the card at once, sign out and in, still there; switch to EN and add a second car; the garage-only owner adds a car from the account block and the driver chip appears.

_From 089-add-a-car._
