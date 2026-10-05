# Feature Specification: Set up push notifications

**Feature Branch**: `196-push-notifications`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-196 Set up push notifications (Notion page https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80): Web Push as the second channel of the notifications service from the installable web app — permission prompt after a tap, PUSH_SUBSCRIPTION storage (POST/DELETE /api/v1/push-subscriptions), service worker that shows the notification and opens the right screen, push adapter in the worker with fallback to e-mail and deletion on 404/410, iPhone Home Screen hint, deletion on sign-out. Follow the story's Build brief."

**Sources**: Notion story ST-196 (https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80), epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. Decisions of 2026-10-03: launch channels e-mail, push (Web Push from the installable web app), SMS and WhatsApp (A18); MotorFix ships first as an installable web app (A19). The pipeline of ST-194, ST-197 and ST-392 (`libs/domain/src/notifications/notifications.service.ts`, `notifications.processor.ts`, `routing.ts`, `preferences.ts`), the push texts of ST-195 (`templates.ts`), and the web app's manifest and service worker (`apps/web/ngsw-config.json`, `apps/web/src/app/app.config.ts`).

## Clarifications

### Session 2026-10-05

- Q: When an e-mail row fails for good and the person has a push device, does it go by push, and can a fallback row fall back again? → A: An e-mail that fails for good goes by push when it is not itself a fallback, the type lists push and the person has a device; a push that is itself a fallback never falls back to e-mail. The existing SMS → WhatsApp → e-mail chain is unchanged, and nothing loops.
- Q: Is push for staff on once a device is saved, or opt-in per type like WhatsApp? → A: On once a device is saved (tapping "Activează notificările" is the opt-in); the existing per-type switches can still mute it.
- Q: When one device takes a push and another fails retryably, what happens to the row? → A: The row is `sent` when at least one device took it; it is retried only when no device took it and at least one refusal was retryable.
- Q: What decides "iPhone outside the Home Screen", and does it win over "browser without push"? → A: An iPhone or iPad (including iPadOS with a desktop user agent and touch) not running from the Home Screen shows the hint, whether or not the browser exposes push; installed but without push support (iOS before 16.4) shows "browser without push"; every other browser is feature-detected.
- Q: Does the push → e-mail fallback respect the e-mail mute that comes from choosing push? → A: For a driver type, no: choosing push is what muted e-mail, so the e-mail goes whenever the type's channels include it, as the SMS and WhatsApp fallbacks already do. For a staff type the person's own e-mail switch still holds when the message is built (push is on by default for staff, so ignoring it would make the switch useless); a push that fails when sent falls back like the others. A group the person switched off entirely still sends nothing.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person turns push on for this device (Priority: P1)

Any signed-in person (driver, garage owner, receptionist, mechanic, admin) opens the notifications panel of their dashboard and taps "Activează notificările" (turn on notifications). Only then does the browser ask for permission. When they allow it, the device is saved as one of their push devices. They can turn it off again, and a "Trimite o notificare de test" (send a test notification) button shows a test push on every device they turned on.

**Why this priority**: without a saved device nothing can be pushed; every other story rests on it.

**Independent Test**: sign in, open the panel with notification permission granted, tap the button: one push device is saved for the account; tap "Dezactivează" (turn off): it is gone.

**Acceptance Scenarios**:

1. **Given** a signed-in driver on Android Chrome, **When** they tap "Activează notificările" and allow the browser prompt, **Then** a push device is saved with its address, its keys and a device label.
2. **Given** the panel is opened, **When** the page loads, **Then** the browser's permission prompt is not shown; it is shown only after the tap.
3. **Given** push is on for this device, **When** the person taps "Dezactivează notificările", **Then** the device is deleted and this browser stops receiving pushes.
4. **Given** push is on, **When** the person taps "Trimite o notificare de test", **Then** a test push appears on each of their devices with push on.
5. **Given** the same browser saves its device twice (a reload, a second tap), **When** both saves arrive, **Then** there is still one saved device for that browser.
6. **Given** another account's device id, **When** a person tries to delete it, **Then** the answer is 404 and nothing changes.

---

### User Story 2 - A message chosen for push reaches the closed app (Priority: P1)

A message whose channel is push for the person (a driver who chose push for a group, or staff for whom push is on) goes to every device they turned on, with the app closed. Tapping it opens the screen the message is about.

**Why this priority**: this is the channel itself; the rest of the story is its edges.

**Independent Test**: a driver chose push for offers and has one device; hand the service a QUOTE_RECEIVED message and run the worker against a recorded push service: one push sent to that device, the push row `sent`, no e-mail row.

**Acceptance Scenarios**:

1. **Given** the app is closed and the driver chose push for offers, **When** a garage sends them a quote, **Then** a push "Ofertă nouă de la Service Auto Nord" (new quote from Service Auto Nord) is sent within 60 seconds, and tapping it opens the request in Cererile mele (my requests).
2. **Given** a person with push on a phone and a laptop, **When** a message goes by push, **Then** it is sent to both devices and there is one notification row for the push channel.
3. **Given** a type that is always sent, **When** it goes by push, **Then** it is sent with high urgency; any other type with normal urgency; both live 24 hours.
4. **Given** a push text carries only the template's title, body and link, **When** it is sent, **Then** it holds no personal data beyond what the template allows.

---

### User Story 3 - Push that cannot reach the person falls back to e-mail (Priority: P1)

Push never loses a message: no device, a blocked browser, a device the push service no longer knows, or a push service that stays down sends the message by e-mail instead, when the type goes by e-mail.

**Why this priority**: drivers who chose push but never allowed it must still hear about their quotes and bookings.

**Independent Test**: a driver chose push for offers and has no device; a QUOTE_RECEIVED message writes an e-mail row and no push row.

**Acceptance Scenarios**:

1. **Given** a person who chose push has no saved device (never allowed it, or blocked notifications in the browser), **When** a message for them goes by push, **Then** it goes by e-mail.
2. **Given** the push service answers 404 or 410 for a device, **When** the worker sends, **Then** that device is deleted; if no device took the message, it falls back to e-mail.
3. **Given** the push service is down, **When** the retries of the e-mail channel are used up, **Then** the push row is `failed` and the message goes by e-mail.
4. **Given** a type with no push text yet, **When** it would go by push, **Then** it goes by e-mail and an error is logged.
5. **Given** a type that goes by push only, **When** push cannot reach the person, **Then** the row fails and nothing else is sent (the bell row already holds it).

---

### User Story 4 - The panel explains what this device can and cannot do (Priority: P2)

The panel reads the browser's permission live and says what to do: an iPhone that has not added MotorFix to the Home Screen gets the steps to add it, a browser that blocked notifications gets "Notificările sunt blocate în browser" with how to unblock them, and a browser without push says so.

**Why this priority**: iPhones only allow push from an installed web app; without the hint iPhone users cannot get push at all.

**Independent Test**: open the panel in a browser emulating iPhone Safari outside the Home Screen: the hint shows and there is no turn-on button.

**Acceptance Scenarios**:

1. **Given** an iPhone with Safari and MotorFix not added to the Home Screen, **When** the driver opens the panel, **Then** a hint explains how to add MotorFix to the Home Screen, push stays off and messages go by e-mail.
2. **Given** MotorFix added to the Home Screen on iOS 16.4 or later, **When** the driver taps the button and allows push, **Then** the device is saved and the test push shows.
3. **Given** the person blocked notifications in the browser, **When** they open the panel, **Then** it shows "Notificările sunt blocate în browser" and how to unblock them, and no turn-on button.
4. **Given** push is not set up on the server, **When** the panel opens, **Then** it says push is not available yet and offers no button.

---

### User Story 5 - Signing out removes the device (Priority: P2)

A device that signs out stops getting the account's pushes.

**Why this priority**: a shared or sold phone must not keep showing someone's messages.

**Independent Test**: turn push on, sign out: the device is deleted.

**Acceptance Scenarios**:

1. **Given** push is on for this device, **When** the person signs out on it, **Then** that device's saved push device is deleted before the session ends.
2. **Given** a person signs out everywhere, **When** it completes, **Then** every push device of the account is deleted.
3. **Given** the app starts with push on in the browser, **When** the saved device is missing or its address changed (a service worker update), **Then** the browser's current device is saved again.

### Edge Cases

- A browser address already saved for another account (two people on one shared laptop): the latest save wins: the earlier account's device is deleted and a new one is saved for the account that saved it last, so no device id ever moves between accounts.
- A save with a non-https address or keys missing: 400 with the problem body, nothing saved.
- A person with more than one device where one answers 410 and the other takes the message: the row is `sent`, the gone device deleted, no e-mail.
- A message at night for a type that is not urgent: the push row waits until 08:00, like SMS and WhatsApp.
- A deleted account: its push row fails like any other channel.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A signed-in person MUST be able to save the current browser as a push device (address, two keys, optional device label up to 100 characters); saving an address that exists again replaces it and answers the same device id.
- **FR-002**: A signed-in person MUST be able to delete one of their own push devices; another account's device or an unknown id answers 404 `not_found`.
- **FR-003**: A save MUST be refused with 400 when the address is not an https URL or a key is missing or empty.
- **FR-004**: The web app MUST ask for the browser's notification permission only after a tap on "Activează notificările", never on page load.
- **FR-005**: The notifications panel MUST show the state read live from the browser: on, off, blocked ("Notificările sunt blocate în browser" with unblock steps), iPhone outside the Home Screen (the add-to-Home-Screen hint), unsupported browser, and push not set up on the server.
- **FR-006**: The panel MUST be reachable by every role: the Setări (settings) view of the driver and admin dashboards, and the garage dashboard's home view, which every garage role sees.
- **FR-007**: The routing MUST send a message by push when push is one of its type's channels, the person did not mute it, and the person has at least one push device; a person with no device MUST get it by e-mail instead when the type goes by e-mail. Push is on for a person, driver or staff, once they save a device, unless they muted it for that type; for a driver type the e-mail used instead goes whenever the type's channels include e-mail, even when choosing push muted e-mail; for a staff type it goes only when the person did not mute e-mail.
- **FR-008**: The worker MUST send one push row to every push device of the person, with the template's push title, body and link, a time to live of 24 hours, and urgency high for always-sent types and normal for the rest.
- **FR-009**: A device the push service answers 404 or 410 for MUST be deleted; when no device took the message, the row MUST fail with `no_device` and fall back to e-mail.
- **FR-010**: A retryable push failure (network, 429, 5xx) MUST be retried on the e-mail schedule; once the retries are used up, or on any other refusal, the row MUST fail and fall back to e-mail.
- **FR-011**: A push row MUST record its successful send on the row (`sent`, time) and the time of the last success on each device that took it.
- **FR-012**: A push row of a type that is not urgent, built in quiet hours, MUST wait until 08:00.
- **FR-013**: A type with no push text MUST fail its push row with `template_failed` and fall back to e-mail.
- **FR-014**: The test message MUST go by push as well as e-mail, and a signed-in person MUST be able to send a push-only test to their own devices; the test push has no e-mail fallback.
- **FR-015**: The service worker MUST show a received push as a notification and, when it is tapped, open (or focus) the app at the push's link.
- **FR-016**: Signing out on a device MUST delete that device's push device and unsubscribe the browser; signing out everywhere MUST delete every push device of the account.
- **FR-017**: On app start, a browser with push on MUST save its current device again, so a changed address after a service worker update is not lost.
- **FR-018**: Push MUST be off, with no device saved and no push sent, when the server has no push keys configured; messages then go by e-mail. Routing then treats every person as having no push device.
- **FR-019**: An e-mail row that fails for good and is not itself a fallback MUST fall back to push when the type lists push and the person has a push device; a push row that is itself a fallback MUST NOT fall back to e-mail.
- **FR-020**: A push row MUST be `sent` when at least one device took it, and MUST be retried only when no device took it and at least one refusal was retryable.
- **FR-021**: The panel MUST show the add-to-Home-Screen hint on an iPhone or iPad not running from the Home Screen, whether or not the browser exposes push; an installed app without push support MUST show "browser without push".

### Key Entities

- **Push device (PUSH_SUBSCRIPTION)**: one browser that allowed push for one account: the push service address (unique), its two keys, a device label, when it was saved, when a push last reached it.
- **Notification (existing)**: gains rows on the `push` channel, one per message and person, whatever the number of devices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A message for a person with push on, not held for quiet hours, reaches the push service within 60 seconds of being handed to the sending service, measured in the integration test with a recorded push service. (Build brief, scenario 2)
- **SC-002**: 100% of messages for a person who chose push but has no reachable device are sent by e-mail when the type goes by e-mail.
- **SC-003**: A device answering 404 or 410 is never sent to again.
- **SC-004**: The panel works at 320 px, 390 px, tablet and desktop widths, in light and dark, Romanian and English, with no sideways scroll.

## Assumptions

- Push is sent directly by the worker with the standard Web Push protocol and the server's VAPID keys, not through Brevo: Brevo's transactional API has no Web Push to browser subscriptions. This answers the brief's open question within A18, which leaves it to the build team. (autonomous default)
- The panel's placement: Setări of the driver and admin dashboards; the garage dashboard has no Setări view, so the panel sits on its home view. The one-time panel after the first quote request waits for the quote request flow, which does not exist yet. (autonomous default; Build brief › Screens, proposed)
- The device label is the browser's own description (platform and browser), cut to 100 characters. (autonomous default)
- "Choose a channel per type" exists already (ST-197); this story adds no preference UI. (Build brief › Out of scope)
- The test push of a signed-in person is a new push-only, transactional type with a bell text; the admin test message gains push. (autonomous default)
- Sign out everywhere also deletes every push device: the other devices are signed out, so they must stop getting pushes. (autonomous default)
- The push keys come from the environment (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); setting them on staging and production is the owner's step. (autonomous default)
- Real-phone checks (iPhone installed web app, Android) are manual and belong to the device-testing story. (Build brief › Tests)
- Audit history: none; a push device is not a change to MotorFix data. (Build brief › Data, proposed)

## Spec Delta

### Adds

- Push devices: save, replace, delete, deletion on sign-out and on 404/410.
- The push channel of the sending service, with its fallback to e-mail.
- The notifications panel and the service worker's push display.

### Modifies

- Routing: push is no longer skipped; a push choice with no device goes by e-mail.
- Fallback: an e-mail that fails for good goes by push when the person has a device; a fallback row never falls back again.
- The test message also goes by push.

### Removes

- None.
