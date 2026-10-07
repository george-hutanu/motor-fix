# Feature Specification: Save a draft and come back to it later

**Feature Branch**: `114-save-draft`

**Created**: 2026-10-07

**Status**: Archived (2026-10-07)

**Input**: User description: "ST-114 Save a draft and come back to it later (EP-2 Garage onboarding and verification). Notion story: https://app.notion.com/p/3ee607bff0d28182bfafc99b0021fc1f"

**Sources**: Notion story ST-114 (https://app.notion.com/p/3ee607bff0d28182bfafc99b0021fc1f, Story, Highest, 5 points, Labels front end + backend + outside service, Role Garage), read 2026-10-07; its Build brief (current as of 2026-10-03) wins over the criteria and notes above it, and its decision of 2026-10-03 (the owner's account is created at the end of the listing form; until then the draft lives in the browser and, once an e-mail is given, on the server) is applied. Epic Garage onboarding and verification (EP-2, https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf). Screens: List your garage and Mobile · List your garage in the mock, the button "Salvează ciorna" only; the e-mail field, the "link sent" line, the two e-mails and the expired-link page are not designed (Build brief › Screens). Repo: `apps/web/src/app/public/list-your-garage.ts` (the public page at `/ro/list-your-garage` and `/en/list-your-garage`, six empty sections and the step list, `.specify/capabilities/garage-listing.md`; it holds no field yet), `libs/domain/prisma/schema/garages.prisma` (Garage with status `draft`; no listing draft exists), `libs/domain/src/notifications/catalogue.ts` (LISTING_CONTINUE_LINK, direct e-mail, transactional; LISTING_REMINDER, timer e-mail, not urgent; neither has a template yet) and `.specify/capabilities/notifications.md` (the direct send is for accounts only), `libs/domain/src/scheduler` (the daily timers), `.specify/capabilities/storage.md` (`garage_photo` keys are `<purpose>/<owner id>/<random id>`).

## Clarifications

### Session 2026-10-07

- Q: When, and how many times, is the owner reminded of an unfinished listing (the brief's one open question)? → A: Once: one e-mail 3 days after the draft's last change, only to a draft that has an e-mail, has not been sent and has not been reminded; a change after the reminder does not earn a second one (autonomous default, the brief's proposed build default).
- Q: Which address does the continue link open, the brief's `…/listeaza-service?draft=<token>` or the page the repo serves? → A: The page the repo serves, `/<lang>/list-your-garage?draft=<token>` (108-FR-001 fixes one path after the language prefix); the Romanian slug belongs to the story that renames the public addresses, if any (autonomous default).
- Q: What does the owner see when the link e-mails are capped (5 per draft per hour)? → A: The save itself never fails for it: the draft is saved, no e-mail goes, and the form says the link was already sent, with the time it can be sent again (autonomous default).
- Q: Does the browser that created the server copy need the link to reach it? → A: No. That browser keeps the draft's key with the draft, so its own saves reach the server copy; the link is for another browser or device (autonomous default).
- Q: Does the continue link carry the token only, and how does the page learn the draft's id? → A: Token only. The token's hash is unique, so `GET /api/v1/listing-drafts/current` with the `X-Listing-Token` header resolves the draft and answers its id, which the page then uses for `PATCH /api/v1/listing-drafts/{id}`; a token for another id still answers 404 (spec-challenger; FR-008 as written).
- Q: When the owner changes the e-mail, do links sent to the previous address keep working? → A: No. Every token issued before the change is revoked, and the browser making the change gets a fresh token in the same response; a typo'd address must not hold a working key to the draft (spec-challenger; privacy, FR-018).
- Q: On load, which copy wins when the browser holds changes the server never received? → A: The browser copy keeps a "not yet on the server" mark, set when a server save is pending or failed and cleared when one succeeds. On load, a marked copy is shown and saved to the server at once; an unmarked one is replaced by the server copy. Opening a continue link always takes the server copy (spec-challenger; reconciles FR-002, FR-013, FR-014).
- Q: What are the draft's two states called in storage? → A: `open` and `submitted`, the names of the data model (MF-29 Build brief › States and lifecycle, context.md); "sent" stays the plain-English word for it in this spec.
- Q: Does a link or reminder e-mail to an address with no account write a notification row, and who deletes it? → A: Yes: a row with no account, tied to the draft and deleted with it, holding neither the address nor the token (the address is read from the draft at send time; the link travels only in the queue job), so retries and delivery status work as for other e-mails (spec-challenger; Principle I, reuse the one queue).
- Q: Who moves a draft to `submitted`? → A: The story that sends the listing and creates the account (out of scope here); this story stores the status, refuses saves on a sent draft and shows the "listing was sent" page (autonomous default).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - What the owner types is never lost in their own browser (Priority: P1)

Ion starts listing Atelier Dinamo on his laptop between two customers. He types the garage's name, a customer walks in, and he closes the tab. An hour later he opens the page again and everything he entered is there, at the step where he stopped. He also has a button, "Salvează ciorna", that keeps the draft at once; pressed before he gave an e-mail, it keeps the draft in the browser and points him to the e-mail field so he can continue from another device too.

**Why this priority**: It is the story's reason to exist and needs no account, no e-mail and no server: the owner who stops halfway loses nothing. Every other story of the form builds its fields into this store.

**Independent Test**: Fill in the form's fields in a browser, close the page, open it again in the same browser and compare every value and the current step; press the button with and without an e-mail.

**Acceptance Scenarios**:

1. **Given** a visitor types in step 1 of the form, **When** they close the tab and open the page again in the same browser, **Then** every value the form holds (today: the e-mail of step 1; the fields of the other stories as they arrive, their ticks and the photos' file keys among them) and the step they were at come back as they were.
2. **Given** a visitor changes a field, **When** 1 second passes with no further change, **Then** the draft is saved in the browser, with no visible delay in typing.
3. **Given** no e-mail has been entered, **When** the owner presses "Salvează ciorna", **Then** the draft is saved in the browser and the e-mail field is highlighted with "Adaugă un e-mail ca să continui de pe alt dispozitiv" / "Add an e-mail to continue on another device".
4. **Given** the browser refuses to store anything (private mode, blocked site data), **When** the owner uses the form, **Then** the form still works and a note says the draft is kept only on the server once an e-mail is given.
5. **Given** the owner switches the language, **When** the page re-renders, **Then** the draft, the current step and every note are kept (108-FR-009) and shown in the new language.

---

### User Story 2 - An e-mail keeps a server copy and a link to continue anywhere (Priority: P1)

Ion types `ion@atelier-dinamo.ro` into the e-mail field of step 1 and moves on. MotorFix keeps a copy of his draft on its servers and e-mails him a link. The form tells him so. That evening, on his phone, he opens the link: the form opens with the draft as he last left it, at the step he stopped at, and his changes there are saved to the same copy. "Salvează ciorna" saves at once and sends the link again.

**Why this priority**: The brief's decision: the account comes at the end, so the e-mail and its link are the only way a draft follows the owner across devices and survives a cleared browser.

**Independent Test**: Enter a valid e-mail and leave the field; check that a server copy exists, that one e-mail with a link was queued in the form's language, and that opening the link in a fresh browser shows the same draft at the same step; then change it there and reload the first browser.

**Acceptance Scenarios**:

1. **Given** the owner enters a valid e-mail on step 1, **When** they leave the field, **Then** a server copy of the draft is created with that e-mail, the current step and the form's language, an e-mail with the subject "Continuă înscrierea service-ului" / "Continue listing your garage" is sent to that address with a link, and the form says "Ți-am trimis un link pe e-mail ca să continui de pe orice dispozitiv" / "We e-mailed you a link to continue on any device".
2. **Given** a server copy exists, **When** the owner keeps typing, **Then** the server copy is saved at most every 5 seconds while they type and when they leave a step, and the browser copy on every change as in story 1.
3. **Given** the e-mail with the link, **When** the owner opens it on a phone, **Then** the form opens with the draft as last saved on the server, at the step where they stopped, and that phone's changes save to the same server copy.
4. **Given** a server copy exists, **When** the owner presses "Salvează ciorna", **Then** the draft is saved to the server at once, "Ciorna e salvată" / "Draft saved" shows, and the link is sent again.
5. **Given** the e-mail is not a valid address (no text before "@", no domain with a dot, longer than 254 characters, more than one address), **When** the owner leaves the field, **Then** the field shows what is wrong, no server copy is created and no e-mail goes.
6. **Given** the sending service fails, **When** a link e-mail is queued, **Then** the form does not wait for the e-mail: the save answers at once and the queue retries the e-mail.
7. **Given** the server save fails or the device is offline, **When** the owner keeps working, **Then** the browser copy stays, a line "Neconectat · salvăm când revii online" / "Offline · we save when you are back" shows while offline, and the next save sends what changed.

---

### User Story 3 - Two devices, one draft; links that stop working (Priority: P2)

Ion has the draft open on the laptop and on the phone. Whichever device saves last wins; the device that opens the link takes the server copy and drops its own. Months later, after the listing was sent and his account made, he finds the old e-mail and opens its link: the page tells him the listing was sent and offers to sign in. A link that is wrong, old or deleted says so and offers to start again.

**Why this priority**: Without these rules the two copies drift and an old link is a hole: the link is the only key to the draft, so what it opens, and when it stops opening, must be exact.

**Independent Test**: Save from two browsers in turn and read the server copy after each; open a wrong token, a token of a deleted draft and a token of a sent draft, and read the page each shows.

**Acceptance Scenarios**:

1. **Given** the draft is open on two devices, **When** both change it, **Then** the last save wins, by the time of the save on the server, and each device shows the server copy at its next load.
2. **Given** a device opens the continue link, **When** the page loads, **Then** it takes the server copy and replaces whatever that browser held for the form.
3. **Given** a wrong, old or deleted token, **When** its link is opened, **Then** the server answers 404 and the page says "Linkul nu mai e valid" / "The link is no longer valid" with a button "Începe din nou" / "Start again" that opens an empty form.
4. **Given** the listing has been sent, **When** an old link is opened, **Then** the page says "Înscrierea a fost trimisă" / "The listing was sent" with a sign-in button, and no save is accepted on that draft.
5. **Given** a link was sent twice to the same address, **When** the older link is opened before the draft is sent, **Then** it still opens the draft: every link of a draft stays valid until the draft is sent or its e-mail changes.
6. **Given** the link e-mails of a draft reached 5 in the past hour, **When** the owner presses "Salvează ciorna" again, **Then** the draft is saved, no e-mail goes, and the form says the link was already sent and when it can be sent again.

---

### User Story 4 - The unfinished draft is remembered, then forgotten (Priority: P3)

Ion gave his e-mail, then stopped. Three days after his last change, one e-mail reminds him, with the same kind of link. If he never comes back, the draft and the photos it holds are deleted 90 days after his last change.

**Why this priority**: The reminder recovers listings that would otherwise be lost; the deletion keeps a personal address and photos no longer than needed. Both run on their own, without the owner.

**Independent Test**: Create drafts with and without an e-mail at several ages, run the timers, and read which drafts got a reminder, which were deleted with their files, and which are untouched.

**Acceptance Scenarios**:

1. **Given** a draft with an e-mail, not sent, not reminded, last changed 3 days ago or more, **When** the reminder timer runs, **Then** one reminder e-mail with a continue link is sent in the draft's language and the draft is marked reminded; a draft without an e-mail, already reminded or sent gets none.
2. **Given** a reminded draft the owner changes again, **When** the timer runs 3 days later, **Then** no second reminder goes.
3. **Given** a draft never sent, last changed 90 days ago or more, **When** the clean-up runs, **Then** the draft and every file whose key it holds are deleted; a draft changed since, or sent, is kept.
4. **Given** the timers run twice on the same day, **When** the second run reads the same drafts, **Then** nothing is sent or deleted twice.

---

### Edge Cases

- The owner changes the e-mail on step 1 after a server copy exists: the server copy's e-mail is replaced, every earlier token is revoked (their links answer 404), the changing browser receives a fresh token in the same response, and a link goes to the new address.
- The owner enters the same e-mail that already has a draft: a second draft is created; drafts are keyed by their token, never looked up by e-mail (nothing lists or searches server copies).
- The browser holds a draft for the form and the page is opened with a link to another draft: the link's draft replaces the browser's (story 3, scenario 2).
- A save larger than 256 KB (the data of all steps and the survey answers; photos are file keys, not bytes) is refused with 413 and a stable code; the browser keeps its copy and tells the owner the draft is too large.
- A save arrives for a draft that was deleted by the clean-up meanwhile: 404; the page shows the "link is no longer valid" state and offers to start again, keeping the browser's data in the new draft.
- Two saves of one draft arrive at the same moment: both commit in some order and the later `updated_at` wins; neither errors.
- The token is opened at a different language prefix than the one the e-mail was sent in: the page opens in the prefix's language, the draft's language is updated at its next save.
- The reminder is due during quiet hours: LISTING_REMINDER is not urgent, so it is held until 08:00 Europe/Bucharest (194-FR-010); the continue link is transactional and goes at any hour.
- Storage keys of photos belong to the draft: the owner id of a draft's photo keys is the draft id, so the clean-up deletes exactly the draft's files.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Step 1 of the form MUST hold an e-mail field: required for a server copy, one address, trimmed, at most 254 characters, with text, "@" and a domain with a dot (the sign-up rule, 080-FR-005); it is not confirmed at this stage. An invalid address MUST be named in the field and MUST create no server copy and send no e-mail.
- **FR-002**: The form MUST keep a browser copy of the draft: every value the form holds (one section per step plus the survey answers, photos as file keys) and the current step, saved 1 second after the last change and at once on "Salvează ciorna", and MUST restore it, at that step, when the page is opened again in the same browser. The fields of the other stories join the same store as they arrive.
- **FR-003**: When the browser cannot store (storage blocked or throwing) the form MUST keep working and show a note that the draft is kept only on the server once an e-mail is given; no error is thrown to the owner.
- **FR-004**: The page MUST show a button "Salvează ciorna" / "Save draft" on List your garage and its phone layout. Without an e-mail it saves the browser copy and highlights the e-mail field with "Adaugă un e-mail ca să continui de pe alt dispozitiv"; with a server copy it saves to the server at once, shows "Ciorna e salvată" and sends the link again (FR-008).
- **FR-005**: When a valid e-mail is entered on step 1 and the field is left, the form MUST create the server copy (`POST /api/v1/listing-drafts`: e-mail, data, step, language) and send the continue link; from then on it MUST save the server copy (`PATCH /api/v1/listing-drafts/{id}`) at most every 5 seconds while the owner types, when the owner leaves a step, and at once on "Salvează ciorna". Every server save MUST carry the whole data, so the last save wins.
- **FR-006**: The server copy MUST be the listing draft: id, e-mail, data (at most 256 KB, else 413 with a stable code), step, language, status (`open` or `submitted`), the hashes of its continue-link tokens, `reminded_at`, `created_at`, `updated_at`. It MUST hold no account and no garage: nothing is written to the garage tables until the listing is sent, by another story. Server copies MUST never be listed, searched or looked up by e-mail by any endpoint.
- **FR-007**: Whoever holds the draft MUST be able to read and save it, and nobody else: the endpoints are public (no session) and take the token in the `X-Listing-Token` header; `GET /api/v1/listing-drafts/current` resolves the draft from the token alone (the token hash is unique) and answers its id with the draft; a request whose token hash matches none of the draft's tokens, a token of a deleted draft and a token for another draft id MUST answer 404 with the same body, and a request without the header 404 too. Only token hashes are stored, never a token.
- **FR-008**: Sending the link (`POST /api/v1/listing-drafts/{id}/continue-link`, also called by FR-005's create and by FR-004) MUST make a new token of 32 random bytes, store its hash beside the draft's earlier ones, which stay valid until the draft is sent or its e-mail changes, and queue one LISTING_CONTINUE_LINK e-mail to the draft's e-mail, in the draft's language, subject "Continuă înscrierea service-ului" / "Continue listing your garage", whose link is `<PUBLIC_WEB_URL>/<lang>/list-your-garage?draft=<token>` and carries nothing else. The form MUST then say "Ți-am trimis un link pe e-mail ca să continui de pe orice dispozitiv".
- **FR-009**: At most 5 link e-mails MUST go per draft per hour (reminders not counted); past the cap the save succeeds and the send answers 429 with a stable code and the seconds until the next send, which the form shows as "the link was already sent" with that time. The cap MUST be counted in PostgreSQL (the sent times of the draft's tokens), never in Redis alone.
- **FR-010**: The link e-mails MUST go through the one notifications service to an address that has no account, as a direct send: never grouped, never held, in the given language, each send with a fresh event id, and a sending failure retried by the `notifications` queue with no wait on the form's request. The notifications capability gains this one direct path for LISTING_CONTINUE_LINK and LISTING_REMINDER; no other type uses it. Each send writes a notification row with no account, tied to the draft and deleted with it, holding neither the address nor the token: the address is read from the draft when the e-mail is sent and the link travels only in the queue job.
- **FR-011**: Opening the page with `?draft=<token>` MUST read the server copy (`GET /api/v1/listing-drafts/current` with the header; the link carries the token only), take it over whatever the browser held for the form, open the form at the saved step (as a jump, 108-FR-006) and keep the token with the browser copy so later saves reach the same server copy. The token MUST NOT stay in the address bar after the page has read it.
- **FR-012**: A link whose token answers 404 MUST show "Linkul nu mai e valid" / "The link is no longer valid" with a button "Începe din nou" / "Start again" that opens an empty form; a link to a `submitted` draft MUST show "Înscrierea a fost trimisă" / "The listing was sent" with a sign-in button (the sign-in dialog of the public frame). A `submitted` draft MUST refuse every save with 409 and a stable code.
- **FR-013**: Of two saves the later `updated_at` wins; a device MUST show the server copy at its next load unless its browser copy is marked as holding changes not yet on the server, in which case it shows its own copy and saves it to the server at once (FR-014), and the device that opened a link MUST replace its own copy with the server's (FR-011). The server MUST never merge fields.
- **FR-014**: While the device is offline or the server save fails, the browser copy MUST stay, marked as holding changes not yet on the server until a server save succeeds, a line "Neconectat · salvăm când revii online" / "Offline · we save when you are back" MUST show while offline, and the next save (on the next change, on reconnect, or on "Salvează ciorna") MUST send the whole draft again. No change is lost between the two.
- **FR-015**: A daily timer MUST send one LISTING_REMINDER e-mail, with a continue link as FR-008 makes it (outside the FR-009 count), to every draft with status `open`, `reminded_at` empty and `updated_at` 3 days old or more, and set `reminded_at` in the same transaction; a draft already reminded or `submitted` gets none (every server copy has an e-mail, FR-006), and a second run on the same day sends nothing twice.
- **FR-016**: A daily timer MUST delete every draft with status `open` whose `updated_at` is 90 days old or more, with every file whose key its data holds (the storage delete); a draft changed since or `submitted` is kept. The 90 days are the brief's proposed retention, to be confirmed by the lawyer: the number MUST live in one place.
- **FR-017**: The draft's language MUST be the form's language at the last save, and every e-mail MUST be written in the draft's language with the Romanian and English templates of the message-templates story; the link MUST open the page in that language.
- **FR-018**: Nothing MUST be written to the audit history and no event MUST be emitted through the outbox while there is no account; the link e-mails go straight to the notifications queue. Logs MUST carry no e-mail address and no token (421-FR-010).
- **FR-019**: The e-mail field, the button, the notes and the error pages MUST obey the phone layout rules of the page (108-FR-011): no sideways scroll at 320 px, 44 px targets, text at least 12 px, light and dark, Romanian and English, and the field's error and the link-sent line MUST be announced to assistive technology (an `aria-live` region or a described-by error).
- **FR-020**: Tests MUST cover, in Jest on real PostgreSQL and Redis: the token stored hashed and found by hash, a bad, foreign or missing token answering 404; the link e-mail queued once per send, in the draft's language, and the 6th send in an hour answering 429 while the save succeeds; the last save winning by `updated_at`; a `submitted` draft refusing saves with 409; the reminder sent once and never twice; the clean-up deleting drafts 90 days old with their files and keeping the rest; the 256 KB limit; the creation throttle (11th create in an hour answering 429, nothing created) and `Cache-Control: no-store` on draft responses. A Playwright end-to-end test MUST fill step 1 with an e-mail, read the link from the test mail sink, open it in a new browser context and check the data is there, then reload the first context and check the data is still there.
- **FR-021**: Abuse and leakage limits. Creating a server copy (`POST /api/v1/listing-drafts`) MUST be limited per source address by a Redis counter (the API has no throttle to reuse; 10 per hour; past it 429 with a stable code, nothing created and no e-mail sent), because the 5-per-draft cap (FR-009) alone lets one caller mail any address through many drafts. Every response that carries a draft or a token MUST send `Cache-Control: no-store`, and the page opened with `?draft=` MUST send `Referrer-Policy: no-referrer` so the token reaches no third party. Token lookup is by hash equality in PostgreSQL, never a comparison of clear tokens.

### Key Entities

- **Listing draft**: a garage owner's unfinished listing kept on the server once they gave an e-mail: e-mail, language, the form's data (one section per step, survey answers, photo file keys), the current step, status `open` or `submitted`, when it was reminded, created and last changed. It belongs to no account and no garage until the listing is sent.
- **Continue-link token**: the key to a draft, 32 random bytes sent once in a link and stored only as a hash with the time it was sent; a draft has several, all valid until it is sent.
- **Browser copy**: the same data and step kept in the owner's browser, plus the draft's id and token once a server copy exists; saved on every change, replaced by the server copy when a link is opened.
- **Continue-link e-mail and reminder e-mail**: LISTING_CONTINUE_LINK (direct, transactional, any hour) and LISTING_REMINDER (timer, not urgent, quiet hours apply), both to an address with no account, in the draft's language.

## Spec Delta

### Capability: `garage-listing`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-019, FR-020, FR-021
- **Modifies**: 108-FR-012 → FR-018
- **Removes**: none

### Capability: `notifications`

- **Adds**: FR-010
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the same browser, 100% of the values entered in the form and the current step come back after the page is closed and reopened, once the 1-second save after the last change has run (unit test over the store; end-to-end reload).
- **SC-002**: After a valid e-mail is left on step 1, exactly one continue-link e-mail is queued, in the form's language, and the draft opened from that link in a fresh browser context holds the same data and step as the first (API test on a real database; Playwright end to end with the test mail sink).
- **SC-003**: A wrong token, a token of a deleted draft, a token on another draft's id and a missing header each answer 404 with the same body; no endpoint returns a draft without its token; no token is stored in clear (API tests).
- **SC-004**: The 6th link e-mail within an hour for one draft is refused (429) while the draft's save succeeds; a reminder is sent to 100% of due drafts and to 0% of reminded or sent drafts, and a second run the same day sends nothing (API tests on a real database).
- **SC-005**: Of two saves to one draft the later wins every time, and a device that opens a link shows the server copy, not its own (API test; unit test of the page's take-over).
- **SC-006**: The clean-up deletes 100% of unsent drafts 90 days old or more together with every file whose key they hold, and 0% of newer or sent drafts (API test with the storage in the test stack).
- **SC-007**: The e-mail field, the button, the notes and the two error pages pass the phone sweep at 320 px and 390 px, tablet and desktop, light and dark, Romanian and English, with no sideways scroll (PR QA run).

## Assumptions

- The Build brief is the scope: the other fields of step 1 (its own story), photo uploads (their story), creating the account and sending the listing (their story) are not built here; this story stores the `submitted` status and reacts to it, and the sending story sets it (autonomous default).
- The form holds no field today (108 built the skeleton), so "every field, tick and photo comes back" is met by the store's shape (one section per step plus the survey answers, photos as file keys) and the e-mail field; each later story writes its fields into that store (autonomous default).
- The link opens `/<lang>/list-your-garage?draft=<token>`, the page's address in the repo, not the brief's `…/listeaza-service` (autonomous default; recorded in Clarifications).
- Every "proposed" default of the brief is taken as written: 1 s browser autosave, 5 s server save and on leaving a step, 256 KB data limit, 32-byte token with hashed storage and `X-Listing-Token`, older tokens valid until sent, 5 link e-mails per draft per hour, the texts of the notes, the subject of the link e-mail, 90-day retention pending the lawyer, the device that opens a link taking the server copy (autonomous default).
- The reminder is one e-mail 3 days after the last change (autonomous default; the brief's one open question). The reminder's link does not count toward the 5-per-hour cap.
- The notifications service today addresses accounts; the direct send to a bare address is this story's smallest addition to it, for its two types only (Principle I), and it writes no NOTIFICATION row tied to an account; what it records is the plan's matter (autonomous default).
- The templates for LISTING_CONTINUE_LINK and LISTING_REMINDER are added here in Romanian and English, in the layout of the message-templates story (autonomous default).
- The browser copy lives in the browser's own storage for the site, one entry for the form, read and written only when the page is open; a thrown or empty storage is handled as FR-003 says (autonomous default).
- The e-mail is not confirmed before the link is sent: the link carries only the key, and reaching the inbox is the proof (the brief's rule).
- Photos' file keys use the draft id as the storage owner id, so the clean-up deletes exactly the draft's files; the photo story confirms this when it arrives (autonomous default).
- No audit history and no outbox event while there is no account (the brief); what was entered is recorded once, as starting values, by the account-creation story.
- Every timestamp is stored in UTC; "3 days" and "90 days" are measured from `updated_at` by the daily timers in the scheduler module (autonomous default).
