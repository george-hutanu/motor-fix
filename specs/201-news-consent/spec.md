# Feature Specification: Get MotorFix news only with my consent and stop it in one click

**Feature Branch**: `201-news-consent`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-201 Get MotorFix news only with my consent and stop it in one click (Notion story https://app.notion.com/p/3ee607bff0d2812eb821e9c31b7f0b23, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Consent recorded when news is turned on and withdrawn when it is turned off, a one-click stop in every news e-mail with no sign-in, the NEWS type by e-mail only, and an admin-only send that refuses a second news e-mail in the same month."

**Sources**: Notion story ST-201, read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d281868347eea0306104ef (lane D · Messaging, W5, 3 points, blocked by ST-194, ST-195 and ST-197, all merged; "Before launch: operator company (S8) and the lawyer's review of the consent text."). The preference store of ST-197 (`libs/domain/src/notifications/preferences*.ts`), the pipeline of ST-194 (`notifications.service.ts`, `notifications.processor.ts`) and the templates of ST-195 (`templates.ts`, `templates/registry.ts`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A driver agrees to news, and only then gets it (Priority: P1)

A driver's "Noutăți MotorFix" switch is off until they turn it on and confirm the consent text. Turning it on records when they agreed and to which version of the text; turning it off withdraws the consent. News is separate from the messages about their own cars and jobs.

**Why this priority**: sending news without recorded consent is unlawful marketing mail; everything else in the story rests on the record.

**Independent Test**: through the API, read a new driver's preferences, try to turn news on without the consent version, turn it on with it, then off, and read the rows and the audit history.

**Acceptance Scenarios**:

1. **Given** a new driver, **When** they read their preferences, **Then** news is off, the consent state is `none`, and no news is sent to them.
2. **Given** the driver turns news on and confirms the consent text, **When** it saves, **Then** NEWS by e-mail is enabled with consent given at now, the text version shown and the source `settings`, and the audit history records it.
3. **Given** a save that turns news on without the current consent text version, **When** it is processed, **Then** it answers 422 `news_consent_required` and nothing changes.
4. **Given** a driver who consented turns the switch off, **When** it saves, **Then** consent is withdrawn (withdrawn at now, news off) exactly as with the link, and other groups are untouched.
5. **Given** a driver who withdrew turns it on again, **When** it saves with the consent version, **Then** consent is given again with a new given-at.

---

### User Story 2 - One click in the e-mail stops news, with no sign-in (Priority: P1)

Every news e-mail carries a visible "Nu mai vreau noutăți" link and the headers mail apps use for one-click unsubscribe. Opening the link stops news at once, with no sign-in and no further click.

**Why this priority**: the acceptance criteria and the law require a one-click stop in every marketing e-mail.

**Independent Test**: sign an unsubscribe token for a consenting driver, POST it to the unsubscribe route without a session, read the row; open the web page with the token; try a token with a bad signature.

**Acceptance Scenarios**:

1. **Given** a news e-mail, **When** it is sent, **Then** it has the visible link "Nu mai vreau noutăți" (EN "Stop MotorFix news") to the unsubscribe page, plus the `List-Unsubscribe` and `List-Unsubscribe-Post` headers; no other type's e-mail carries those headers.
2. **Given** a driver opens that link, **When** the page loads, **Then** consent is withdrawn with no sign-in and no further click, and the page says "Nu vei mai primi noutăți MotorFix".
3. **Given** an unsubscribe link with a bad signature, **When** it opens, **Then** the page says the link is not valid and nothing changes.
4. **Given** a link opened a second time, **When** it loads, **Then** the page says the same as the first time and nothing more is recorded.

---

### User Story 3 - An admin sends news at most once a month, to consenting drivers only (Priority: P2)

Only a MotorFix admin can send news, through the API (no screen at launch). Each consenting driver gets it in their own language; nobody else gets it.

**Why this priority**: the send is what the consent and the stop exist for, but it is used rarely and by the team only.

**Independent Test**: create consenting, non-consenting, withdrawn and staff-only accounts, send news as an admin, read the NOTIFICATION rows; send again in the same month and in the next; call the route as a driver and without a session.

**Acceptance Scenarios**:

1. **Given** consenting drivers in Romanian and English, **When** an admin sends news with both languages' texts, **Then** each gets one NEWS e-mail in their language, and nobody who did not consent (or withdrew) gets anything.
2. **Given** a news e-mail went out on 5 November 2026, **When** an admin tries to send another on 20 November, **Then** it answers 409 `news_already_sent_this_month`; a send on 1 December is allowed.
3. **Given** a garage owner, receptionist, mechanic or admin, **When** news goes, **Then** they get it only if they are also drivers who consented.
4. **Given** a caller who is not an admin, **When** they call the send, **Then** it answers 404; without a session, 401.
5. **Given** a send started between 22:00 and 08:00 Europe/Bucharest, **When** it is processed, **Then** its e-mails wait until 08:00 (the quiet-hours rule NEWS already has).

---

### Edge Cases

- A news save that turns other groups on or off at the same time: only the news part needs the consent version; the rest saves as before.
- The NEWS type chosen on a channel other than e-mail: refused as today (`channel_not_allowed`, NEWS goes by e-mail only).
- An unsubscribe token for an account that no longer exists or never consented: answered as a success, nothing changes (the page cannot tell anyone whether an account exists).
- A token cut short, with no dot, or not base64url: the same as a bad signature (400 `invalid_unsubscribe_link`).
- Two admin sends at once in the same month: one wins, the other answers 409.
- A send when no driver consented: allowed, it counts as the month's send, and reports 0 recipients.
- A consenting driver with no e-mail address: skipped by the pipeline (no address), as for every other e-mail.
- Mail apps' one-click POST carries the form body `List-Unsubscribe=One-Click`: the route accepts it and ignores the body.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A NEWS preference row MUST hold, besides enabled, when consent was given, which consent text version was shown, where it was given (`settings`), and when it was withdrawn. The preferences read MUST answer the news consent state (`none`, `given`, `withdrawn`) with those times and the version, and the current consent text version.
- **FR-002**: A preferences save that turns NEWS from off to on (its group or its type) MUST carry the current consent text version; without it, or with another one, it MUST answer 422 `news_consent_required` and change nothing. Turning it on MUST record consent given at now, the version and the source `settings`, and clear the withdrawal.
- **FR-003**: A preferences save that turns NEWS off MUST record the withdrawal at now and keep when and to which version consent was given. Turning news on or off MUST NOT change any other group or type.
- **FR-004**: `POST /api/v1/notification-preferences/unsubscribe?token=…` MUST work with no session. A token whose signature is good MUST switch NEWS off with the withdrawal recorded at now, and answer 204; repeating it MUST answer 204 and record nothing more; a token for an account with no consent, or no account, MUST answer 204 and change nothing. A token that is malformed or wrongly signed MUST answer 400 `invalid_unsubscribe_link` and change nothing.
- **FR-005**: An unsubscribe token MUST be signed with HMAC-SHA256 under a key derived from the API's token secret and used for nothing else, MUST name exactly one account, and MUST NOT expire.
- **FR-006**: `POST /api/v1/admin/news` MUST take a title and a text in Romanian and in English, and MUST be refused with 404 for anyone without the admin settings capability and 401 without a session.
- **FR-007**: A news send MUST notify, by e-mail only, every account that is not deleted, has the driver role and whose NEWS consent is given and not withdrawn, each in their own language, and MUST answer 202 with how many drivers it was sent to.
- **FR-008**: At most one news send MUST be accepted per calendar month in Europe/Bucharest, counted at the time the request is accepted; a second MUST answer 409 `news_already_sent_this_month` and send nothing, also when two sends race.
- **FR-009**: Every news e-mail MUST show a visible stop link ("Nu mai vreau noutăți" / "Stop MotorFix news") to the web unsubscribe page for its recipient, and MUST carry the headers `List-Unsubscribe: <one-click URL>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; no other e-mail MUST carry them.
- **FR-010**: The web page `/{lang}/unsubscribe/{token}` MUST, in the browser and with no sign-in, call the unsubscribe route once on opening, then say "Nu vei mai primi noutăți MotorFix" (EN "You will no longer get MotorFix news") on success, that the link is not valid on 400, and offer a retry on any other failure; rendered on the server it MUST show only the busy state. It MUST fit a 320 px phone without sideways scrolling.
- **FR-011**: The audit history MUST record, in the same transaction as the change, each consent given and withdrawn (the time and the text version, and whether by the settings or the link), and each news send (who, when, how many drivers).

### Key Entities

- **Notification preference** (exists, ST-197): gains consent given at, consent text version, consent source and withdrawn at, used by the NEWS row.
- **News send** (new): the month (Europe/Bucharest), who sent it, when, and how many drivers it went to; one per month.
- **Notification** (exists): one NEWS row per channel per consenting driver, carrying the title, the text and the stop links in the driver's language.

## Clarifications

### Session 2026-10-05

- Q: The brief proposes `NEWS_ALREADY_SENT_THIS_MONTH`; every code in the API is lower snake case. → A: `news_already_sent_this_month`; likewise `news_consent_required` and `invalid_unsubscribe_link` (repo convention, `preferences.service.ts`). (autonomous, recommended)
- Q: How does the API know the consent text was shown and confirmed? → A: The save carries `newsConsentTextVersion`, which must equal the current version in `@motor-fix/contracts`; an unknown version is refused, so a stale client cannot record consent to a text it did not show (FR-002). (autonomous default)
- Q: Where does the one-click POST go when the API has no public address of its own? → A: To the web app's address, `PUBLIC_WEB_URL/api/v1/…`: the web server's edge already forwards `/api/` to the API (`apps/web/src/server/edge.ts`). (autonomous default, evidence in code)
- Q: Does the bad-signature page differ from an unknown account's? → A: Yes for a bad signature (400, "not valid"); an unknown or never-consenting account with a good signature answers 204 like a success, so the route never tells whether an account exists. (autonomous default)
- Q: Which capability guards the send? → A: The existing `admin.settings` (admin only), as the admin test message does; the brief asks only that non-admins get 404. (autonomous default, Principle I: no new capability for one route)
- Q: ST-197 already let a NEWS row be saved on with no consent. What becomes of those rows? → A: The migration switches every NEWS row off: no consent text was ever shown, so none exists; a send also requires consent given and not withdrawn (FR-001, FR-007). (autonomous, recommended by spec-challenger)
- Q: Is the consent version needed on every save that carries news on? → A: Only when the save turns news from off to on; news already on with consent is a no-op and records nothing (FR-002). (autonomous, recommended by spec-challenger)
- Q: Which month does a send accepted at 23:30 on 31 October occupy, when quiet hours deliver it on 1 November? → A: The month the admin's request was accepted in, Europe/Bucharest (FR-008). (autonomous, recommended by spec-challenger)
- Q: Who is the audit actor of a withdrawal by the link, which has no session? → A: `system`, with the account as the subject; the entry's value says `via: 'link'` or `via: 'settings'` (FR-011). (autonomous, recommended by spec-challenger)
- Q: What does the send's count mean, and what if it fails halfway? → A: The number of consenting drivers it was sent to. The month is claimed first (its unique row also settles a race); a failure part-way keeps the month taken and is logged, rather than letting a second send reach the same drivers twice. Resuming a failed send is deferred. (autonomous default, Principle I)

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Of four accounts (consenting driver, non-consenting driver, withdrawn driver, consenting-looking garage owner without the driver role), exactly 1 gets a NEWS e-mail row (API test).
- **SC-002**: A second send in the same Bucharest month answers 409 and writes 0 rows; the first send of the next month answers 202 (API test).
- **SC-003**: The unsubscribe route switches news off with no session for a good token and answers 400 with nothing changed for a bad one (API test, 2 of 2).
- **SC-004**: A news e-mail carries both one-click headers and the visible stop link; a test message carries neither header (worker test).

## Assumptions

- The consent dialog under the switch is not built here: the switch's panel (Setări · Notificări) is ST-138 and is not built yet, and the brief says "Until then, test through the API". The API takes the consent version; ST-138's dialog shows the text and sends it. (Build brief › Screens, autonomous default)
- The consent text is the brief's draft, version `2026-10-03`, pending the lawyer's review and the operator company's name (S8), which Launch readiness tracks; a new text is a new version. (Build brief › Open)
- News is still written in the bell for a consenting driver, as every message is (ST-194); it goes outside the app by e-mail only. (autonomous default, `notifications.service.ts` `build`)
- The send runs in the request, one recipient at a time, as the admin test message does; moving it to the queue is for when the audience is large. (autonomous default, Principle I)
- The end-to-end flow "the e-mail arrives and its link stops news" is covered by API and worker integration tests and the web page's own tests: the end-to-end job starts no worker and no mail inbox. The end-to-end test covers the page with a link that is not valid and a driver giving consent through the API. (autonomous default)
- The token is carried in the page's path (as the e-mail check link is) and in the route's query (as the brief proposes). (Build brief › Data)
