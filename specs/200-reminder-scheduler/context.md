# Context — 200-reminder-scheduler

Gathered: 2026-10-05 · Source: the MotorFix Notion space only (story, its timeline row and its blockers' rows, read this session).

## Story
- ST-200 "Set up the scheduler for timed reminders", Task, Role System, Medium, 5 points, EP-1 Foundations. https://app.notion.com/p/3ee607bff0d2813ab7d3eb3ebb239d3b
- Build brief current as of 2026-10-03: the worker's scheduler on BullMQ in Europe/Bucharest; daily runs; per-object timers with a stable job id plus a 5-minute sweep; the `reminders` queue and REMINDER table with its once-only guard; the hook later stories use.

## Timeline
- Row https://app.notion.com/p/3ee607bff0d2816dbaeef827a965eff8: lane D · Messaging, W4, blocked by ST-194 (Merged) and ST-197 (Merged). Note: "Quiet hours are open; until decided, nothing waits." Superseded by the story's decision of 2026-10-03: quiet hours 22:00–08:00 for non-urgent messages [X25] (latest wins).

## Constraints
- Every reminder is not urgent and waits during quiet hours (the pipeline does it: `quiet-hours.ts`).
- SMS is allowed for the reminder types, capped at 5 a month (ST-392).
- Shortened dates exist only in test environments.

## Contradictions
- The brief reads CAR and BOOKING, which no merged story has created yet (the schema has neither). Carried to Clarifications.

## Proposed Clarifications
- Where a reminder finds its driver without CAR; how a booking reminder is stored; which daily runs to schedule now.
