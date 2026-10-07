# Feature Context: Auth events through the event port

- **Feature**: 569-auth-events-through-event-port
- **Anchor**: ST-569 Record password-reset and session events through the event port — https://app.notion.com/p/3f0607bff0d28111a434e75fcd9c94d3 | terms: password reset, session.revoked, outbox, EVENT_PORT
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic partial (page 61k chars, over the tool limit; not read) | architecture partial (Architecture decisions ok; Backend architecture 94k chars, read only through targeted search highlights) | decisions ok
- **Overall confidence**: medium

## Story

- **ST-569 Record password-reset and session events through the event port** — status Planning, priority Low, role System, epic Foundations, labels backend, real-time; PR #187
- Scope per the story (page edited 2026-10-07): "A completed reset records no domain event through `EVENT_PORT` inside its transaction (as `signOutEverywhere` does), and its `password_changed` e-mail and `session.revoked` live message go out after the commit rather than through an outbox row (Constitution VI). Sign-in's own `session.revoked` publish follows the same pattern, so decide once for the auth flows." Where: `password-reset.service.ts` (`complete`, `announce`), `sign-in.service.ts`.
- Comments that moved scope: none (page has no discussions).

## Decisions

- ST-127 (Done) says the reset "Emits: none; both e-mails go straight to the `notifications` queue" — [Reset a forgotten password, Build brief > Events and notifications] (2026-10-05, confidence: high)
  - This is the only statement about the password_changed e-mail path. It is older than ST-569 (2026-10-07) but ST-569 only asks for the event and says to "decide once"; it does not order the e-mail onto the outbox.
- Account e-mails (e-mail check, password reset) "go straight to the queue, not through the outbox. It cannot be muted and is never grouped" — [Set up e-mail sending (ST-194), scenario 8] (2026-10-04, confidence: high). Backend architecture repeats it: password e-mails "go straight to the notifications queue" (search highlight, 2026-10-03, confidence: medium).
- Sign-out everywhere: "Emits: no outbox event. A `session_revoked` message (proposed) is published straight to Redis on `account:{accountId}`, like job locks, so open tabs drop their session." — [Sign out ... (ST-128), Events and notifications] (2026-10-04, confidence: high)
- Reset live update: "the account's other open tabs sign out (the `session_revoked` message of" the sign-out story) — [ST-127, Live updates] (2026-10-05, confidence: high). So `session.revoked` is meant to be a direct Redis publish for both flows, not an outbox row.
- A7: "Events through a transactional outbox, carried by Redis. A change and its event are saved together, so none is lost even if Redis is down." (Proposed) — [Architecture decisions, A7] (2026-10-04, confidence: high)
- Outbox rule: "a backend call that records an event inside the use case's own transaction", typed catalogue, "All kinds are typed now"; kind names follow `area.verb_past`; payload "ids and small facts only, never personal data" — [ST-257, Build brief] (2026-10-05, confidence: high)

## Constraints

- No Notion page defines an `account.password_reset` or password-changed domain event. The ST-127 and Accounts-feature event lists name `account.created`, `account.deleted`, `invite.*`, `mechanic.updated`, `member.removed` — [Accounts, roles and sign-in, Build brief > Data and events] (2026-10-03, confidence: high). Backend architecture's Events list shows `account.suspended`, `account.restored`, `account.access_reset`, `account.watch_started`, `account.watch_cleared`, with no `password_reset` kind in the part read — [Backend architecture, search highlight] (2026-10-03, confidence: medium; page not read in full). `account.access_reset` is the admin "Resetează accesul" action, a different thing.
- Event names for the new kind are a spec-level proposal; ST-257 says "The full list is the Backend architecture events list (canon §3)", so a new kind belongs there too — [ST-257, Rules] (2026-10-05, confidence: medium).
- Accounts feature rule 16: "Every account change is recorded in the audit history"; ST-127 Audit history: "password reset" without any value — [ST-127 Data; Accounts feature rule 16] (high).
- REFRESH_TOKEN is "revoked by sign-out, sign-out on all devices, a password reset or deletion" — [Accounts feature, States and lifecycle] (2026-10-03, high). A missed live nudge is bounded by the 15-minute access token ([ST-128 scenario 3], high).
- "Sending a notification is not a change in the app: it is not written to the audit history" and the outbox relay hands registered kinds to the `notifications` queue through a consumer registry — [ST-194 Rules; ST-257 scenario 7] (high). This is the route an outbox-driven e-mail would take, but ST-194 only registers direct sends for ACCOUNT_EMAIL.

## Prior Art

- ST-257 (Done, PR #77): OUTBOX_EVENT, `EventsService.record(tx, …)`, relay and typed catalogue — [ST-257] (2026-10-05).
- ST-128 sign-out everywhere (Done, PR #66): audit entry, direct `session_revoked` publish — [ST-128] (2026-10-04).
- ST-579 (To do, Low): same debt class, `account.email_confirmed` is published straight to Redis outside the transaction; "record it through the outbox and add the kind to the catalogue" — [Tech debt ST-257, 2026-10-05]. Also ST-197 tech debt for `notification_preferences.updated` (search hit, not opened). Together with ST-569 they show the owner's pattern: stored changes go to the outbox.

## Open Decisions

- none found that this feature depends on. Architecture decisions T1–T12 do not touch auth events.

## Contradictions with spec.md

- **spec.md** (2026-10-07): "`session.revoked` ... not an event kind of the catalogue, published straight to the live fan-out after the commit" — **Notion**: agrees (ST-127 and ST-128 Build briefs, both Done). No contradiction.
- **spec.md** (2026-10-07): password_changed e-mail stays direct — **Notion**: agrees (ST-127, ST-194 scenario 8). No contradiction.
- **spec.md** FR-001 names `account.password_reset` — **Notion**: the kind is not in any page read; ST-127 says "Emits: none". Not a contradiction (ST-569, newer, asks for an event), but the Notion event docs are stale for this kind. Newer: Notion task ST-569 (2026-10-07, wording) vs spec.md same day.
- Naming: ST-128 and the Accounts feature write `session_revoked` (underscore, "proposed"); spec.md and the story write `session.revoked` (dot). Same date range unclear (Notion 2026-10-04, spec 2026-10-07). Recorded, not resolved.

## Proposed Clarifications (this command's proposals, not requirements)

- Add `account.password_reset` to the Backend architecture events list, and set ST-127's "Emits: none" to the new event, when this ships — from the finding that no page defines the kind.
- Keep `session.revoked` as a direct Redis publish for sign-in, sign-out everywhere and reset (the Notion briefs say so); confirm that "decide once" means one shared helper, not an outbox row — from ST-128 and ST-127 Live updates.
- Confirm the password_changed e-mail stays a direct queue send, since ST-194 and ST-127 both say so and no page asks for an outbox consumer — from ST-194 scenario 8.
- Settle `session.revoked` vs `session_revoked` spelling in the docs — from the naming contradiction.

## Gaps

- The Foundations epic page and the Backend architecture page were too large for the connector; the Events list and Live channels sections were seen only through search highlights. [NEEDS CLARIFICATION: does the Backend architecture Events list or Live channels table contain a `password_reset` or `session.revoked` row with a path (outbox vs direct)?]
- Sign-in's own `session.revoked` publish: no Notion page describes one (the ST-ASK says it exists in code). Not found in the sign-in story's search highlights.

## Sources

- Record password-reset and session events through the event port (ST-569) — https://app.notion.com/p/3f0607bff0d28111a434e75fcd9c94d3
- Reset a forgotten password (ST-127) — https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619
- Sign out, on this device or on all devices (ST-128) — https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7
- Accounts, roles and sign-in — https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc
- Set up e-mail sending (ST-194) — https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f
- Give features one way to publish and receive live events (ST-257) — https://app.notion.com/p/3ee607bff0d281a3a201dcc26213ceac
- Tech debt ST-579 — https://app.notion.com/p/3f0607bff0d281c1a09ec67b308f6b4a
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Backend architecture (partial) — https://app.notion.com/p/3ee607bff0d281dfa162cd4b9983dd2e
