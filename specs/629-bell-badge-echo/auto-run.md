# /speckit-auto run — 629-bell-badge-echo

Description: ST-629 Keep the bell's badge right after this tab's own read (tech debt from ST-603, PR #109)
Start commit: 462b3ea72328a98cbd11cf45402123040c384a7d (origin/main)
Worktree: .worktrees/629-bell-badge-echo

## Preflight
- Rules read on origin/main: AGENTS.md, constitution v1.8.1 (VII); CLAUDE.local.md (local, untracked).
- Task choice: candidates ST-605, ST-606 (Low), ST-630 (Low, the out-of-order reload) and ST-629 (Medium, the badge count; the "Medium" task ST-603's finish comment links). ST-629 is Ready to work, has no PR, and `bell.ts`/`bell.spec.ts` are in no open PR (#103, #107, #111). Highest priority left: ST-629.
- Branch created by hand off origin/main with its upstream unset.
- Preflight suite: `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` → exit 0 (11 test projects green).

## 0. Size
- Level 1 (one-session): one store method in `bell.ts` and its spec. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No boards (tech-debt task, empty Design rollups); mock opened (version 1791040637-c375), no bell or badge in `DashClient`. `design.md` written.

## 2. Specify
- Spec written from the story; 4 assumptions marked (autonomous default).
- Fix chosen: `read()` takes the server's count after its answer, falling back to lowering by one when the reload fails, instead of recognising this tab's own echo.

## 7. Tasks
- `tasks.md`: T001–T004 tests, T005 the `BellStore` change, T006 proof.
