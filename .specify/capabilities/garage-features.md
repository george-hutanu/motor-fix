---
capability: garage-features
updated: 2026-10-22
features:
  - 398-garage-feature-switches
---

# Capability: Garage features

The five features a garage switches on or off for itself (team and mechanics, schedule by lift, live photos and video, day sheets, WhatsApp): the starting values from the sign-up survey, the owner's Setări › Funcții panel, the read and the write of the switches, the refusal that protects the team, and the one check every feature element honours.

## Requirements

### 398-FR-001 — The garage dashboard's Setări view MUST show, to the owner only (the role holding `garage.feature_switches`, before the push, notification and privacy panels), a panel titled "Funcții" / "Features" with the line "Oprește ce nu folosește service-ul tău. Ce oprești dispare din meniu și din ecrane pentru toată echipa." / "Switch off what your garage does not use. What you switch off disappears from the menu and the screens for the whole team.", and five rows in this order, each with its name, its one-line description and a switch: `team_mechanics` "Echipă și mecanici" / "Team and mechanics" — "Mecanicii tăi, invitațiile și alegerea mecanicului la programare." / "Your mechanics, the invitations and the choice of mechanic on a booking."; `lift_schedule` "Program pe elevatoare" / "Schedule by lift" — "Programările pe elevatoare și alegerea elevatorului." / "The schedule by lift and the choice of lift."; `live_media` "Poze și video live" / "Live photos and video" — "Poze, video și transmisiuni live din atelier pentru client." / "Photos, video and live streams from the workshop for the customer."; `day_sheets` "Foi de lucru" / "Day sheets" — "Fișa zilei pentru fiecare mecanic, de tipărit sau de trimis." / "Each mechanic's day sheet, to print or to send."; `whatsapp` "WhatsApp" / "WhatsApp" — "Mesajele WhatsApp către echipa ta: foi de lucru și alerte." / "WhatsApp messages to your team: day sheets and alerts.". A receptionist and a mechanic MUST NOT see the panel.

_From 398-garage-feature-switches._

### 398-FR-002 — Each switch MUST show the stored state the panel reads from the signed-in garage's `features` on `GET /api/v1/me` (the session's garage entry the frame already loads), a key with no row shown as on; no separate read route is added.

_From 398-garage-feature-switches._

### 398-FR-003 — `PUT /api/v1/garages/:garageId/features/:feature` with the body `{ enabled: boolean }` MUST set that switch and answer 200 with the five switches (`{ features: { <key>: boolean } }`, a key with no row as on); `:feature` outside the five keys and a non-boolean `enabled` MUST answer 400 `validation_failed` naming the field. The row MUST be created on the first change of a key with no row and updated afterwards; no column is added to GARAGE_FEATURE.

_From 398-garage-feature-switches._

### 398-FR-004 — The write MUST be open to the owner of that garage only: a receptionist or a mechanic of the garage MUST get 403 `forbidden`, and any other actor (another garage's owner, a driver, an admin) 404, as the garage's other settings write does; a call without a session is 401 `sign_in_required`. The assistant MUST have no tool for the switches.

_From 398-garage-feature-switches._

### 398-FR-005 — Switching `team_mechanics` off MUST be refused with 409 `mechanics_on_team` and the message "Scoate mai întâi mecanicii din echipă." / "Remove the mechanics from the team first." while the garage has any mechanic row other than the owner's own (the row whose account is the owner's), with or without an account; the check runs inside the write's transaction and a refusal writes nothing. Open invitations do not block the switch. Once no other mechanic row remains, the same write goes through.

_From 398-garage-feature-switches._

### 398-FR-006 — A write that changes the switch MUST, in one transaction: write the row; record one audit entry (action `update`, subject type `garage_feature`, subject id the garage, garage id the garage, field the feature key, old value the state before as a boolean — `true` when there was no row — and new value the state after as a boolean, the actor and their role `owner`), matching the survey's `create` entries (1359-FR-012) so the history reads one subject with five fields; and write one event `garage.features_changed` with the payload `{ garageId, feature, enabled }` to the audience `garage:{garageId}`. A write with the value already stored MUST answer 200 and write nothing.

_From 398-garage-feature-switches._

### 398-FR-007 — The `garages` module MUST expose one check `featureOn(garageId, key)` (a missing row is on) for the API policy, the worker and every later story that adds a lift, team, media, day-sheet or WhatsApp element; the write, the MCP transport's own `featureOn` and the staff invites' refusal (404 `feature_off`, its message unchanged) MUST read through it. The other readers that already apply the rule (the active request, the schedule, the confirm, the notifications, the live hub) keep their behaviour and are not required to change. A throwing refusal arrives with its first caller (#341).

_From 398-garage-feature-switches._

### 398-FR-009 — Every open dashboard of the garage MUST read the account again (`GET /api/v1/me`, the frame's existing reload) when it hears `garage.features_changed` for its garage, so the menu, the bar and the routes follow the switches (097-FR-007) within 5 seconds of the write, with no reload; a tab whose current view just lost its feature MUST navigate to `/app/garage` at once. The panel "Funcții" open in another tab MUST show the switches from the same re-read.

_From 398-garage-feature-switches._

### 398-FR-010 — Switching a feature off MUST first open a confirmation in the shared overlay panel (a dialog from 768 px, a sheet under it) titled "Oprești „{name}”?" / "Switch off “{name}”?" with the feature's own line of what disappears — `team_mechanics`: "Mecanicii, invitațiile și alegerea mecanicului dispar din meniu și din programări." / "The mechanics, the invitations and the choice of mechanic disappear from the menu and the bookings."; `lift_schedule`: "Elevatoarele dispar din programări, din meniu și din fișele de lucru." / "Lifts disappear from the bookings, the menu and the day sheets."; `live_media`: "Butoanele „Foto, video, live” dispar din lucrări." / "The “Photo, video, live” buttons disappear from the jobs."; `day_sheets`: "Fișa zilei și trimiterea ei dispar; echipa nu mai primește foi de lucru." / "The day sheet and its send disappear; the team gets no more day sheets."; `whatsapp`: "Mesajele WhatsApp către echipa ta se opresc. Clienții nu sunt afectați." / "WhatsApp messages to your team stop. Customers are not affected." — and the buttons "Renunță" / "Cancel" and "Oprește" / "Switch off"; the switch MUST NOT move until "Oprește", and closing the dialog any other way (Escape, a tap outside it) counts as "Renunță": nothing is saved and the focus returns to the switch. Switching on MUST save at once with no confirmation.

_From 398-garage-feature-switches._

### 398-FR-011 — A save in flight MUST disable that row's switch; a failed save (any non-2xx or a network error) MUST flip the switch back and show "Nu am putut salva. Încearcă din nou." / "We could not save. Try again." under the row in a `role="alert"` live region; a 409 `mechanics_on_team` MUST flip it back and show the web's translated text of FR-005 ("Scoate mai întâi mecanicii din echipă." / "Remove the mechanics from the team first.") the same way, keyed on the code, never the server's string; a successful save MUST show the stored state from the answer and clear the row's message.

_From 398-garage-feature-switches._

### 398-FR-012 — Every text of FR-001, FR-010 and FR-011 MUST come from the garage area's translation files in Romanian and English (016-FR-002), with comma-below diacritics; each switch MUST be labelled by its feature's name for assistive technology and described by its row's description; axe MUST report no violation on the panel and the dialog.

_From 398-garage-feature-switches._

### 398-FR-013 — The write route MUST be listed in `infra/observability/inventory.json` as an endpoint with its reason (the audit entry and the event record each change; a refusal is the rule working; the API's error-rate and latency rules cover the route), with no metric, panel or alert of its own.

_From 398-garage-feature-switches._

### 398-FR-014 — Tests MUST cover, failing first: Jest on real PostgreSQL for FR-003 (no rows → the answer reports all on, first write creates the row, bad key and bad body 400), FR-004 (owner 200, receptionist and mechanic 403, outsider 404, signed out 401), FR-005 (refused with another mechanic row, with or without an account, nothing written; allowed with the owner's own row only; allowed after the removal), FR-006 (the row, the audit entry and the event in one transaction, a failed entry rolling the row back, a no-op write writing nothing) and FR-007 (`featureOn` for each key and a missing row, the staff invites' 404 through it); Jest on the live hub for FR-008 (the kind reaches an owner, a receptionist and a mechanic stream of the garage, no other garage's); Jest on the panel for FR-001, FR-002, FR-010 and FR-011 (five rows from `/me`'s features, the dialog's two outcomes, the flip back on failure and on 409) and on the frame for FR-009 (the reload on the event, the navigation away from a view that lost its feature); and one Playwright test: the owner switches "Echipă și mecanici" off, a second tab of the owner's dashboard sitting on Mecanici loses it from the menu and is moved to `/app/garage` without a reload, the owner switches it on and Mecanici returns. A `// @traces` line names the ids.

_From 398-garage-feature-switches._
