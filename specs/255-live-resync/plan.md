# Implementation Plan: Get back in step after a lost connection

**Branch**: `255-live-resync` | **Date**: 2026-10-05 | **Spec**: `specs/255-live-resync/spec.md`

## Summary

`Live` becomes a small state machine. It has a `state` signal and an `offline` signal. It reconnects with jittered backoff, polls after 3 failures, and raises a `resync` stream on every reconnect, on each poll, and when a waiting action is refused. `liveResource` and the frame re-read on `resync`. A new `Waiting` service keeps the three workshop action kinds in IndexedDB and sends them in order through `HttpClient`, each with its `Idempotency-Key`. The frame shows the offline bar. The client is the only part that changes: the API and worker stay as they are.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`node_modules/typescript/package.json`)
**Primary Dependencies**: Angular 22.2.1 standalone with signals, RxJS 7.8.2 (`package.json`); `toast` from `@motor-fix/ui-cockpit`, `toProblem` from `@motor-fix/overlays`, `I18n` from `@motor-fix/i18n`
**Storage**: the browser's IndexedDB (database `motor-fix`, store `waiting`), with an in-memory fallback. Nothing new on the server.
**Testing**: Jest 30.5.2 with jest-preset-angular 17.0.1 (`apps/web/jest.config.cts`, jsdom); `fake-indexeddb` 6.2.5 (Apache-2.0) added as a development dependency, because jsdom has no IndexedDB. Playwright 1.63.0 in `apps/web-e2e`.
**Target Platform**: evergreen browsers; SSR renders no connection (`isPlatformBrowser`).
**Project Type**: Nx monorepo (nx 23.2.1); the change is in `apps/web` and `libs/i18n`.
**Performance Goals**: re-read within 5 s of the `online` event (SC-001).
**Constraints**: no internal ids in source; Biome 2.3.11; the web app imports relative paths without extensions.
**Scale/Scope**: about 4 source files, 4 spec files, 1 e2e test.

## Constitution Check

- [x] **I. No Bloat**: no new lib, interface layer or global store. The backoff, watchdog and polling live in `Live`, the only connection. The queue is one service, with the IndexedDB calls written inline (about 40 lines) instead of a wrapper package. The single new dependency, `fake-indexeddb`, is development only.
- [x] **II. Test Discipline**: specs are written first and proven red. They sit beside their files (`live.resync.spec.ts`, `waiting.spec.ts`, `frame.offline.spec.ts`), and Playwright covers the 60 s outage.
- [x] **III. The Given Stack**: Angular signals and RxJS; no new runtime dependency.
- [x] **IV. One Repository, One Toolchain**: the change stays inside `apps/web`.
- [x] **V. Rules Live in One Place**: waiting actions go to their normal endpoints, and the API checks them as if they were sent at once. The client makes no trust decision.
- [x] **VI. PostgreSQL Is the Truth**: the server state does not change. After a reconnect, the client always re-reads from the API.
- [x] **Notion choices**: A32 (Idempotency-Key) is Proposed, and it is cited in context.md. The story touches no To-decide item T1–T10.

## Design

### `apps/web/src/app/dashboard/live.ts`

- `type LiveState = 'closed' | 'reconnecting' | 'polling' | 'open'`.
- `Live.state` and `Live.offline` are read-only signals. `offline` turns true 10 s after the state left `open` while the connection is still wanted, and false at `open` or `closed`.
- `Live.resync: Observable<void>` fires:
  - at `open` when the tab already had a stream;
  - on entering `polling`, then every 60 s while it lasts;
  - on `catchUp()`, which `Waiting` calls after a refusal.
- `run()` loops while the connection is wanted. Each try has its own `AbortController`. Its outcome is one of:
  - `opened-then-dropped`, `failed`: the failure count goes up, then the backoff wait;
  - `bye evicted`: the state goes to `closed`;
  - `bye expired/shutdown`, or `401`: the session renews. If the renewal works, the next try starts at once; if it is refused, the state goes to `closed`. A second 401 straight after a renewal counts as a failure.
  - `aborted` by `close()`: the loop ends. When the wake reset aborted it, the loop starts again at once with the count at 0.
- Backoff: `[1, 2, 5, 10, 30]` seconds, the last one repeated, each multiplied by `0.9 + 0.2 * random()`. `random` comes from the `LIVE_RANDOM` injection token (default `Math.random`), so the tests can pin it.
- The wait can be woken: `online` wakes it, and so does `visibilitychange` to visible after 60 s or more hidden. That second case also aborts an open stream and resets the count.
- Watchdog: no chunk for 60 s aborts the current try (outcome `failed`).
- `liveResource` subscribes to `resync` and calls its own `read()`, which runs one read at a time.

### `apps/web/src/app/dashboard/waiting.ts` (new)

- `type WaitingKind = 'job.step' | 'job.stage' | 'job.eta'`.
- `Waiting.add(kind, { method, url, body })` stores the action and sends it. The record holds the key (`crypto.randomUUID()`), the account, `madeAt` and `seq`.
- `Waiting.actions` is a signal of the account's actions, each `waiting` or `sent`.
- `Waiting.connected()`: true when online. Otherwise it shows "Ai nevoie de conexiune pentru asta" and returns false. Callers of the kinds that may not wait use it.
- An effect on `Session.current()?.id` loads the account's actions, drops the expired ones with a notice, then flushes. When the id goes from set to unset, the actions are dropped.
- Flush:
  - it runs one action at a time, in `seq` order;
  - each send is `HttpClient.request` with the `Idempotency-Key` header, so the app interceptor renews a 401 and sends it again once;
  - a 2xx removes the action;
  - a 0, 408, 429 or 5xx keeps it, stops the flush and sets a 60 s retry;
  - any other status removes the action, shows the notice (`toProblem(...).detail` or the generic text) and calls `live.catchUp()`.
- Triggers: `add`, `online`, `Live.state` becoming `open` (an effect), loading, and the 60 s retry.
- IndexedDB: `indexedDB.open('motor-fix', 1)`, store `waiting` with keyPath `key`. Every call is wrapped so that a missing or failing IndexedDB falls back to the in-memory list.

### `apps/web/src/app/dashboard/frame.ts`

- `resync` calls `session.reload()`.
- An always-present `<p class="live-offline" role="status">` under the header, above `<mf-email-banner />`, holds the text while `live.offline()` is true. When it is empty it collapses (no padding, no border).

### `libs/i18n/src/shell/{ro,en}.json`

- New keys `shell.live.offline`, `shell.live.needsConnection`, `shell.live.refused.changed`, `shell.live.refused.gone`, `shell.live.refused.other` and `shell.live.expired`.

### `apps/web-e2e/src/live.spec.ts`

- New test. Driver A's context goes offline (`context.setOffline(true)`) for 60 s, and the bar shows. A second request context changes A's language through `PATCH /api/v1/me`. When the network comes back, within 5 s there is a 200 on `/api/v1/live` and a `GET /api/v1/me` answer that carries the new language, and the bar goes. The test then sets the language back.

## Project Structure

```text
apps/web/src/app/dashboard/
├── live.ts                 # state, backoff, polling, watchdog, wake, resync
├── live.resync.spec.ts     # new: FR-001..FR-005
├── waiting.ts              # new: the queue
├── waiting.spec.ts         # new: FR-007..FR-012
├── frame.ts                # offline bar, resync → session.reload
└── frame.offline.spec.ts   # new: FR-006, FR-004 (account re-read)
libs/i18n/src/shell/ro.json, en.json
apps/web-e2e/src/live.spec.ts   # SC-001
package.json, package-lock.json # fake-indexeddb (dev)
```

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
| --- | --- | --- |
| `Waiting` ships with no caller | The Build brief puts the queue in this story, and its endpoints come later (Quotes and booking, Mechanic workspace) | Leaving it out would split the story's scenarios 6–9 into stories that do not own them |
| `fake-indexeddb` dev dependency | Proves that actions survive a reload and keep their order against real IndexedDB semantics | An in-memory fake would test the fake, not the store |
