# /speckit-auto run — 555-account-link-params

Description: ST-555 keep the account link (token included) out of stored notification params (tech debt from ST-81, PR #71)
Start commit: 591fcc3caf012becfaa4868df4ea8a8dd5f6ea7f (origin/main)
Worktree: .worktrees/555-account-link-params

## Preflight
- Rules read on origin/main: AGENTS.md, constitution v1.8.1 (VII); CLAUDE.local.md (local, untracked).
- No branch, spec folder or PR for ST-555 existed. Out of scope: ST-556, ST-560, ST-561 (same module).
- Branch created by hand off origin/main with its upstream unset; draft PR #127 opened.
- Preflight suite: `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` → exit 0.

## 0. Size
- Level 1 (one-session): two methods in the notifications service and processor, their tests, and the e2e test mailbox. Phases: 2, 7, 9, 10, 12, 14, 16.

## Design check
- No boards (tech-debt task, empty Design rollups, no screens). `design.md` written.

## 2. Specify
- Spec written from the story; 5 assumptions marked (autonomous default).
- Fix chosen: drop the link once sent or failed; the bell row never holds it.

## 7. Tasks
- `tasks.md`: T001–T005 tests, T006–T007 the change, T008 proof.

## 9. Tests
- 8 tests in `notifications.processor.integration.spec.ts` ("the link an account e-mail carries"). Red: `npx jest …notifications.processor.integration.spec.ts` → 8 failed, 30 passed. The retry test fails only on its bell row (the queued row keeps its link by design).
- E2E: `apps/web-e2e/mailbox.mjs` (Brevo stand-in, port 3025) started by `playwright.config.mts`; api and worker get `EMAIL_SENDING=on` against it; `password-reset.spec.ts` reads the reset link from the sent e-mail. Mailbox smoke-tested by hand; the flow runs in CI's E2E job.

## 10. Implement
- `notifications.service.ts`: `IN_FLIGHT_ONLY = ['link']`; the bell row and a row written failed leave it out; `forget(ids)` (`params - 'link'`) runs in `fail()`. `notifications.processor.ts` `sent()` calls it.
- `npx jest libs/domain/src/notifications libs/domain/src/auth` → 54 suites, 1619 tests passed.
