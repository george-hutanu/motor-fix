# Feature Context: Re-queue stranded notifications

- **Feature**: 560-requeue-stranded-notifications
- **Anchor**: ST-560 Tech debt (ST-392): notifications.service.ts fallBack/notify write a queued row, then add its job; nothing re-queues if Redis refuses — https://app.notion.com/p/3f0607bff0d281c1b564c357379131d1 | terms: none needed
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok (first 43k of 60.8k chars; the tail of the notification catalogue and later sections were cut off by the tool and not read) | epic not read (page 61k chars, over the tool cap; the sibling-story list came from the feature page's Stories relation only) | architecture ok (Architecture decisions only) | decisions ok
- **Overall confidence**: medium

## Story

- **ST-560 Tech debt (ST-392)** — status Planning, priority Medium, role System, issue type Task, epic and feature = Notifications and reminders (MF-51), PR https://github.com/george-hutanu/motor-fix/pull/73 is the origin PR; this task's PR is #200
- Scope per the story: "MEDIUM (code-reviewer): `libs/domain/src/notifications/notifications.service.ts` `fallBack` (and `notify`, pre-existing) writes a `queued` row and then adds its job; if Redis refuses the add, the row stays `queued` with no job and nothing re-queues it. A sweeper that re-adds `send-<id>` for stale `queued` rows (idempotent by job id) would close it for every channel." Severity medium. There are no acceptance criteria and no Build brief.
- Comments that moved scope: none. The story has no comments, resolved or open, and no child-block discussions.

## Decisions

- Background work runs on BullMQ in a separate worker; "Retries and schedules built in" — [Architecture decisions, A9] (2026-10-04, confidence: high). It supports a worker-side scheduled sweep.
- Events go through a transactional outbox carried by Redis, "so none is lost even if Redis is down" — [Architecture decisions, A7] (2026-10-04, confidence: medium). The principle is "no lost message on a Redis hiccup", the same as this story's goal. It is about events, not the NOTIFICATION row-to-job hand-off.
- A NOTIFICATION row is one row per recipient and channel: `queued` goes to `sent` or `failed`. `held` (quiet hours, `send_after` 08:00) goes back to `queued`. A fallback creates a new row with `fallback_of` — [Notifications and reminders, Build brief › States and lifecycle] (2026-10-03, confidence: high). The page names no other state or claim field.
- Quiet-hours and held rows are applied once, in the notifications worker — [Architecture decisions, A37] (2026-10-04, confidence: high). This supports leaving `held` out of the sweep.

## Constraints

- The module is `notifications`, with worker queues `notifications`, `reminders` and `sms-counter`; "Timed reminders run on the worker's scheduler" — [Notifications and reminders, Build brief] (2026-10-03, confidence: high).
- Messages must not be sent twice. A failed send is `failed`, and the fallback is a new row on the next channel (WhatsApp → e-mail, SMS → WhatsApp) — [Notifications and reminders, Final rules 13] (2026-10-03, confidence: medium; marked "(proposed)"). A duplicate would collide with this fallback chain.
- Always-sent types (JOB_READY, BOOKING_*, SIGN_IN_CODE and others) must not be lost, and a lost send hits the urgent types hardest — [Notifications and reminders, Final rules 6] (2026-10-03, confidence: medium).
- Acceptance criteria say "a message within a minute of a garage sending a quote" — [Notifications and reminders, Acceptance criteria] (2026-10-03, confidence: low as a constraint on this task: it describes the normal path, not recovery).

## Prior Art

- ST-392 "Send SMS and WhatsApp through Brevo with the monthly SMS cap" — Done, PR #73, the origin of the finding — [ST-392] (2026-10-05). Its states and errors say only "queued → sent or failed, as in ST-194" and say nothing about a lost job.
- ST-194 (quiet hours and held rows) is referenced by ST-392; I did not fetch it. 522-FR-001..003 and 561-FR-001..004 (send claim and SMS sending mark) are repository specs that Notion does not mention.

## Open Decisions

- none found that this task depends on. The open items on the space's Decisions page (operator company and sending domain, lawyer items T10/T12, status-tile thresholds T11, who pays for the WhatsApp Business account) do not touch it.

## Contradictions with spec.md

- **spec.md** (2026-10-07): FR-006 makes the processor keep the send claim after an unrecorded send, and FR-004/FR-005 skip rows with a claim or sending mark — **Notion**: the story asks only for "a sweeper that re-adds `send-<id>` for stale `queued` rows (idempotent by job id)"; the claim, the sending mark and a processor change appear nowhere in Notion [ST-560] (2026-10-07) — newer: same date. This is not a conflict but scope growth beyond the task text; see Proposed Clarifications.

## Proposed Clarifications (this command's proposals, not requirements)

- Does the owner accept that FR-004..006 (claim guard and a processor change) are in the scope of ST-560, given the story names only the sweeper and idempotence by job id? Without them the sweeper could duplicate a sent message. — from ST-560 Finding.
- The spec's 5-minute stale window and 5-minute sweep interval are not in Notion (A9 says only "schedules built in"). Should they be confirmed in the plan as defaults, with SC-001's "10 minutes" recovery stated as distinct from the feature page's "within a minute" normal path? — from the Acceptance criteria and A9.
- Should `held` rows whose delayed job is lost be filed as a separate tech-debt task? Notion has no such item, and the spec already defers them. — from A37 and the states list.

## Gaps

- [NEEDS CLARIFICATION: none that block, but the epic page (MF-51's epic) and the tail of the feature page's catalogue were not read, so sibling in-progress stories touching `notifications.service.ts` were not checked.]
- No Notion page describes the queue hand-off failure mode, the claim fields or the SMS sending mark; they are documented only in the repository.

## Sources

- ST-560 story — https://app.notion.com/p/3f0607bff0d281c1b564c357379131d1
- ST-392 Send SMS and WhatsApp through Brevo with the monthly SMS cap — https://app.notion.com/p/3ee607bff0d281e088cadac726138cc5
- Notifications and reminders (MF-51) — https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d

## Refresh (2026-10-07T10:36:23Z)

- ST-560 comments re-read (all blocks): none. No new evidence.
