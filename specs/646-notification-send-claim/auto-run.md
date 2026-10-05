# /speckit-auto run — 646-notification-send-claim

Description: ST-646 Tech debt (ST-555): two send jobs for the same queued notification row that run at once both send it — claim the row atomically before sending, with a lease so a crash cannot strand it
Start commit: 5353159c1fb5a46f80db8cc14b815bc5dd8d89d2 (origin/main)
Worktree: .worktrees/646-notification-send-claim

## Preflight
- Rules read on main: AGENTS.md, CLAUDE.local.md; constitution v1.8.1 (VII).
- Not taken: no branch, PR, `specs/` dir or `.worktrees/` entry for 646 or a send claim (git fetch, `gh pr list --state all`).
- Branch created by hand off origin/main, no upstream until the first push.
- Preflight suite: `sh scripts/heavy.sh sh -c '… test-services … npm run typecheck && npm run lint && npm run test'` → exit 0 (11 test projects green).
- ST-571 (PR #128) touches `notifications.module.ts` and news files, not the processor or its spec.

## 0. Size
- Level 1 (one-session): one processor method, one column, tests. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No boards (tech-debt task, empty Design rollups). `design.md` written.

## Notion
- ST-646 To do → Planning; PR #130 linked; labels planning, bug, scope: notifications, EP-1.

## 2. Specify
- Spec written from the story; 5 assumptions marked (autonomous default). Claim = `claimed_at` lease column, lease = first retry delay (1 min); a losing job fails so the queue retries.

## 7. Tasks
- T001–T005 tests, T006 column, T007 processor, T008 proof.

## 9. Tests
- 7 tests in `notifications.processor.integration.spec.ts` › "two send jobs for one row". Column added first so the red is behavioural: `npx jest -c libs/domain/jest.config.cts …processor.integration.spec.ts -t "two send jobs"` → 4 failed, 3 passed (2 Brevo calls for a queued and a held row; a live claim not respected; a lapsed claim not distinguished). The 3 passing guard behaviour kept: sent-meanwhile succeeds silently, a retry leaves no claim, a grouped row leaves no claim.

## 10. Implement
- `claimed_at` column (migration `20261005170000_notification_claim`); `send()` claims with one conditional `updateMany` (queued/held, no claim or one older than `CLAIM_MS` = `retryDelay(0)` = 1 min), throws when another job's claim is live on a still-queued row, releases its own claim in `finally`. `due()` loses its status check (the claim guarantees it).
- `npx jest -c libs/domain/jest.config.cts libs/domain/src/notifications libs/domain/src/cars` → 33 suites, 819 tests passed; `nx run domain:typecheck` green; biome clean.

## Resume
- Parked by the coordinator mid-commit, then unblocked (Notion back to Implementing, `blocked` label off). Staged work committed as 8ec2654 and pushed.

## 12. Harden
- artifact-lint: 0 errors. diff-audit: 7 `import-extension` errors, all in `account-link.adversary.integration.spec.ts` (ST-555's file, base was the stale local main 79f0828); repo style is extensionless; deferred as a harness false positive. Jev lane unavailable (no key).
- test-adversary: `send-claim.adversary.integration.spec.ts`, 22 tests, all pass (one of its own mis-modelled, fixed by it). Its open boundary test (exactly 60 s) tightened to the spec: "older than the lease" → exactly 60 s is live.
- code-reviewer: APPROVE, 1 LOW (patch): the collision tests now assert `is being sent by another job`.
- No local mutation run (CI only).

## 14. Review
- spec-reviewer: APPROVE, 2 LOW: pre-existing `@traces` ids in the processor spec (deferred); T008's evidence narrower than stated → root `npm run typecheck && npm run lint` run: exit 0.
- Both specs: 67 passed.
