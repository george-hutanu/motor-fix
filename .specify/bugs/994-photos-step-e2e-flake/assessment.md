# Bug Assessment: the photos-step E2E flow hangs waiting for a quiet network

- **Slug**: 994-photos-step-e2e-flake
- **Created**: 2026-10-09
- **Source**: ST-994
- **Verdict**: valid
- **Severity**: high (E2E is red on unrelated PRs: CI fails a test that passes only on a retry)

## Report (verbatim or summarized)

`apps/web-e2e/src/photos-step.spec.ts` (ST-110) failed its first attempt and passed on retry on PR #295's CI on 2026-10-09. ST-948 (#281) and commit 0f7bd872 (#266) had already added waits for the picker, the photo moves and the delete.

## Symptom

A size test runs out of its 90 s budget. Playwright reports the timeout at `other.close()` in the second-browser block, and a retry passes in about 34 s. Expected: every attempt passes.

## Reproduction

1. CI run 37848562526 (PR #295, `261-maintenance-mode`): the desktop test timed out, then passed on retry. In run 37814121036 the tablet test timed out on all three attempts, and hours-step, garage-preview and phone timed out in `waitForLoadState` too.
2. The retry traces end on `ready(phone, <draft link>)`: `Wait for load state "networkidle"` starts 2–3 s into the test and never finishes. On that page a `GET /api/v1/live/public` (`text/event-stream`, read with `fetch`) opens about 4 s after load, while the map still fetches its tiles and fonts, and it never closes.
3. Local, deterministic: a copy of the spec whose pages open that stream with `fetch` at `load`, in both browser contexts, fails all 2 of 2 tests at `ready()`'s `networkidle`. An `EventSource` does not reproduce it: Playwright leaves `eventsource` requests out of networkidle (`_isExcludedFromNetworkIdle`), but the app reads its streams with `fetch`.

## Suspected Code Paths

- `apps/web-e2e/src/accounts.ts:ready()`: goto, then `waitForLoadState('networkidle')`, which needs 500 ms with no request in flight.
- `apps/web-e2e/src/photos-step.spec.ts`: `ready()` in `toPhotos`, on the draft link and in the English tests, and `networkidle` after both reloads.
- PR #295 `apps/web/src/app/maintenance/platform-listen.ts`: every page with no signed-in stream holds the public stream. It opens 2 s after the last download ended (`QUIET_FOR`), a guess at when Playwright has counted the page idle.

## Root Cause Hypothesis

High confidence. The spec waits for the network to go quiet, and a page that holds a live stream is never quiet once the stream is open. #295 opens the stream 2 s after downloads stop. On a busy runner the map's tiles and the telemetry posts keep the page from reaching 500 ms of quiet before that, the stream opens first, and `networkidle` never comes. Whether the test passes depends on which of the two wins on the runner, so it is a race.

## Proposed Remediation

**Preferred**: the test waits for what it uses. A new `hydrated(page, path?)` helper in `accounts.ts` waits until no `[ngh]` node is left, since Angular removes that marker as it hydrates each server-rendered node. The spec then waits on the data it checks:
- the server save (`PATCH /listing-drafts/:id`) that carries the reordered keys, before the other browser opens the link;
- the tile keys after each reload, read once their count matches, and in the other browser.

None of these waits is a sleep or a timeout, and the stream cannot hold any of them.

**Alternatives**:
- Make `platform-listen.ts` wait longer. Rejected: it is still a guess, and it is an app change made only to please a test.
- Raise the timeout. Rejected: the wait never ends, so a bigger timeout does not help, and the task rules it out.

**Files likely to change**: `apps/web-e2e/src/accounts.ts`, `apps/web-e2e/src/photos-step.spec.ts`

**Tests to add or update**: the photos-step spec itself; the stream repro and the repeated runs are the proof.

## Risks & Considerations

- About 37 other `networkidle` waits and `ready()` calls in roughly 28 specs face the same race once #295 merges. Moving them all is larger than this bug and is deferred as its own task.
- A page rendered on the client only has no `ngh` markers, so `hydrated()` returns at once there. Every route here is server-rendered.

## Open Questions

None.
