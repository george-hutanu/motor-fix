# Tasks: Get back in step after a lost connection

**Input**: `specs/255-live-resync/spec.md`, `plan.md`, `design.md`
**Level**: 2 (feature).

## Phase 1: Setup

- [X] T001 Add `fake-indexeddb` as a development dependency (`package.json`, `package-lock.json`), installed through `scripts/heavy.sh`

## Phase 2: Tests first (red)

- [X] T002 [P] `apps/web/src/app/dashboard/live.resync.spec.ts`: the state goes `closed` → `reconnecting` → `open` (FR-001). Backoff of 1, 2, 5, 10 and 30 s with jitter, reset by an open (FR-002). Polling after 3 failures, re-reading at once and then every 60 s (FR-003). `resync` on a reconnect but not on the first open, and after an expiry renewal (FR-004). Wake after 60 s hidden, a 60 s silence watchdog and `online` (FR-005). `offline` after 10 s (FR-006). A 401 renews and is not counted. A refused renewal and an evicted stream go `closed`. `liveResource` re-reads on `resync` (FR-004).
- [X] T003 [P] Update `apps/web/src/app/dashboard/live.adversary.spec.ts`. The tests that pinned "no reconnect after a drop, a failed request or an unknown bye" now expect the backoff (FR-002). The tests for a refused renewal still expect no reconnect.
- [X] T004 [P] `apps/web/src/app/dashboard/waiting.spec.ts` covers:
  - the action carries an `Idempotency-Key` and is removed once accepted (FR-007);
  - actions are kept across a reload, per account, and dropped at sign-out (FR-008);
  - they are sent in order, one at a time; no answer, 408, 429 or 5xx keeps them, with a retry after 60 s; they are sent on `online` and on a stream open (FR-009);
  - a 423, 409 or 404 drops the action, shows the notice with the API's detail or the generic text, and calls `catchUp` (FR-010);
  - an action older than 24 h is dropped with a notice (FR-011);
  - `connected()` refuses while offline and shows the needs-connection message (FR-012);
  - without IndexedDB, actions are still kept in memory.
- [X] T005 [P] `apps/web/src/app/dashboard/frame.offline.spec.ts`: the bar shows only while `live.offline()` and has `role="status"` (FR-006); `resync` re-reads the account (FR-004)
- [X] T006 [P] `apps/web-e2e/src/live.spec.ts`: after 60 s offline, a language change made from another context shows in the `/me` re-read within 5 s, and the bar shows and then goes (SC-001, FR-004, FR-006)

## Phase 3: Implementation

- [X] T007 `apps/web/src/app/dashboard/live.ts`:
  - `state`, `offline` and `resync`;
  - the backoff loop with `LIVE_RANDOM`;
  - polling, the watchdog, wake and `online`;
  - `catchUp()`;
  - `liveResource` re-reading on `resync`.
- [X] T008 `apps/web/src/app/dashboard/waiting.ts`: `Waiting` with an IndexedDB store, the flush, refusals, expiry and `connected()`
- [X] T009 `apps/web/src/app/dashboard/frame.ts`: the offline bar, and `resync` → `session.reload()`. In `libs/i18n/src/shell/ro.json` and `en.json`: the `shell.live.*` texts.

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | live.resync.spec.ts states |
| FR-002 | live.resync.spec.ts backoff; live.adversary.spec.ts reconnecting |
| FR-003 | live.resync.spec.ts polling |
| FR-004 | live.resync.spec.ts resync and liveResource; frame.offline.spec.ts account re-read; web-e2e live.spec.ts |
| FR-005 | live.resync.spec.ts wake, watchdog, online |
| FR-006 | live.resync.spec.ts offline; frame.offline.spec.ts; web-e2e live.spec.ts |
| FR-007 | waiting.spec.ts key and accept |
| FR-008 | waiting.spec.ts reload and sign-out |
| FR-009 | waiting.spec.ts order and retries |
| FR-010 | waiting.spec.ts refusals |
| FR-011 | waiting.spec.ts 24 h |
| FR-012 | waiting.spec.ts connected() |
