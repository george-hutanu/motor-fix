# /speckit-auto run — 571-news-fan-out-worker

Description: ST-571 move the news fan-out to a worker job (tech debt from ST-201, PR #76)
Start commit: d5afba7e4b0e5947af8b5c0994dfe83e53038273 (origin/main)
Worktree: .worktrees/571-news-fan-out-worker

## Preflight
- Rules read on main: AGENTS.md, CLAUDE.local.md; constitution v1.8.1.
- No branch, PR, spec folder or worktree for ST-571 or a news fan-out existed (only ST-201's merged `201-news-consent`).
- Branch created off origin/main; draft PR #128 opened from the template, labels planning, tech debt, scope: notifications, EP-1; PR link written to Notion.
- Kept out of `notifications.service.ts` and `notifications.processor.ts` (PR #127, ST-555, in QA).

## 0. Size
- Level 1 (one-session): one service, one new class, module wiring, the worker's bootstrap, their tests. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No boards (tech-debt task, empty Design rollups, no screens). `design.md` written.

## 2. Specify
- Spec written from the story; 6 assumptions marked (autonomous default). Key one: the worker reads `AUTH_TOKEN_SECRET` as optional.

## 7. Tasks
- `tasks.md`: T001–T006 tests, T007–T009 the change, T010 proof.

## 9. Tests

- Red: 2 suites failed (TS2307 cannot find module './news.fan-out') before the implementation.

## 10. Implement

- `news.fan-out.ts` (queue `news`, `NewsFanOut` handle/failed, `giveMonthBack`), `news.service.ts` claims and queues, `notifications.module.ts` wires the queue (API + worker) and the worker (only with the token secret), `apps/worker/src/main.ts` passes `AUTH_TOKEN_SECRET`.
- Green: news + reminders specs, 9 suites, 110 tests. One test fix: the Logger spy was restored (clearing its calls) before the assertion.

## 12. Harden

- artifact-lint: clean. diff-audit: `import-extension` ERRORs are the known false positive (moduleResolution bundler, as in 016–052); `untested-new-file` on news.fan-out.ts is false (both specs import it).
- test-adversary: 33 tests in `news.adversary.integration.spec.ts`, 1 failed: a repeated final failure wrote a second release entry. Fixed: `giveMonthBack` records the release only when it removed a claim.
- code-reviewer BLOCK: #1 HIGH no real last-attempt failure through the BullMQ worker — added a worker test (attempts 1, notify rejects, the claim goes, the job is removed) and typed `failed` on bullmq's `Job`, dropping the stub interface. #2 MEDIUM missing PUBLIC_WEB_URL would release a month after ~31 min — autonomous answer Option A: the news worker does not start without it, like the token secret (FR-006 amended). #3 `.env.example` comment, #4 one logger: fixed. #5 retry policy env knob: deferred, filed as a Notion task.
- Mutation: CI only (repo rule).
