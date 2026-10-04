# Feature Context: Real-time connection to open dashboards

- **Feature**: 253-live-connection
- **Anchor**: ST-253 "Set up the real-time connection to open dashboards" — https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49 | terms: live, server-sent events, dashboard, Redis, heartbeat
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Architecture decisions; Technology stack, Security and Backend architecture not fetched whole) | decisions partial (Decisions and ideas page not read; decisions taken from the story, the feature page and Architecture decisions, which repeat them with dates)
- **Overall confidence**: high

## Story

- **ST-253 Set up the real-time connection to open dashboards** — status Planning, priority Highest, role System, epic EP-1 Foundations, 8 points, labels front end / backend / real-time, PR https://github.com/george-hutanu/motor-fix/pull/57, page last edited 2026-10-04T16:55Z
- Scope per the story: "So that a change made by one person can show on another person's open screen, we need a real-time connection from the server to every open dashboard." Criteria: every open dashboard of a signed-in person keeps a live connection; a change shows on another person's screen within two seconds; a test live update shows on the open dashboard of each role (driver, garage, mechanic, admin); each event carries kind, object id and time; (proposed) a screen loads current state first, live updates on top; the same screen open on two devices of one person updates on both. The Build brief "wins over" everything above it.
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) returned no discussions on the story or on the feature page.

## Decisions

- Live updates use server-sent events, one connection per browser tab, server to screen only — [Architecture decisions A8; feature page "Final rules" 1] (2026-10-04 / 2026-10-03, confidence: high)
- Wire format: SSE `event:` line for the kind plus one `data:` line `{ "kind", "id", "at" }`, no personal data; headers `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` — [ST-253 Build brief, Rules and validation] (2026-10-04, high)
- Channels at connect: account, garage memberships for the active role (ST-394), the mechanic row, admin, system; `account:{id}` + `system` for everyone, `garage:{id}` for staff, `mechanic:{id}` for a mechanic, `admin` for an admin — [ST-253 Build brief, scenarios 1-2] (2026-10-04, high)
- No valid token answers 401 and no stream; only a MotorFix admin may send the test event, anyone else gets 404 (`POST /api/v1/admin/live/test` is marked proposed) — [ST-253 Build brief, Who can do it] (2026-10-04, high)
- Redis: one pub/sub channel, `live:events` (proposed); each message holds the event and its audience as a list of channel keys; each API copy forwards only to its own connections, each exactly once — [ST-253 Build brief, Rules; scenario 8] (2026-10-04, high)
- Test event `live.test` is "published straight to Redis" from the admin endpoint, not through the outbox; nothing is written to the database; connections live in API-copy memory — [ST-253 Build brief, Events; Data] (2026-10-04, high)
- Angular side: one `live` library in `apps/web`, a fetch-based SSE reader with the `Authorization` header (EventSource cannot send the in-memory token); never the token in the URL; the test toast uses the shared Toast on DashClient, DashGarage, DashMech and DashAdmin shells — [ST-253 Build brief, Rules; Screens; feature page "PrimeNG components"] (2026-10-04, high)
- A8 amended: a full two-way chat is deferred, so SSE stands for launch; public pages will use the same SSE (a separate `GET /api/v1/live/public`, not this story) — [Architecture decisions A8] (2026-10-03, high)
- Error shape is RFC 9457 problem details with a snake_case `code` (A28, A42); another person's resource answers 404 across garages, 403 within one garage's staff (A31, A34) — [Architecture decisions] (2026-10-03, medium: proposed, not Given)

## Constraints

- Token lifetime: access token 15 minutes, held in memory; the server ends the stream at expiry and the client renews and reconnects within 3 seconds (proposed), once — [ST-253 Build brief scenario 6; ST-82 search excerpt "ACCESS_TOKEN_MINUTES"] (2026-10-04, high)
- Heartbeat: comment line every 25 s of silence (proposed); cap of 10 streams per account, the oldest closed (proposed) — [ST-253 Build brief scenarios 7, 9; feature page "Many tabs"] (2026-10-04, medium)
- Redis down: the stream stays open with heartbeats only; on API shutdown the copy closes its streams cleanly and clients reconnect elsewhere — [ST-253 Build brief, States and errors] (2026-10-04, high)
- Reads ACCOUNT, ACCOUNT_ROLE, GARAGE_MEMBER, MECHANIC to work out channels; writes nothing; no audit entry ("Opening a connection is not a change") — [ST-253 Build brief, Data] (2026-10-04, high)
- Target: under 2 seconds from publish to screen; Jest tests for 401, channels per role, heartbeat timing, end at expiry, the 10-stream cap, 404 for non-admins, two API instances on one Redis; Playwright with two contexts — [ST-253 Build brief, Tests] (2026-10-04, high)
- Fail closed is the rule for audiences (event with no audience dropped and logged); a suspended or deleted account's connections close and a role switch reconnects with the new role's channels — [ST-254 Build brief, scenarios 7-9, "proposed"] (2026-10-03, medium; ST-254 scope, not ST-253)
- Epic exit check: "A test live update appears on an open screen without a reload" for each of driver, garage owner, mechanic and admin — [EP-1 Foundations, Exit check] (2026-10-03, high)

## Prior Art

- ST-252 "Decide: WebSocket or server-sent events" — Done (A8) — [feature page; EP-1 Entry criteria] (2026-10-03)
- ST-82 sign-in (access and refresh tokens) and ST-79 account model and roles — blockers named Done in the spec (PR #45, PR #3); not re-verified in Notion here (ST-82 page edited 2026-10-04T15:42Z) — [ST-82 search excerpt]
- Mock: no server; photos, clips, streams, language and copy voice stay in step between tabs of one browser only. Design link not opened — [feature page "In the mock"] (2026-10-03)
- Boundaries, all To do: ST-254 audiences and per-event filtering (3 pts); ST-255 reconnect with backoff 1/2/5/10/30 s, polling fallback after 3 failed tries, re-read on wake, offline actions (5 pts, states `open` -> `reconnecting` -> `polling`); ST-257 OUTBOX_EVENT, relay, `LiveService.on` and `liveResource`, typed catalogue (3 pts); ST-256 updates in place; ST-419 public stream (EP-4). ST-257 scenario 10 later re-routes the test event through the outbox — [ST-254, ST-255, ST-257 pages] (2026-10-03)

## Open Decisions

- Both the story and the feature page say "Open: None". Numbered open decisions page not read (too large to fetch); none found that this story depends on.
- Items marked *(proposed)* the plan should confirm: `POST /api/v1/admin/live/test` path, `hello` message with connection id, fetch-based reader, `live:events` name, `live.test` kind, 3-second reconnect, 25 s heartbeat, 10-stream cap — blocks: wire names in the contract and OpenAPI.

## Contradictions with spec.md

- **spec.md** (created 2026-10-04): "read 2026-10-04 (last edited 2026-10-04 15:43)" — **Notion**: the story page is now last edited 2026-10-04T16:55Z (status Planning, PR #57 linked) [ST-253] — newer: Notion; the spec's reading of the story is stale by about 70 minutes and what changed is not visible in the page (no comment, no revision list). Re-check the Build brief against spec.md.
- **spec.md** FR-015: "Every dashboard (driver, garage, admin areas) MUST show the shared toast" — **Notion**: the story criterion and brief scenario 3 require the toast on all four dashboards including the mechanic's, and the Screens section lists DashMech [ST-253 criteria; Build brief scenarios 2-3; Screens] (2026-10-04) — newer: Notion (spec Created 2026-10-04 predates the 16:55 edit); mechanic dashboard missing from FR-015.
- **spec.md** Assumption: the 10-stream cap "is counted per API copy" — **Notion**: "an account already has 10 open streams ... the oldest is closed" and "up to 10 connections per account" with no per-copy qualifier [ST-253 scenario 9; feature page "Many tabs"] (2026-10-04) — newer: Notion; the spec narrows it. Low severity: the spec's reason (one copy deployed) is sound.
- **spec.md** FR-002 / scenario 4: 403 for a suspended account — **Notion**: ST-253 names only 401; suspended-account handling appears as a "proposed" connection close in ST-254 [ST-254 scenario 8] (2026-10-03) — newer: spec.md on this point, no Notion contradiction; recorded as an addition, not a conflict.

## Proposed Clarifications (this command's proposals, not requirements)

- Re-read the ST-253 Build brief (edited after the spec's cited read) and confirm no criterion changed — from the first contradiction.
- Add the mechanic dashboard to FR-015, or state that the mechanic's toast shows in the garage dashboard until release 2 (W01 moves mechanic work to the garage dashboard at launch) — from the FR-015 contradiction.
- Confirm that the 10-stream cap is per account on one API copy and that cross-copy counting is deferred to ST-255 — from the cap contradiction.
- Decide whether `hello` is part of the stable wire contract, given ST-255 and ST-257 build on it and the brief marks it proposed.
- Keep the test endpoint publishing direct to Redis here, with ST-257 moving it behind the outbox, so ST-253 carries no outbox code — from ST-257 scenario 10.

## Gaps

- [NEEDS CLARIFICATION: ST-394 (role switch) was not fetched; the brief defers "garage memberships for the active role" to it. Check whether the spec's `roleInUse` assumption matches its brief.]
- The Security page, Technology stack and Backend architecture (events list canon section 3) were not read; the A8 row and the story's Build brief carried the decision text.
- Whether PrimeNG or Spartan UI supplies the shared Toast: the feature page's "PrimeNG components" toggle (2026-10-03) predates the A1 amendment to Spartan UI (2026-10-04); A1 wins as the newer source.

## Sources

- Set up the real-time connection to open dashboards (ST-253) — https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49
- Live updates between screens (feature MF-52) — https://app.notion.com/p/3ee607bff0d281de9544d2b4e8331043
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Send live updates only to the people involved (ST-254) — https://app.notion.com/p/3ee607bff0d281769e64ff763a743def
- Get back in step after a lost connection (ST-255) — https://app.notion.com/p/3ee607bff0d2810ba16cdf47e382046a
- Give features one way to publish and receive live events (ST-257) — https://app.notion.com/p/3ee607bff0d281a3a201dcc26213ceac
- Sign in with e-mail and password (ST-82, search excerpt only) — https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908
