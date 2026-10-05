# Feature Specification: Get back in step after a lost connection

**Feature Branch**: `255-live-resync`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-255 Get back in step after a lost connection (EP-1 Foundations, High, 5 points). Builds on ST-256 live-in-place (live.ts, live-in-place.ts, outbox -> worker -> stream)."

**Sources**: Notion story ST-255 (https://app.notion.com/p/3ee607bff0d2810ba16cdf47e382046a), read 2026-10-05 (Build brief current as of 2026-10-03; it wins over the criteria above it). Its blockers are all Merged: ST-253 (the connection, `Live` in `apps/web/src/app/dashboard/live.ts`), ST-257 (`liveResource`) and ST-256 (updates in place, PR #79). Design: `specs/255-live-resync/design.md`.

## Clarifications

### Session 2026-10-05

- Q: Where does the work live? → A: In the shared `live` code beside `Live` in `apps/web/src/app/dashboard/`. The connection states, backoff, polling and re-reads go in `live.ts`. The waiting actions go in a new `waiting.ts`. The offline bar goes in the dashboard frame, which every dashboard shares. (autonomous default)
- Q: Do the three waiting kinds always go through the queue, or only offline? → A: Always. Online, the queue sends at once; a send with no answer is the same case as offline. One path, and order holds across a drop. A send kept first in line is tried again 60 seconds later too, so a stalled queue never waits for a reload. (autonomous default)
- Q: Does the bar show on a first load that never gets a stream? → A: Yes. The 10 seconds run from the moment the connection is wanted, first load included: that screen may be out of date too. (autonomous default)
- Q: Does a renewal after `bye` `expired` or `shutdown` re-read every view? → A: Yes, as every reconnect does: events may be missed in the gap and nothing is replayed. The re-read fires when the state becomes `open` (the 200 arrives). (autonomous default)
- Q: Which answers refuse a waiting action? → A: 401 goes through the app's normal renewal and is sent once more; the answer after it counts. 408, 429 and 5xx keep the action, like no answer. Every other 4xx drops it, with the API's `detail` or the generic text for its status. A 401 on the stream itself does not count as a failed try; a refused renewal sets the state `closed`, with no bar. (autonomous default)
- Q: Do tries and polls pause in a hidden tab, and what does becoming visible do? → A: Nothing pauses. Becoming visible after 60 seconds or more hidden acts like `online`: it drops the stream, resets the backoff and tries at once. Entering `polling` re-reads at once, then every 60 seconds. (autonomous default)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The screen catches up by itself after a drop (Priority: P1)

When the live connection drops, the client tries again with backoff. Once a stream opens again, every open view and the signed-in account re-read their data from the API. Nothing relies on missed events being replayed, and nobody reloads the page.

**Why this priority**: it is the story: what the person sees is never wrong for long.

**Independent Test**: open a dashboard, cut the network for 60 seconds, change the account from another browser, restore the network; the dashboard shows the new data within 5 seconds.

**Acceptance Scenarios**:

1. **Given** a dashboard lost its connection for 1 minute, **When** the network returns, **Then** within 5 seconds every open view has re-read its data and shows the current state, with no page reload.
2. **Given** the connection keeps failing, **When** the client tries again, **Then** it waits 1, 2, 5, 10 and then 30 seconds between tries, each delay moved by up to 10% either way.
3. **Given** 3 tries in a row have failed, **When** the dashboard stays open, **Then** its connection state is `polling` and every open view re-reads every 60 seconds until a stream opens again.
4. **Given** a tab was hidden for an hour, **When** it becomes visible, **Then** it opens a fresh stream and every open view re-reads.
5. **Given** the browser reports that the network is back, **When** a try is waiting on its backoff, **Then** the client tries at once.

---

### User Story 2 - The person knows when the screen may be out of date (Priority: P1)

**Why this priority**: a screen that silently shows old data is worse than one that says so.

**Independent Test**: cut the network; after 10 seconds the bar shows; restore it; the bar goes.

**Acceptance Scenarios**:

1. **Given** a dashboard without a connection for more than 10 seconds, **When** the person looks at it, **Then** a thin bar under the header says "Fără conexiune. Ce vezi poate fi vechi." / "No connection. What you see may be out of date.".
2. **Given** the bar shows, **When** a stream opens again, **Then** the bar goes.
3. **Given** a drop shorter than 10 seconds, **When** the stream opens again within it, **Then** no bar ever shows.

---

### User Story 3 - Small workshop actions wait for the signal (Priority: P2)

A tick of a job step, a change of a job's stage or of its estimated finish time is kept on the device while there is no signal and sent, in order, when the signal returns. Anything about money, bookings, quotes or reviews needs a connection.

**Why this priority**: the workshop screens that make these actions come with Quotes and booking. This story gives them the queue they will use.

**Independent Test**: with the queue's sender failing, add two actions, reload, restore; both are sent in order with their keys.

**Acceptance Scenarios**:

1. **Given** no signal, **When** a waiting kind of action is made, **Then** it is kept as `waiting`, and it is sent with its `Idempotency-Key` when the signal returns; it leaves the queue once the API accepts it.
2. **Given** the page is reloaded while actions wait, **When** it opens again, **Then** the actions are still there and are sent.
3. **Given** several actions wait, **When** they are sent, **Then** they go in the order they were made, one at a time, each waiting for the answer to the one before.
4. **Given** a waiting action is sent, **When** the API answers 423, 409 or 404, **Then** the action is dropped, a notice says why (the API's own detail when it gives one, such as "Elena, mecanic, lucra la această mașină"), and every open view re-reads.
5. **Given** an action made more than 24 hours ago is still waiting, **When** the queue next looks at it, **Then** it is dropped without being sent and a notice says so.
6. **Given** no signal, **When** the person tries an action of any other kind, such as recording a final price or confirming a booking, **Then** it is not kept and a message says "Ai nevoie de conexiune pentru asta" / "You need a connection for this".

### Edge Cases

- Sign-out, a role switch, `close()` or `bye` with reason `evicted` stops all tries; nothing reconnects and no bar shows.
- `bye` with reason `expired` or `shutdown` still renews and reconnects at once (no backoff, no failure counted).
- The stream answers 401: the client renews the token and tries again; when the renewal is refused, it stops.
- A stream that receives no bytes for 60 seconds (the server sends a comment every 25 seconds) is treated as dropped.
- The network comes back without the browser firing `online` (the API was down, not the device): the next try on the backoff picks it up, at most about 33 seconds later.
- The first open of a tab is not a reconnect: views read once, on their own, as before.
- A re-read on reconnect that fails keeps the data on screen with no error, as any background re-read does.
- A waiting action whose send gets no answer, or a 5xx, stays first in line and is sent again at the next chance with the same key.
- A send answered with another 4xx (400, 403, 422) is refused: dropped, with the API's detail or the generic notice.
- The queue is per browser and per account: a waiting action of another account is never sent with this account's token, and sign-out drops this account's waiting actions.
- No IndexedDB (a private window that blocks it): actions still wait in memory for the life of the tab.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The web app's live connection MUST expose its state: `closed` (not wanted: signed out, closed or evicted), `reconnecting` (wanted, no stream open yet or after a drop), `polling` (3 or more tries in a row have failed) and `open` (a stream answered 200).
- **FR-002**: When the stream fails to open or ends for a reason other than `close()`, sign-out or `bye` `evicted`, the client MUST try again after 1, 2, 5, 10 and then every 30 seconds, each delay multiplied by a random factor between 0.9 and 1.1. A stream that opens resets the sequence. `bye` with reason `expired` or `shutdown` renews and reconnects at once, as before. A 401 renews the token before the next try and is not counted as a failure; a refused renewal sets the state `closed`.
- **FR-003**: After 3 failed tries in a row, the state MUST be `polling`, and every open live view and the signed-in account MUST re-read at once and then every 60 seconds until a stream opens. Tries go on, on the backoff, meanwhile.
- **FR-004**: When a stream opens after the tab already had one (any reconnect), every open live view and the signed-in account MUST re-read their data through the API as soon as the state becomes `open`, never waiting for missed events to be replayed.
- **FR-005**: When a hidden tab becomes visible after being hidden for 60 seconds or more, the client MUST drop its stream, reset the backoff and open a fresh one at once, which re-reads every open view (FR-004). A stream that receives no bytes for 60 seconds MUST be treated as dropped. When the browser fires `online`, a try waiting on its backoff MUST start at once.
- **FR-006**: Every dashboard MUST show a thin bar under its header, "Fără conexiune. Ce vezi poate fi vechi." / "No connection. What you see may be out of date.", as a polite status, once its live connection has not been `open` for more than 10 seconds while it is wanted (first load included), and MUST hide it as soon as a stream opens. It never covers content, moves focus or scrolls the page sideways at 320 px.
- **FR-007**: The web app MUST offer a queue for small workshop actions: tick a job step, change a job's stage, change a job's estimated finish time. These kinds always go through the queue, online or not. An action is a request to its normal endpoint, carrying a fresh `Idempotency-Key` that stays the same on every resend. It is `waiting` until sent, `sent` while its answer is awaited, and leaves the queue once `accepted` (2xx) or `refused`.
- **FR-008**: Waiting actions MUST be kept in the browser's IndexedDB, per account, so they survive a reload and are sent after it. Sign-out MUST drop the account's waiting actions.
- **FR-009**: The queue MUST send actions in the order they were made, one at a time. It sends when an action is added, when the browser fires `online`, when a live stream opens, when the page loads, and 60 seconds after a send that kept an action. A send with no answer, or a 408, 429 or 5xx answer, keeps the action first in line, as `waiting`, and stops sending until the next of those moments. A 401 goes through the app's normal renewal and is sent once more; the answer after it counts. A 401 that survives that renewal keeps the action: the session is ending, and the sign-out drops it (FR-011's sign-out rule).
- **FR-010**: A send answered 423, 409, 404 or any other 4xx not kept by FR-009 MUST drop the action and show a notice: the API's `detail` when it gives one, else "S-a schimbat între timp. Vezi starea de acum." for 409, "Nu mai este disponibil." for 404, and "Acțiunea nu a fost primită." for any other status. Every open live view then re-reads.
- **FR-011**: A waiting action made more than 24 hours ago MUST be dropped without being sent, with the notice "O acțiune făcută fără semnal a expirat și nu a fost trimisă." / "An action made without signal expired and was not sent.".
- **FR-012**: While the device is offline (the browser says so, or the offline bar shows), an action of a kind that may not wait MUST NOT be kept or sent, and the message "Ai nevoie de conexiune pentru asta" / "You need a connection for this" MUST show.

### Key Entities

- **Waiting action**: key (the `Idempotency-Key`), account id, kind (`job.step`, `job.stage`, `job.eta`), method, URL, body, time made on the device, order. Kept in IndexedDB only; nothing new is stored on the server.

## Success Criteria *(mandatory)*

- **SC-001**: After 60 seconds without network, a change made from another browser shows on the dashboard within 5 seconds of the network returning, with no reload.
- **SC-002**: Every new text shows in Romanian and English, and passes the i18n check.
- **SC-003**: The offline bar never makes a dashboard scroll sideways at 320 px.

## Assumptions

- The jitter is ±10% of each delay, the brief's "a little" *(proposed)*. (autonomous default)
- A tab counts as having slept when it was hidden for at least 60 seconds; a shorter switch away keeps its stream. A stream with no byte for 60 seconds is dead: the server's comment comes every 25 seconds. (autonomous default)
- "Every open view re-reads" covers each `liveResource` and the signed-in account (`/me`, which the frame shows). EP-1 has no other live view, so the end-to-end proof changes the account's language from a second browser and waits for the first one's re-read of `/me`. (autonomous default)
- No endpoint for the three waiting kinds exists yet (they come with Quotes and booking and Mechanic workspace), so the queue ships without a caller, as ST-256's helpers did. The waiting look of a tick is drawn by the screen that owns the tick. Each of those endpoints reads `Idempotency-Key` and notes the time made on the device in its audit entry, when it is built. (autonomous default)
- An action of a kind that may not wait is refused only while the device is offline; online, it goes through its normal call and its own error handling. (autonomous default)
- Sign-out drops the account's waiting actions: on a shared device the next person must not send them, and the brief keeps them only for the same session's account. Other 4xx answers drop like the brief's three: the action can never succeed as sent. (autonomous default)
- A mechanic at launch uses the limited garage dashboard (`/app/garage`); the bar and the queue live in the frame every dashboard shares, so they reach it there. (autonomous default)
- Whether the three update endpoints read `Idempotency-Key` (A32 names create and accept actions) and how the audit records the device time (ACTIVITY_LOG has no field for it) are for those endpoint stories. The queue always sends the key and keeps the time each action was made, for those stories to carry. (autonomous default)
- The generic refusal texts and "Acțiunea nu a fost primită." are proposed here; the brief gives only the 423 example. (autonomous default)
- Tests of the IndexedDB store use the `fake-indexeddb` package as a development dependency: jsdom has no IndexedDB. (autonomous default)

## Out of scope

- The connection itself (ST-253), the job lock and its 423 (ST-395), the workshop actions and their endpoints (Quotes and booking, Mechanic workspace), photo and clip uploads, which already retry on their own.

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012
- **Modifies**: none
- **Removes**: none
