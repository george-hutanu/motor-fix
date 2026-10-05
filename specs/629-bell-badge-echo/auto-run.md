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

## Re-review patches (lap 2)

- Code re-review APPROVE, spec re-review APPROVE. Applied: 4 adversary tests that repeated `bell.spec.ts` deleted (its MEDIUM at :242 among them); the local `shown` in `read()` renamed `row`.
- Re-review MEDIUM (readAll's 0 not ordered against a count already in flight): fixed in this story, test first, rather than deferred. Red: "keeps the count at zero after mark all when an earlier count answers late"; green after `readAll()` takes a request number before it sets 0 (FR-003a). Bell suites 56/56; `web:test` green. Nothing deferred.

## Hand-off

- PR #112 body updated (pr-body-check passes), marked ready; ST-629 Implementing → QA, labels QA. `origin/main` merged in (13 behind; no conflict; web test 982/982, typecheck green).
- CI on 550218c: every check green, CI OK included.
- QA lap 1 (PR QA run 37296299108, report in `pr-review/lap1/`): agent-review success, 0 blocking, 2 low. Both one-line, fixed rather than deferred: the double-tap adversary test now also asserts one read is sent (FR-004); the PR body's test count corrected to 5 new. The tester's first dispatch (run 37295866259) was discarded by the tester itself: the production service worker bypassed its network holds. Records committed with that fix; tester runs once more on the new head.
