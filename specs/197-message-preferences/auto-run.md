# Auto run — 197-message-preferences

- Description: ST-197 Store each person's message choices and check them before sending (https://app.notion.com/p/3ee607bff0d2813a8daaf36ef87fada9).
- Start commit: 9e6afb1 (origin/main); branch `197-message-preferences`; draft PR #68.
- Picked as the highest-priority ready EP-1 item (High; Highest had none ready); ST-394 and ST-432 also High, ST-197 has the lowest wave (W3) and number. ST-128 skipped by instruction.

## 0. Size
- Level 2 (feature): new table, API and a pipeline change. (autonomous default)

## 1. Constitution
- Read `.specify/memory/constitution.md`; Principles I, II, VII carried.

## Preflight
- Clean tree on a fresh branch from origin/main; origin/main's CI was green at merge of PR #64 (the repo starts green). node_modules linked from the main checkout (same `package-lock.json` hash); integration tests run against a dedicated database `motorfix_197` so parallel agents never truncate each other's rows.

## 2. Specify
- spec.md written from the Build brief; 5 autonomous answers in Clarifications.

## 3. Context
- context.md written from the story, its timeline row and the epic (all read this session through the Notion connector).

## 4. Clarify (spec-challenger)
- Q1 garage of a message → optional `garageId` on `notify` (FR-009).
- Q2 `accountId` parameter → dropped; the routes take no account id (FR-007, Principle I).
- Q3 audit granularity → one per group switch plus one per changed choice (FR-011).
- Q4 `enabled` optional? → required (FR-005).
- Q5 SC-004 count, FR-003 else-branch → 7 of 7; else-branch dropped (every driver type allows e-mail).

## 5–8. Plan, checklist, tasks, analyze
- plan.md, data-model.md, contracts/, tasks.md; artifact-lint clean.

## 9. Tests (red first)
- `preferences.spec.ts`, `preferences.api.integration.spec.ts`, `preferences.pipeline.integration.spec.ts` written before the code: `jest libs/domain/src/notifications/preferences` → Test Suites: 3 failed, 3 total (module and route missing).

## 10. Implement
- Prisma model + migration `20261005090000_notification_preferences`; DTOs; `preferences.ts` (groups, defaults, muted channels, save plan); `preferences.service.ts`, `preferences.controller.ts`; `notify` reads the muted channels before its transaction and takes an optional `garageId`; OpenAPI and client regenerated.
- Biome flagged the save's transaction callback (complexity 28 > 10): the decisions moved into the pure `planSave`, the transaction only writes and records.
- `jest libs/domain/src/notifications/preferences` → 3 suites, 48 tests passed; notifications + audit → 23 suites, 626 tests passed.

## 11. Converge
- Every task [X]; no unbuilt work found against spec and contract.

## 12. Harden
- artifact-lint clean; diff-audit: dead exports fixed (`NotificationGroupKey`/`OutsideChannel` now the one source in contracts; `driverChoice`, `PreferenceChange`, `DRIVER_GROUPS`, `groupTypes` private); its import-extension rows are the known false positive (repo convention) and its suppression rows are in the generated client. Mutation runs only in CI (nightly), not locally (AGENTS.md).

## 13. Refresh
- Story re-read by spec-reviewer 2026-10-05: no comments, no scope change.

## 14. Review (spec-reviewer + code-reviewer, foreground)
- Both APPROVE, no CRITICAL/HIGH.
- Fixed: one source for the group keys and channels (contracts) [both, MEDIUM]; a group switch that mutes the rest of a partly muted group is now recorded (FR-011 reworded) [spec, MEDIUM, decision taken: record]; uniqueness comment corrected [both]; shared `Publisher` type; the failed preference read logs its error; redundant `enabled` description dropped.
- Deferred (deferred.md): unique index if a second writer appears; live publish onto the outbox with ST-257; the shared `refuse` helper.
- After the fixes: notifications + audit → 23 suites, 629 tests passed.
