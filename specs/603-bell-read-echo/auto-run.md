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
