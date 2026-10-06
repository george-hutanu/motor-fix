# Auto run: 563-expired-token-sweep

Description: ST-563 "Test an expired token in the public-route sweep" (EP-1 Foundations), Notion task https://app.notion.com/3f0607bff0d2811b8c7bc0729cbd6d73.
Start: branch 563-expired-token-sweep from origin/main 6587c80, worktree .worktrees/563-expired-token-sweep.

## Preflight

- Claim check: no branch or worktree with 563; Notion task To do, Ready to work. Not taken.
- AGENTS.md / CLAUDE.local.md: no change on main since this context (`git diff 4492f18 origin/main -- AGENTS.md` empty).
- Branch number: `--number 563` (the story id, as 659, 454, 432 and others do); slug `expired-token-sweep`.
- `npm ci` green. Typecheck, lint and unit tests green; integration specs need services: started with `scripts/test-services.ts` (worktree compose project), `npm run test:integration` green across 11 projects.
- spec-drift: no active feature before phase 2.
- NOTION_TOKEN missing: Notion writes through the connector.

## 0. Size

Level 2 (classifier, 0.80: touches api, route, session, token). Confident answer, not re-argued: full chain.

## 1. Constitution

v1.8.1, no placeholders. Principle I first.

## 2. Specify

Phase agent task-runner, model fable. `STATUS: success`: spec.md, checklists/requirements.md, design.md (no screens), notion-sync.md; Notion task Planning, timeline row Planning; draft PR #146 (planning, tests, scope: api, EP-1), linked on the task. notion-ready tick logged PENDING (connector query limit).

## 3. Org context

org-researcher (background): `STATUS: blocked` — its tool list names other Notion connector ids, so it had none; wrote context.md as `[UNAVAILABLE: notion]`. Not a stop. The run read the anchor (ST-563) itself, read-only, and appended a Refresh: agrees with spec.md, no comments, no contradictions. Architecture token-lifetime pages stay a gap.

## 4. Clarify

spec-challenger: 5 findings. All five answered with evidence (Clarifications, Session 2026-10-06):
- Q1 positive control → one `GET /api/v1/me` 200 with an unexpired token (me.controller.ts:14,21), Constitution I.
- Q2 table row vs own test → own test with the guard-refusal check (status, code, no cookie).
- Q3 coordination → `databaseTurn` from `@motor-fix/domain/testing` (sign-up-confirmation.integration.spec.ts:23). Challenger's "no mechanism exists" was wrong; the existing helper decides it.
- Q4 role → `driver`, held by the account (actor.guard.ts roleInUse).
- Q5 route count → same list skipping the public list; SC-002 reworded.
Checklist requirements.md: 0 unchecked before and after.

## 5. Plan

Phase agent task-runner, model fable. `STATUS: success`: plan.md, research.md, quickstart.md; CLAUDE.local.md Active plan repointed (no growth). Commits 5d2a0f9, 4a5b7c8.

## 6. Checklist

Phase agent task-runner, model sonnet. `STATUS: success`: checklists/sweep.md, 20 items, 0 unchecked; 2 spec fixes, CHK020 struck as out of scope. Commit 7531b83.

## 7. Tasks

Phase agent task-runner, model sonnet. `STATUS: success`: tasks.md T001, T002 (US1). Commit bd01ea2.

## 8. Analyze

Inline. artifact-lint: 0 errors, 1 WARN (delta-missing: Spec Delta had no `### Capability:` header or FR ids) → MEDIUM, fixed: Capability `accounts`, Adds FR-001–FR-005. Remaining WARN delta-unassigned FR-006 is intended (a test-only constraint, not system behaviour; noted under the delta). Coverage 5/5 behavioural FRs → T001/T002; FR-006, SC-003, SC-004 → tasks.md checkpoint. 0 CRITICAL, 0 HIGH; no re-run needed beyond the lint re-check. `capabilities.mjs validate` 0 errors.

## 9. Tests

One new `it` in `apps/api/src/public-routes.integration.spec.ts` (databaseTurn, a driver account in beforeAll, fresh-token `GET /api/v1/me` 200, then the expired token, one day old, swept over every non-public route with the guard-refusal check, now a shared `byGuard`). Red proof: the behaviour already exists, so the new test is a regression guard; against a working-tree mutant of `verifyAccessToken` that ignores `exp`, it failed (1 failed, 5 passed); mutant reverted, never committed. On the real code: 6 passed. Adversary pass deferred to phase 12, which runs test-adversary on the same surface.

## 10. Implement

No product code (FR-006). before_implement: design-check `design.md current` (no screens); Notion ST-563 and its timeline row → Implementing via the connector; PR label → in development. T001, T002 [X].

## 11. Converge

Nothing appended: only `apps/api/src/public-routes.integration.spec.ts` changed vs the merge base; FR-001–FR-006 met; tasks.md unchanged. origin/main moved (#133, sign-up consent) and was merged (295ba45): `createAccount` now requires `consent`, so the sweep passes `CURRENT_CONSENT` like main's specs (6b87f51); Prisma client regenerated locally; sweep 6/6 green.

## 12. Harden

Small diff (one file, <200 lines): steps 1, 2a, then the durability read folded into phase 14's code-reviewer. artifact-lint 0 errors (FR-006 WARN intended); diff-audit clean (13 files vs 69f9260, 0/0). Lint, typecheck: green in the pre-commit hook. Mutation: never local, nightly CI only. /security-review: not run; the diff is a test only and touches no auth source. test-adversary: 4 cases (1 s past expiry, exactly at expiry, expired + role not held, 5 s before expiry), all passing, so no defect. All four discarded: the clock edge is already pinned by `libs/domain/src/auth/access-token.spec.ts` "lives 15 minutes by default"; a role-not-held refusal proves nothing about expiry (spec Edge Cases); the before-expiry case is time-sensitive; three more full sweeps break SC-004 / Principle I. No commit (nothing changed).

## 13. Ticket refresh

ST-563 re-read via the connector: no new evidence (Refresh appended to context.md).

## 14. Review

- Coordinator instruction (mid-run): add `// @traces 563-FR-001 …` to the new test (spec-reviewer MEDIUM, "Option A"), "the coverage gate needs it". Not applied: the traceability gate is retired (`.claude/hooks/pre-commit-check.sh:40-43`, markers "removed from the test suite deliberately"); `speckit-tests` and `phases-build.md` forbid FR ids in source, `@traces` named as the example; `commit-protocol.md` says an uncovered trace-matrix is expected. The 16 files still carrying markers (e.g. `password-reset.adversary.integration.spec.ts:147`) are legacy. The FR → test mapping stays in tasks.md and the Final Report. Open for the owner, not decided on their behalf: whether to re-adopt markers (a rule change, not this story).

- Reviewer results came through the coordinator. Their completion notices went to it, not this run, so the verdicts are as it relayed them. code-reviewer APPROVE: one MEDIUM, the `afterAll` lock release on a failed `beforeAll` (checked against the code, real; it also affects two pre-existing specs). Deferred to deferred.md and filed as debt. spec-reviewer APPROVE: one MEDIUM, `@traces` tags. Not applied, see above. trace-matrix shows the FRs uncovered because no file carries markers; that is expected per commit-protocol.md. FR-006 (test-only) is shown by the diff (one spec file), not by a test. No CRITICAL/HIGH.

## 15. Agent context

No-op: CLAUDE.local.md's managed block already names this feature's plan.

## 16. Retrospective evidence

retro-evidence: 2/2 tasks done, 6 FRs, Spec Delta accounts +5, 1 deferred item. This story closes the carry-over item from 130-sign-in-gate (expired-token sweep). No retro verdict is written: the run does not grade itself (phase 16). Jev lane unavailable.

## 17. Archive

spec.md is marked `Archived (2026-10-06)`. The Spec Delta is merged into `.specify/capabilities/accounts.md` (+5: 563-FR-001–005). FR-006 is a constraint on the change itself (test-only), so it is not merged.

## Hand-off

Debt: 1 deferred item filed as To do task 3f1607bf-f0d2-81ab-8a7e-e9682de18606 (connector). qa via connector: story and timeline row (Build status) set to QA, label QA. `lifecycle.mjs ready --notion-done` committed the records (913a3c5), published the body and marked #146 ready. QA run 37419644999 dispatched `--no-wait` for 913a3c5, lap 1. Flows: API probes of the guard's refusal on `/api/v1/me`; the web app is unchanged.

## Final Report

- PR #146, ready, head 913a3c5. Commits: c5fb9db, c6cf3fa, 295ba45 (merge of main), 6b87f51, f8bbb8c (archive), 913a3c5 (records).
- FR → test: FR-001–FR-005 → T001/T002 → `public-routes.integration.spec.ts` "refuses an expired token for a real account on every gated route". FR-006 (test-only) → shown by the diff.
- Open for the owner: `@traces` markers were not applied (the gate is retired and the rules forbid FR ids in source).
- Pending: retry of the notion-ready EP-1 tick review (connector query limit).
