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

## 9. Tests
- 3 tests added in `bell.spec.ts` and "marks one read and lowers the count" reworded to read the server's count. Red: `npx jest apps/web/src/app/dashboard/bell.spec.ts` → 2 failed, 30 passed (the echo-first and new-arrival tests). The count-reload-fails test passed before the change by design: FR-002 keeps today's fallback, and the test guards it.

## 10. Implement
- `BellStore.read()`: after the read's answer it reloads the count with `refreshCount()`, and lowers it by one only when that reload fails. `sh scripts/heavy.sh npx nx run web:test` → 51 suites, 824 tests passed.

## 12. Harden
- artifact-lint: 0 errors. diff-audit: base is the stale 7fa0467; every finding is in ST-199's generated `libs/data-access` and `libs/domain` files, none in this branch's files. Jev lane unavailable (no key).
- code-reviewer: APPROVE, no findings (on 946bb7f).
- test-adversary: `bell.badge.adversary.spec.ts`, 16 tests; 3 failed on 946bb7f. Per the coordinator: two are a real defect (an older count answer landing last overwrote a newer one), one a double tap lowering the badge twice when the count fails; plus a spec gap (echo reload shown, then the read's reload fails, the fallback lowered the badge again). Gap test added to `bell.spec.ts`; red: 4 failed, 45 passed. Fixed in `refreshCount()` (answers ordered by request) and `read()` (fallback skipped after a later-asked count; one read in flight per row). One adversary test was mis-modelled (its echo marked the tapped row read, so the tap sent nothing): it now echoes another row. A first cut that returned null for a stale answer broke "mark all elsewhere during a new arrival"; the caller now keeps its own answer. `npx jest apps/web/src/app/dashboard/bell` → 59 passed.
- No local mutation run (mutation tests run only in CI).

## 14. Review
- spec-reviewer: APPROVE, no findings (on 946bb7f). The adversarial fixes are re-reviewed below.
