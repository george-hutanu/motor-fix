# Bug Assessment: a grouped e-mail window loses rows, double-sends and trusts the worker clock

- **Slug**: 523-flush-late-follower
- **Story**: ST-523 (#308), with ST-664 (#484), ST-667 (#487), ST-808 (#575), ST-832 (#594), ST-833 (#595)
- **Verdict**: valid (all six reproduced or confirmed on origin/main 780c4d172)

## Evidence

Integration specs written first, run against origin/main 780c4d172 (13 red, 119 green):

- #308: a follower notified while `flush-<leader>` is active (hooked inside the Brevo call) stays `held`; its `queue.add` is a no-op on the active job id.
- #484: a second flush started inside the first one's Brevo call resolves and sends the grouped e-mail again; a flush whose rows carry a live claim sends anyway.
- #487: a claim 10 s old on the database clock is taken over by a worker whose clock runs 61 s ahead (and the DB-relative lease specs fail against the fixed `processor.now`).
- #575: a held row (quiet hours, and a grouping follower) whose delayed job was lost gets no job from the `requeue` sweep.
- #594: re-queuing 12 rows names all 12 ids in one line.
- #595: the restored partial-failure count case passes today (the paged sweep counts correctly); it guards the count from now on.

## Root cause

- `flush()` reads the leader's held rows once, takes no claim, and ends; a row that joins after the read has only the no-op add.
- `send()` computes the lease from `this.now()`, the worker clock.
- `requeueStranded()` selects `status: 'queued'` only; a held row's only path to the queue is its delayed job.
- The summary log joins every id.

## Proposed Remediation

- `flush()` loops: each round claims the leader's unclaimed (or lapsed) held rows with one `UPDATE … SET claimed_at = now() … RETURNING id`, excluding rows already handled, writes them (grouped or single), releases its claims in `finally` unless the send went unrecorded; a first round that claims nothing while a live claim holds rows throws so the queue retries.
- `send()` claims with `UPDATE … RETURNING claimed_at` on `now()`, and releases by that value.
- `requeueHeld()` pages held rows past `sendAfter + 5 min` with no claim, no sending mark and no draft, and adds `send-<id>` or `flush-<leader>` at once; the `requeue` job runs it after `requeueStranded()`.
- One log helper names the count and the first ten ids, then `…`, for both sweeps.

## Files likely to change

- `libs/domain/src/notifications/notifications.processor.ts`, `libs/domain/src/notifications/notifications.service.ts`

## Tests to add or update

- `notifications.processor.integration.spec.ts`, `send-claim.adversary.integration.spec.ts` (claims stamped relative to the database clock), `requeue.integration.spec.ts`, `requeue.adversary.integration.spec.ts`, helper `claimAgo` in `notifications.testing.ts`.

## Risks & Considerations

- Exact-millisecond lease edges cannot be pinned against the database clock; those specs become one-second margins.
- A held row whose job sits in the kept-failed set is still not re-added (BullMQ keeps the id); unchanged, as for queued rows.
