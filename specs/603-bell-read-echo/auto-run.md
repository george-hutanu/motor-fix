# /speckit-auto run — 603-bell-read-echo

Description: ST-603 Keep the bell's loaded rows when a read comes back live (tech debt from ST-199, PR #80)
Start commit: 93921d056129f810e9b9cf3ac0d9ff8d201591dc (origin/main)
Worktree: .worktrees/603-bell-read-echo

## Preflight
- Rules read on origin/main: AGENTS.md, CLAUDE.local.md, constitution v1.8.1 (VII).
- Task choice among the five ST-199 debt tasks: ST-603 (Medium, Ready to work, no PR) chosen. ST-604 not Ready to work; ST-607 edits `apps/web/src/app/dashboard/frame.ts`, changed by open PR #103; ST-605 and ST-606 Low. `bell.ts` and `bell.spec.ts` are in no open PR (#103, #106, #107, #108).
- Branch created by hand off origin/main with its upstream unset (a bare `git push` would have targeted main); pushed with `-u origin 603-bell-read-echo`.

## 0. Size
- Level 1 (one-session): one store method in `bell.ts` and its spec. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No boards (tech-debt task, empty Design rollups); mock opened, no notification list in it. `design.md` written.

## 2. Specify
- Spec written from the story; 4 assumptions marked (autonomous default).
- Fix chosen: merge the reloaded first page for every `notification.read` (the story's second option), which also fixes other tabs, instead of recognising this tab's own echo.
- Preflight suite: typecheck and lint green; api and domain tests green once the worktree's PostgreSQL and Redis were started (`scripts/test-services.ts`), every other project green.

## 7. Tasks
- `tasks.md`: T001–T006 tests, T007 the `BellStore` change, T008 proof.

## 9. Tests
- 5 tests added in `bell.spec.ts`, replacing the one that encoded the reset to the first page. Red: `npx jest apps/web/src/app/dashboard/bell.spec.ts` → 5 failed, 19 passed (every new test fails, every other passes).

## 10. Implement
- `BellStore`: on `notification.read` the event's row is marked read with the event's `at`, the count is reloaded (zero marks every row read), and the reloaded first page is merged in with `merge()`; the cursor is left on the last row loaded. 24/24 bell tests green.
