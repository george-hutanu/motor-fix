# Auto run — 200-reminder-scheduler

- Description: ST-200 Set up the scheduler for timed reminders (https://app.notion.com/p/3ee607bff0d2813ab7d3eb3ebb239d3b).
- Start commit: 9fadfcc (origin/main); branch `200-reminder-scheduler`; draft PR #78.
- Picked from the candidates ST-257, ST-200, ST-567: ST-257 already has PR #77 (another agent), ST-200 (Medium) outranks ST-567 (Low); ticked Ready to work, To do, its blockers ST-194 and ST-197 Merged; no PR, branch or worktree.

## Preflight
- Fresh branch from origin/main; `npm ci` in the worktree; dedicated database `motorfix_st200` migrated. The start commit's pre-commit hook ran typecheck, lint and test green (the first try, with no DATABASE_URL, failed 93 integration tests: an environment gap, not a red suite).

## 0. Size
- Level 2 (feature): a migration, a new queue and worker, the hooks for later stories. (autonomous default)

## 1. Constitution
- Read `.specify/memory/constitution.md`; Principles I, II, VII carried.

## 2–4. Specify, context, clarify
- spec.md from the Build brief; 7 autonomous answers in Clarifications (no CAR or BOOKING table yet, a `booking` kind, only the `reminders` daily run, SERVICE_DUE on 30/7 days, catch-up windows, `-` in job ids, the shortened-day proof as an integration test). context.md from the story and its timeline rows.

## Design
- design.md: the story has no screens (Build brief › Screens: None).

## 5–8. Plan, tasks, analyze
- plan.md, tasks.md; `artifact-lint` clean after naming the Spec Delta capability `notifications`.

## 9. Tests
- Six new spec files first; red: 6 of 6 suites failed (modules missing).

## 10. Implement
- T001–T009; the feature's 8 suites green, 100 tests (quiet-hours' own suites included, after moving its Bucharest reading to `bucharest.ts`).

## 12–14. Harden, review (repair lap 1 of 5)
- spec-reviewer BLOCK on one HIGH: a run that failed for good stopped the schedule (the next day was queued only after a success). code-reviewer BLOCK on one HIGH: the part-way failure path had no test.
- Fixed, tests first: the next day is queued before the run; a run failing part-way keeps what it sent and its retry sends the rest once (both new tests). Also: the tyre query reads only rows not sent this season; a finished day keeps its job id for two days (a restart does not rerun it) and a failed one frees it (a restart retries it); the module exports nothing; `REMINDER_DAY_MS` documented (commented out) in `.env.example`; plan's job id corrected.
- Kept, owner's call: `ObjectTimers` with no production caller yet (FR-010, the brief's scope; plan Complexity Tracking). Deferred: the Playwright bell check (deferred.md).
- diff-audit: its `import-extension` errors are the known repo-wide false positive (the libs use extensionless imports throughout); its base is the stale local `main`. Mutation testing: CI only.

## Hand-off
- Merged origin/main (ST-257's outbox relay): `apps/worker/src/main.ts` conflict resolved (both modules imported); the reminders migration renamed `20261005160000_reminders` to sort after ST-257's `20261005150000_outbox_event`. PR body filled and checked, PR #78 ready, story and timeline QA.
- Deferred findings filed as 2 To do tasks. The finish and ready lines are committed before the merge, as the last commit QA tests; the Notion writes they name happen right after the merge.
