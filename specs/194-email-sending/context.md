# Feature Context: Set up e-mail sending

- **Feature**: 194-email-sending
- **Anchor**: ST-194 Set up e-mail sending — https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f (feature page "Notifications and reminders" https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707) | terms: Brevo, notification, outbox, quiet hours, bounce webhook
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature partial (page is 58k characters and does not fetch; read through `notion-search` excerpts only, so the rules list and the 75-row catalogue were not read in full) | epic ok | architecture ok (Architecture decisions, Security, scheduled-work sequence page whole; Backend architecture and Data model by excerpt only) | decisions partial (Architecture decisions whole; Open decisions page by excerpt only)
- **Overall confidence**: medium

## Story

- **ST-194 Set up e-mail sending** — status Planning (PR #59 linked), priority Highest, role System, 8 points, labels backend, outside service, epic EP-1 Foundations, feature Notifications and reminders. Page last edited 2026-10-04T17:44Z; build-timeline row (lane D · Messaging, W2, blocked by ST-79 only) edited 2026-10-04T17:43Z.
- Scope per the story (its Build brief "wins" over the criteria above it): one shared service that takes an event and sends an e-mail; features never send themselves; a test e-mail reaches each of the four roles; a message goes out within a minute; a kind can be always-sent (VERIFICATION_RESULT); each message is recorded with recipient, kind, subject, channel and sent time. Build brief scope: NOTIFICATION table, `NOTIFICATION_TYPES`, the worker `notifications` queue "fed by the outbox relay", Brevo adapter, always-sent flag, grouping, retries, fallback hooks, quiet hours [X25], admin-only test endpoint, direct sends for e-mail check and password reset. Thirteen acceptance scenarios; tests listed: Jest unit and API, a contract test of the Brevo adapter against a recorded mock, and a Playwright end-to-end ("an admin sends the test message to a driver; the e-mail arrives in the test mailbox; the driver's bell shows it").
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) returned no comments on the story or on the feature page.

## Decisions

- Brevo sends e-mail (and SMS, WhatsApp, push); the owner's decision on T3, "an EU company with every launch channel in one account" — [Architecture decisions, A18 and T3] (2026-10-03, decided; page edited 2026-10-04, confidence: high)
- Quiet hours are applied once, in the notifications worker: non-urgent messages (reminders, news, review invites) are held 22:00-08:00 Europe/Bucharest, urgent ones go at once. Given (X25); "where it is applied" is proposed — [Architecture decisions, A37; story Notes and Rules] (2026-10-03, confidence: high)
  - superseded by: the story's own "quiet hours ... To decide" open question, replaced by "Decided 2026-10-03" on the same page
- Hosting is Railway in an EU region with PostgreSQL and Redis from Railway's templates; every provider touching personal data needs a data processing agreement, Brevo included — [Architecture decisions A16, A25; Security, Privacy] (2026-10-03, confidence: high)

## Constraints

- The e-mail sending domain is not chosen (S10, owner). Until then production sending stays off by configuration; ST-279 "Make MotorFix e-mails reach the inbox" (To do) cannot finish before S10, and sets the sender as "MotorFix" from a no-reply address on a subdomain, replies to the support address (proposed). Staging may use a Brevo test sender (proposed). The story needs a Brevo account and API key that the owner holds — [story Build brief States and errors; build-timeline row; ST-279; Foundations Build plan, Risks] (2026-10-04, confidence: high)
- Feature page state machine (excerpt): `held` becomes `queued` when send_after (08:00) is reached; `queued` becomes `sent` when Brevo accepts, or `failed` when refused or bounced; "Brevo is down. Jobs retry 5 times with backoff (1, 5, 15, 60, 240 minutes)"; "a fallback creates a new row with fallback_of"; a JOB_READY at 23:10 goes at once; the retry schedule and window are marked proposed — [Notifications and reminders, States] (2026-10-03, confidence: medium: excerpts only)
- Direct sends (sign-in code, listing continue link, password e-mails) go straight to the notifications queue, not through the outbox; the Backend architecture marks this "(proposed)". Redis is not backed up and can be emptied: "queued work is rebuilt from the outbox and the schedules", which does not cover a direct send — [Backend architecture, Events; Security, Backups and recovery; Sequence diagrams: hot paths §3] (2026-10-03, confidence: medium)
- Logs are "structured logs, no personal data"; one request id travels API to outbox to queue to worker; secrets live in the host's secret store with separate staging and production keys; a message never contains another person's number plate. The Security page has no webhook-specific rule — [Security, performance and operations, Measures, Privacy, Watching production] (2026-10-03, confidence: high). The system overview says local development uses "a local mail catcher" and fakes outside services — [System overview] (2026-10-03, confidence: low: excerpt)

## Prior Art

- ST-257 (outbox relay and live events) owns the relay into this queue; the timeline row says "ST-257 wires the outbox relay into this queue" — [build-timeline row ST-194] (2026-10-04). Status of ST-257 not read.
- ST-79 (accounts and roles, the recipients) is the only blocker on the timeline row; ST-81 (confirm e-mail) and ST-127 (reset password) consume the direct send; ST-195 templates, ST-197 preferences, ST-196 push, ST-198 SMS/WhatsApp, ST-199 bell and the scheduler story are listed "Out of scope" — [story Build brief, Depends on and Out of scope] (2026-10-04). Their statuses were not read.
- The mock sends nothing: "No message is actually sent" — [story Notes] (2026-10-04). No screens are designed.

## Open Decisions

- A9: "Background work with BullMQ in a separate worker process" is **Proposed**, not Given — blocks: the `notifications` queue technology and the retry/schedule mechanism (FR-008, FR-017); the plan must confirm it.
- S10: sending domain, owner — blocks: production sending (FR-015, spec Story 7) and ST-279.
- The 5-minute window, the 1/5/15/60/240 retries, concurrency 10, the 10-second timeout, `urgent` as a flag name, TEST_MESSAGE, the admin endpoint path, the webhook path and `email_bounced_at` are all "(proposed)" in the story — the owner may change them.

## Contradictions with spec.md

- **spec.md** (written 2026-10-04, time not determined): "The first notification of a groupable type goes at once; the ones that follow it ... go out as one e-mail" and Assumptions "a burst of three is two e-mails, not one" (FR-009, SC-004) — **Notion**: story scenario 4 "three QUOTE_RECEIVED for the same driver within 5 minutes ... one e-mail '3 oferte noi' goes and the bell has three rows" [ST-194 Build brief] (2026-10-04T17:44Z). The feature page excerpt reads "...type for the same person within 5 minutes (proposed window) go out as one message" [Notifications and reminders] (2026-10-03); its preceding words, which would say whether the first goes at once, were not readable. Newer: unclear. The spec and the story agree that grouping applies only to groupable types and that scenario 1 needs a send within 60 seconds, so only the count differs (two e-mails versus one).

## Proposed Clarifications (this command's proposals, not requirements)

- Grouping: is the first QUOTE_RECEIVED sent at once with the rest grouped (spec), or are all three held until the window closes (story scenario 4)? If all are held, scenario 1's 60-second test needs a window shorter than a minute or an exception. — from the contradiction above
- Should the BullMQ choice (A9, Proposed) be confirmed in the plan, with the quiet-hours, retry and window values as configuration rather than constants? — from A9 and the "(proposed)" defaults
- A direct ACCOUNT_EMAIL job is lost if Redis is emptied before the worker writes its row, and the outbox cannot rebuild it. Should the direct send write its `queued` rows in the caller's transaction? — from Backend architecture and Security, Backups
- ST-279 wants "bounces and complaints from Brevo" to reach MotorFix; FR-014 handles only `hard_bounce`. Should complaint (spam) events also be recorded? — from ST-279 acceptance scenario 7
- The story says Setări can show "Adresa de e-mail nu primește mesaje" after a bounce; this story has no screen. Should the API expose `email_bounced_at` to the account read model now, or is that left to the settings story? — from story scenario 7

## Gaps

- [NEEDS CLARIFICATION: how Brevo authenticates its webhook calls (Brevo documents this, Notion does not); the spec assumes a shared secret in a header]
- The NOTIFICATION column types and constraints: the Data model page (84k characters) does not fetch and its excerpts show relationships only; column names came from the story's Build brief "Data".
- The notification catalogue (75 rows) and the feature page's final rules 1-17 were not read in full, so FR-001's lists are checked only against the story's quiet-hours lists, which match.
- The EU region requirement for Brevo itself (as opposed to hosting) is stated only as "an EU company"; no page names a Brevo data region setting.

## Sources

- Set up e-mail sending (story ST-194) — https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f
- Notifications and reminders (feature) — https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1
- Foundations (epic EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Set up e-mail sending (EP-1 build timeline row) — https://app.notion.com/p/3ee607bff0d281459f43fe5920c809d2
- Make MotorFix e-mails reach the inbox (ST-279) — https://app.notion.com/p/3ee607bff0d281fbbf8ae3e746620c8a
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Sequence diagrams: onboarding, trust and scheduled work — https://app.notion.com/p/3ee607bff0d281089735ec9e79ee0a88
- Sequence diagrams: hot paths — https://app.notion.com/p/3ee607bff0d281228f49e21c9276591d
- Backend architecture (excerpts) — https://app.notion.com/p/3ee607bff0d281dfa162cd4b9983dd2e
- Data model (excerpts) — https://app.notion.com/p/3ee607bff0d281a386aeea19ef79cf34
- Technology stack (excerpts) — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- System overview (excerpt) — https://app.notion.com/p/3ee607bff0d28161a43cc77282ccc8c1
- Open decisions (excerpt) — https://app.notion.com/p/3ee607bff0d2817d95ebd3b142c1de11
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr

## Refresh 2026-10-04

No changes since 2026-10-04. Re-read the story (body and comments, all blocks, resolved included), the feature page's comments and a workspace search over the notification pages. The story's body matches what is recorded above. Its Status is now Implementing, which is the move this run's own lifecycle made, so it is not reported as a change. Priority is still Highest. The story and its timeline row show an edit at 18:00Z, which is that status write. No comment exists on the story or the feature page. The feature page (last edited 2026-10-03T18:53Z), the epic (2026-10-03T19:24Z), ST-279 (2026-10-03T18:52Z) and the sibling notification stories were last edited on or before 2026-10-03, so no page changed after the digest was gathered.
