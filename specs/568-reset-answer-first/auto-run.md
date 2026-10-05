# /speckit-auto run — 568-reset-answer-first

Description: ST-568 Answer a password-reset request before issuing the link (tech debt from ST-127 review)
Start commit: be4813dcb3ade4800a2b90e9afe30af8c9ad20b5 (origin/main)
Worktree: .worktrees/568-reset-answer-first

## Preflight
- Rules read on origin/main: AGENTS.md, CLAUDE.local.md, constitution v1.8.1.
- Notion: ST-568 To do, Ready to work, PR empty; no GitHub PR for it.

## 0. Size
- Level 1 (one-session): one service method and its tests (`level.mjs suggest` agreed). Phases: 2, 7, 9, 10, 12, 14, 16.

## 2. Specify
- Spec written from the story body; 4 assumptions marked (autonomous default).
- Branch created by hand (`568-reset-answer-first`) because the worktree had to exist before the run; `.specify/feature.json` points at it.
- Draft PR #107 opened from the template with `planning`, `bug`, `scope: auth`, `EP-1`; Notion PR property written.
- Title type `fix`: the change closes an account-existence timing hint and changes behaviour (answer order), so not `refactor`.

## 7. Tasks
- tasks.md: T001–T005 (tests first, then the service, then proof); T006 added during implement for the e2e mailbox.

## 9. Tests
- Red proven with `drain`/`beforeApplicationShutdown` stubbed: Tests 2 failed, 52 passed, 54 total (both new tests time out at 2000 ms on the held e-mail).

## 10. Implement
- Notion Planning → Implementing; PR label in development.
- `ask` issues the link after the answer and tracks it; `drain()` and `beforeApplicationShutdown` wait for it.
- Green: Tests 54 passed, 54 total, three runs in a row.
- One send writes an in-app and an e-mail row; the shutdown test counts the e-mail channel only.
- web-e2e read the mailbox right after the confirmation; it now polls (`expect.poll`), since the link lands just after the 202.
- First commit attempt refused by pre-commit: `audit-coverage.spec.ts` read `this.issuing.delete(...)` (a Set) as a Prisma model write and named `PasswordResetService.ask`. Narrowed the scanner (a model write is never on `this.<field>` directly; every such call in the code is a Map or Set) instead of exempting `ask`, with two self-checks: the injected client is still caught, a service's own set is not.
- Spec Delta: 127-FR-001 is not in `accounts.md` yet, so Modifies is none and the change to it is a note under the delta (artifact-lint clean).
