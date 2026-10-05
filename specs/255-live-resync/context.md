# Feature Context: Get back in step after a lost connection

- **Feature**: 255-live-resync
- **Anchor**: ST-255 Get back in step after a lost connection — https://app.notion.com/p/3ee607bff0d2810ba16cdf47e382046a | terms: live reconnect, offline actions, Idempotency-Key, IndexedDB, audit history
- **Gathered**: 2026-10-05
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic partial (fetched, 52 KB, not read in full; siblings read one by one) | architecture ok | decisions partial (Architecture decisions read; "Decisions and ideas" not read, the story and feature list "Open: None")
- **Overall confidence**: high

## Story

- **ST-255 Get back in step after a lost connection** — status Planning, priority High, role Driver, epic EP-1 Foundations (MF-52 Live updates between screens), 5 points, PR #103, labels front end / backend / real-time. Page last edited 2026-10-05T08:41Z.
- Scope per the story: the Build brief (current as of 2026-10-03, "wins over anything above it") covers reconnect with backoff, re-reading every open view after reconnect or wake, a 60 s polling fallback, a quiet offline bar, and a queue of small workshop actions sent in order on return of signal. It lives in the shared `live` library. Writes: nothing on the server beyond the waiting actions themselves.
- Comments that moved scope: none. `notion-get-comments` returned no discussions on the story (resolved and child-block discussions included).

## Decisions

- Live transport is server-sent events, one connection per tab; a message carries only `kind`, `id`, `at`, and the view re-reads through the normal API — [Architecture decisions A8; Live updates feature, Final rules 1, 3] (2026-10-04 / 2026-10-03, confidence: high)
- A screen always loads current state first; after a reconnect or when a sleeping tab wakes, open views re-read; "never relies on a missed event being replayed" — [Live updates feature, Final rule 7; ST-255 Build brief, Rules] (2026-10-03, confidence: high)
- If the connection cannot open, dashboards re-read every 60 s. Backoff 1, 2, 5, 10, then 30 s "with a little jitter (proposed)"; polling after 3 failed tries; connection states `open → reconnecting → polling → open` — [Live updates feature, Final rule 10 and state diagram; ST-255 scenarios 2-3] (2026-10-03, confidence: high)
- The work belongs in the shared `live` library of `apps/web`, and the job lock and its 423 belong to ST-395, not here — [Live updates feature, Module; ST-255 Out of scope] (2026-10-03, confidence: high)
- Waiting actions: only tick a job step, change a job's stage, change the estimated finish time *(proposed list)*; kept in IndexedDB up to 24 h *(proposed)*; sent in order, one at a time; each with an `Idempotency-Key`; money, bookings, quotes and reviews need a connection — [ST-255 Build brief, Rules and validation] (2026-10-03, confidence: medium: the list and 24 h are marked proposed)
- Refusals 423, 409, 404 drop the action, show why (example "Elena, mecanic, lucra la această mașină") and show current state — [ST-255 scenario 7] (2026-10-03, confidence: high)
- Errors are RFC 9457 problem details with a stable lower snake case `code` (e.g. `job_locked`) — [Architecture decisions A28, A42] (2026-10-04, confidence: medium: both "Proposed")
  - superseded by: ST-395 Build brief says 423 `JOB_LOCKED` "(proposed code)" (2026-10-03); A42 is newer.
- Another person's resource answers 404 across garages and between drivers; within one garage's staff, an out-of-scope resource answers 403 — [Architecture decisions A31, A34] (2026-10-04, confidence: medium)

## Constraints

- Every create and accept action takes an `Idempotency-Key` header and a repeat returns the first result — [Architecture decisions A32] (2026-10-04, confidence: medium: Proposed). It names "create and accept" actions; tick/stage/finish-time are updates, so their endpoints are not yet said to read the key.
- Uploads (photos, clips) already wait in a queue and retry on a poor connection; they are not part of this queue — [Front end architecture, Patterns › Uploads; ST-255 Rules] (2026-10-03, confidence: high)
- Waiting actions are "checked by the API exactly as if they were sent at once": permissions and locks apply at send time — [ST-255 Build brief, Who can do it] (2026-10-03, confidence: high)
- Lost updates: ST-395 says every job change carries the job's `updated_at` it was based on and a mismatch answers 409 *(proposed)*; a lock holder who loses signal loses the lock after 5 idle minutes and their waiting change is refused if someone else changed the job — [ST-395 Build brief, Rules; Live updates feature, Edge cases] (2026-10-03, confidence: high)
- Audit: a waiting action once accepted is recorded "at the time it is applied", its entry also noting the device time *(proposed)*. ACTIVITY_LOG has no device-time column (fields: kind, text, actor, at, action, subject, field, old/new, scope ids, flags) and is append-only, written by `AuditService.record(tx, …)` in the use case's transaction — [ST-255 Build brief, Data; ST-390 Build brief, Data] (2026-10-04, confidence: medium)
- Live updates change the screen in place and never reset a form or close a drawer; a failed background re-read keeps the old data with no error and retries on the next event or after 60 s *(proposed)* — [ST-256 Build brief, States and errors; Live updates feature, Final rule 8] (2026-10-05, confidence: high)
- Several events within 300 ms collapse into one re-read; `liveResource(apiCall, kinds)` is the helper that re-reads — [ST-257 Build brief, Rules] (2026-10-05, confidence: high)
- Access token expiry ends the stream; the client renews and reconnects within 3 s (ST-253 reconnects once for this; the rest of reconnect belongs to ST-255). Server heartbeat is a comment every 25 s; the server allows 10 connections per account — [ST-253 Build brief, scenarios 6, 7, 9] (2026-10-04, confidence: high)
- Offline bar text and the waiting look of a tick are not designed; "Fără conexiune. Ce vezi poate fi vechi." and "Ai nevoie de conexiune pentru asta" are *(proposed)* texts. The mock has no connection to lose — [ST-255 Notes, Screens] (2026-10-05, confidence: high)
- Front-end dependencies stay free and open source (A1 amended 2026-10-04); the Front end architecture page still says "PrimeNG components are themed through those tokens" (2026-10-03), which A1 supersedes — [Architecture decisions A1; Front end architecture, Patterns] (2026-10-04, confidence: high)

## Prior Art

- ST-253 real-time connection — Done, PR #57 (`GET /api/v1/live`, `hello`, heartbeat, token-expiry reconnect once) — [ST-253] (2026-10-04)
- ST-257 publish/receive events, `liveResource` — Done, PR #77 — [ST-257] (2026-10-05)
- ST-256 updates in place — Done, PR #79 — [ST-256] (2026-10-05)
- ST-159 shared saving/validation/errors — Done, PR #44: forms carry an idempotency key *(proposed)* and show "Nu ești conectat. Încearcă din nou când revine conexiunea." when offline, text kept — [ST-159 scenarios 3, 6] (2026-10-04)
- ST-390 audit history writer — Done, PR #12 — [ST-390] (2026-10-04)
- ST-395 job lock — To do, EP-6, no PR; it will produce the 423 this story must handle; its Out of scope names "Offline actions that meet a lock: ST-255" — [ST-395] (2026-10-03)
- ST-419 public stream — later (EP-4); not part of this story — [Live updates feature, Stories in build order] (2026-10-03)

## Open Decisions

- none found that block ST-255: the story and the feature page both state "Open: None". Open elsewhere: audit retention and anonymising on account deletion (lawyer, T10) — blocks nothing here — [ST-390, Open] (2026-10-04)

## Contradictions with spec.md

spec.md was created 2026-10-05 and read the Build brief; ST-255 was last edited 2026-10-05T08:41Z. Times within the day cannot be ordered, so none of the items below is settled by recency: each is a Proposed Clarification.

- **spec.md** (2026-10-05): "FR-008 … Sign-out MUST drop the account's waiting actions." — **Notion**: the brief keeps waiting actions up to 24 h and across reloads and says nothing about sign-out [ST-255 Rules] (2026-10-03) — newer: same date; spec adds a rule.
- **spec.md** (2026-10-05): "FR-010 A send answered 423, 409, 404 or any other 4xx MUST drop the action" — **Notion**: only 423, 409, 404 are listed; other statuses are not mentioned [ST-255 scenario 7] — newer: same date; spec extends.
- **spec.md** (2026-10-05): the offline bar and the queue on "every dashboard", with a mechanic dashboard — **Notion**: `/app/mechanic` is release 2; at launch a mechanic uses a limited `/app/garage` [Front end architecture, Routes] (2026-10-03) — newer: Notion for the route, same story criterion ("driver, garage, mechanic and admin dashboards") in both.
- **spec.md** (2026-10-05): "Each of those endpoints reads `Idempotency-Key`" (Assumptions) — **Notion**: A32 requires the key on "every create and accept action"; tick/stage/finish-time are not named [A32] (2026-10-04) — newer: Notion, though it is only Proposed.

## Proposed Clarifications (this command's proposals, not requirements)

- Should sign-out drop waiting actions, or keep them for the same account until 24 h? The brief is silent; the spec chose to drop — from FR-008 contradiction.
- Should other 4xx answers (400, 403, 422) drop the action like 409, or stay? Brief lists only 423/409/404; ST-395 says outside-scope answers 403 within a garage's staff (A34) — from FR-010.
- Which `code` should the notice text key on, `job_locked` (A42) or `JOB_LOCKED` (ST-395)? — from A42 vs ST-395.
- Where is the device time recorded in the audit entry (ACTIVITY_LOG has `text` but no device-time field)? Who adds it, and is it this story or the endpoint stories? — from Audit constraint.
- Does the offline-form message of ST-159 ("Nu ești conectat. …") and the new "Ai nevoie de conexiune pentru asta" both stay, and which one shows for a non-waiting action? — from ST-159 prior art.
- Is the queue expected to send the job's `updated_at` in each waiting body (ST-395's 409 rule)? — from ST-395.
- At launch no mechanic dashboard exists; which frame hosts the offline bar for a mechanic? — from Routes.

## Gaps

- [NEEDS CLARIFICATION: Epic EP-1 page (3ee607bff0d281188cb4c6724bd45707) was fetched but not read in full; release and design-board details unchecked.]
- [NEEDS CLARIFICATION: "Decisions and ideas" page not read.]
- No page describes the look of the waiting tick or the offline bar; design.md owns it.
- Design mock URL not opened (outside Notion).

## Sources

- ST-255 Get back in step after a lost connection — https://app.notion.com/p/3ee607bff0d2810ba16cdf47e382046a
- ⚡ Live updates between screens (MF-52) — https://app.notion.com/p/3ee607bff0d281de9544d2b4e8331043
- 🧱 Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- ST-253 Set up the real-time connection to open dashboards — https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49
- ST-256 See live updates in place without losing my work — https://app.notion.com/p/3ee607bff0d281a39af4f03b587eb2ae
- ST-257 Give features one way to publish and receive live events — https://app.notion.com/p/3ee607bff0d281a3a201dcc26213ceac
- ST-395 Lock a job while the first person edits it — https://app.notion.com/p/3ee607bff0d281df8279fe9a9be89e67
- ST-390 Record every change in the audit history — https://app.notion.com/p/3ee607bff0d28146adece5076470024d
- ST-159 Build shared saving, validation and errors for small actions — https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a

## Refresh 2026-10-05

Baseline: `Gathered` 2026-10-05 (no time of day; the digest recorded the story as last edited 2026-10-05T08:41Z). Read by fetch and comments only; Query Data Source was at its usage limit, so sibling story statuses were not re-queried.

### New decisions

- No new evidence. A32 (Idempotency-Key on every create and accept action, Proposed) is unchanged; the Architecture decisions page was last edited 2026-10-04T05:56Z, before the baseline. A42 and A31/A34 are likewise unchanged.

### New constraints

- No new evidence. The ST-255 Build brief still reads "Current as of 2026-10-03", with the same scenarios 1-9, rules, states, data, tests and "Open: None". I compared it by eye with the digest's findings and found no differing rule, text or number.

### New contradictions with spec.md

- None new. The four contradictions above stand unchanged.

### Story changes

- Status moved Planning → Implementing (story fetched at 2026-10-05T08:53:57Z, page last edited 2026-10-05T08:53:57Z, against 08:41Z in the digest). Priority High, 5 points, PR #103 and Epic/Feature relations unchanged. The move matches the `implement` sync step and is not a scope change.
- Comments: none, as before (page-level, child-block and resolved all returned empty; suggested edits not enabled).
- The acceptance-criteria list carries the line "Proposed: after a lost connection the screen loads the current state again by itself." Overlaps the first criterion; no new requirement. The digest did not record it, so it may not be new.

### Not re-verified

- Epic EP-1 (3ee607bff0d281188cb4c6724bd45707): fetched again, but the 51 KB result was saved to a file that could not be read here (Bash disabled, Read over its token cap), so its last-edited time and any change were not checked. A search shows the EP-1 execution plan last edited 2026-10-03T19:11Z and the build timeline 2026-10-04T18:24Z, both before the baseline. Treat the epic as unchecked rather than unchanged.
