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

## 12. Harden
- artifact-lint: clean after the Spec Delta fix. diff-audit: clean.
- Mutation: not run locally (AGENTS.md: mutation tests only in CI; nightly `mutation.yml`).
- test-adversary, code-reviewer and spec-reviewer dispatched in parallel on be4813d..HEAD.

## 16. Retro evidence
- 6 tasks done, 3 FRs, 2 commits, 9 files +292 −24; Spec Delta accounts +3. Jev lane unavailable (no key).
- Carryover applied: the story touches more than one project (domain, web-e2e), so `npm run test` runs over the whole workspace before ready.
- test-adversary: 15 tests in `password-reset.adversary.integration.spec.ts`, 14 passed, 1 failed: a lookup error whose message holds the address was logged verbatim (FR-002 says without the address). Fixed: the issuing's log carries the error's class (and code, if any), never its message. Reset specs: 69 passed, 69 total.

## 14. Review (lap 1)
- code-reviewer and spec-reviewer: both APPROVE; no CRITICAL/HIGH.
- MEDIUM (both): a scenario's link could still be issuing when the next test reset the database (P2034 seen). Fixed: `beforeEach` drains first, in both reset suites.
- MEDIUM decision: the scanner exempted every `this.<field>.<write>`. Chose exempt-by-argument-shape: a field call with Prisma's arguments object still counts as a write. Self-check added (red, then green).
- LOW decision: `drain()` took one snapshot, and Nest answers requests until after the shutdown hooks. Chose a bounded re-drain (up to 3 rounds), not a deferral. Test "waits, on shutdown, for a link asked for while it was waiting": red (Expected false, Received true), then green. The hold helper now binds the unspied method so two holds do not recurse.
- Reset and audit suites: 93 passed, twice. Repair laps: 1 of 5.
- Whole workspace (`npm run typecheck && npm run lint && npm run test` under heavy.sh): typecheck 13 projects, test 11 projects, green.

## Hand-off
- Merged origin/main (62 behind, no conflicts; rules unchanged, constitution v1.8.1). `audit-coverage.spec.ts` changed on main too (BellService exemptions): 24 passed after the merge.
- PR body filled (pr-body-check passes), `gh pr ready 107`, Notion Implementing → QA, label QA.
