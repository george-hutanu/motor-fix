# Auto run — ST-560 re-queue stranded queued notifications

Description: ST-560 "Tech debt (ST-392): queued notification row with no job is never re-queued" (https://app.notion.com/p/3f0607bff0d281c1b564c357379131d1)
Start commit: cab78f49 (origin/main), branch 560-requeue-stranded-notifications, worktree .worktrees/560-requeue-stranded-notifications

## Preflight
- Tree clean; typecheck, lint, test green (exit 0). spec-drift: no active feature yet.
- Confirmed no sweeper on origin/main: no upsertJobScheduler/sweep in libs/domain/src/notifications; only scheduler/timers.ts (object timers) and events/outbox-relay.ts.

## 0. Size
- level.mjs suggest ST-560: level 2 (classifier 0.80; boards 1, brief not found). Full chain.

## 1. Constitution
- v1.8.2 card read; no placeholders. Principle I first.

## 2. Specify
- Phase agent (fable): STATUS success. spec.md (FR-001..010), checklist, design.md (no screens), draft PR #200 (planning, tech debt), Notion Planning + PR linked.

## 3. Org context
- org-researcher: STATUS partial (feature page read to 43k chars, epic not read). context.md written; 1 contradiction (FR-004..006 scope growth), 3 proposed clarifications.

## 4. Clarify
- spec-challenger: 6 findings. Answers applied to spec.md (## Clarifications): held follower out (edge case rewritten); kept-failed job = no-op until evicted, no removal (no poison loop); same JOB options; lapsed claim never swept; sent() answers recorded, send() keeps claim when not; FR-004..006 in scope (no regression of ST-522/561). SC-004 rephrased to path exclusions. Window/interval noted as not in Notion. Held-row gap → deferred.md at review.
- level.mjs check: stays 2.

## 5. Plan
- before_plan: design.md current (no screens), tree clean. plan.md written: requeueStranded() in the service (findMany queued/claimedAt null/sendingAt null/createdAt < now-5 min, then queue(send(id)); failed add warns and ends; ids logged when > 0), processor routes `requeue`, sent() answers recorded, send() keeps the claim when unrecorded (per-id Set), module upserts the `requeue` scheduler in the WORKER factory (failure logged, not fatal). Technical Context cited from package-lock, tsconfig.base, jest preset, bullmq types; context.md Constraints carried in. No research/data-model/contracts/quickstart (nothing beyond plan.md, as 778).
- after_plan: commit 48f703f5 `docs(specs): ST-560 plan the stranded notification sweep`, pushed. agent-context left to phase 15 (the pointer lives in the private CLAUDE.local.md).

## 6. Checklist
- checklists/reliability.md: 15 items checked, 1 struck (N/A). Spec fixed: edge case for a job finishing between read and add; FR-008 covers a failed read as well as a failed add. Unchecked: 0.

## 7. Tasks
- tasks.md: 7 tasks (3 red integration specs, 3 source files, 1 verify run); after_tasks analyze left to phase 8. Committed and pushed.

## 8. Analyze
- artifact-lint --check: 10 fr-untasked + 2 delta errors fixed (FR ids in tasks, Adds listed, Modifies none with note). Re-run clean. No CRITICAL left.
