# Auto run — 079-account-model

- Description: ST-79 Set up the account model, the four roles and their rights (epic EP-1); AuditPort no-op for ST-390.
- Start commit: 3f717c6c11b66f23ded60bc502f94477df02105e (origin/main), branch 079-account-model (GIT_BRANCH_NAME given by orchestrator)
- Worktree: .claude/worktrees/agent-a42e232c763c2eb93; DB motorfix_st079, Redis db 1

## Preflight
- Tree clean; typecheck green, lint green, jest 14 suites / 157 tests green.
- spec-drift --status: no active feature before specify.

## Phase 0 — Size
- Level 2 (feature): intent has design choices (role scoping, token boundary with ST-82, port shapes).

## Phase 1 — Constitution
- v1.1.0 read, no placeholders. Principle I first.

## Phase 2 — Specify
- Story ST-79 read from Notion (no open discussions); Build brief governs. ST-82 read for the token boundary.
- Autonomous: token format defined here, signed by ST-82 (spec Assumptions).
- Autonomous: event port no-op mirrors audit port; outbox is a slice-4 story.
- Autonomous: GARAGE_FEATURE check not built (brief: all features on until EP-2).
- Autonomous: assistant context not modelled (Principle I).
- Autonomous: admin CLI script deferred to the admin account story.
- Autonomous: e2e stubs "who am I"; real sign-in e2e is ST-82's.
- after_specify hooks: notion-sync start (story + timeline In progress; epic unchanged); design-check wrote design.md (mock v1791040637-c375 read); git commit hook: deferred to the first implementation slice (artifacts commit with it); agent-context: phase 15.

## Phase 3 — Org context
- org-researcher wrote context.md: 33 findings (11 decisions, 5 constraints, 2 open, 6 contradictions, 8 proposals). Data model and Backend architecture pages too large; column types a gap.

## Phase 4 — Clarify (5 questions, spec-challenger + context.md)
- Q1 capability list → FR-010 enumerated from Security matrix; "may not" = complement.
- Q2 account_suspended → 403, checked first; "never 403" narrowed to rights/ownership.
- Q3 garage membership unique per (account, role); none → garage empty → 404.
- Q4 only endpoint is "who am I"; FR-009 tested at use cases + route list.
- Q5 customer view takes ownJob input.
- Also resolved from context.md without a question: token carries role (ST-394); FR-015 staff conditions deferred to quote/job epics; table in domain lib; A34 403 intra-garage is for later endpoints; port payloads follow ST-390/ST-257 names; UUID/UTC types; assistant context deferred to EP-16.

## Phase 5 — Plan
- plan.md, research.md, data-model.md, contracts/me.md, quickstart.md. Constitution Check PASS; Complexity Tracking: two no-op ports, signAccessToken used by tests until ST-82.
- Decisions: auth module in libs/domain (not a new libs/auth); opt-in ActorGuard (no global guard); HS256 via node:crypto; web reads capabilities from /me; app/** client-rendered.

## Phase 6 — Checklist
- checklists/security.md: 17 items, all evaluated [x]; CHK007 fixed via FR-011/data-model.

## Phase 7 — Tasks
- tasks.md: 19 tasks (Setup 1, Foundational 4, US1 3, US2 7, US3 3, Polish 1). New capability file .specify/capabilities/accounts.md so the Spec Delta resolves.

## Phase 8 — Analyze
- artifact-lint: 2 fr-untasked (ranges not parsed → listed explicitly) + delta-unknown-capability (capability file created) → 0 errors on re-run. Jev lane unavailable (no key).
- Analysis: 0 CRITICAL, 0 HIGH; MEDIUM: FR-003 lacked argon2id (context.md) → applied. Coverage 18/18 FRs.

## Phase 9 — Tests (red first)
- Wrote capabilities, access-token, policy, accounts.service (DB), auth.api (HTTP, DB), problem.filter, area.guard, frame specs and the dashboards e2e.
- RED: `npx jest libs/domain/src/auth apps/api/src/problem.filter.spec.ts apps/web/src/app/dashboard` → "Test Suites: 8 failed, 8 total" (7 cannot resolve the modules under test, problem.filter 1 failed / 1 passed: the pre-existing status→code mapping is a regression guard).
- test-adversary added auth.adversary.spec.ts (58 cases) and auth.adversary.http.spec.ts (~75): 9 pure failures → fixed as defects (empty sub, null payload, padded signature, non-string token, null permissions); HTTP: tab/double-space bearer accepted → strict `^Bearer (\S+)$`; duplicate roles → de-duplicated; problem+json check moved to apps/api bootstrap.spec (the filter is wired by configureApp, not by AuthModule).

## Phase 10 — Implement
- Checklist gate: requirements.md 16/16, security.md 17/17 → PASS.
- DB tests ran in parallel Jest workers on one database and truncated each other's rows → serialDatabase() advisory lock helper (libs/domain/src/auth/serial-db.testing.ts, *.testing.ts excluded from the lib build).
- openapi needed `.addBearerAuth()` (apps/api/src/bootstrap.ts) for the generator to resolve the bearer scheme.
- Commits: c89f3f5 feat(auth) store accounts…, 06e9531 feat(auth) run every call as an actor…, aee19c4 feat(web) land each role…
- Verification: `npx jest libs/domain apps/api apps/web libs/contracts` → "Tests: 393 passed, 393 total"; `npm run typecheck` → "Successfully ran target typecheck for 9 projects"; `npm run lint` → "Checked 121 files … No fixes applied"; `nx run web-e2e:e2e` → "8 passed".

## Phase 11 — Converge
- Converged: 18/18 FRs met in code; no tasks appended. No Jira (Notion is the tracker); refresh in phase 13.

## Phase 12 — Harden
- artifact-lint: 1 error (T004 phantom `<ts>` path) → fixed → 0.
- No stryker.config.json in any touched package → mutation step not applicable.
- security-review: no HIGH/MEDIUM findings ≥ 8 confidence.

- diff-audit (--no-jev): 0 errors. WARN untested-new-file only: most are ST-421's files, because the audit compares against the worktree's stale local `main`. Mine (audit.port, event.port, actor.guard, prisma, serial-db.testing) are covered through the auth specs → kept.
- Full suite: `npm run test` → "Successfully ran target test for 7 projects". `npm run test:harness`: 2 failed / 348 passed. Both failures are in artifact-lint.spec.mjs "diff-audit — the same default" and are timeouts (26 s, 53 s): diff-audit takes minutes in this worktree against the stale local main. They are environmental, not caused by this change, and left unchanged.

## Phase 13 — Ticket refresh
- ST-79 unchanged since 05:24Z (our own status write); no comments. Query Data Source hit its usage limit → sibling stories not re-queried ([UNAVAILABLE] logged in context.md).

## Resume (2026-10-04, after interruption)
- Log fix: the trailing "## Phase 4 (cont.)" was the clarify phase's no-question answers, appended at the end and then pushed below later phases; folded into Phase 4.
- Re-verified before resuming: `npx jest libs/domain apps/api apps/web libs/contracts` → "Tests: 393 passed, 393 total"; typecheck exit 0; lint exit 0.
- Committed the 5 dirty spec files (836c6b1), pushed `079-account-model`, opened draft PR https://github.com/george-hutanu/motor-fix/pull/3 (owner's new working rule).
- Notion: a previous run had set ST-79 story and its Foundations timeline row to In review. New rule: In review only when the owner marks the PR ready → both reverted to In progress (notion-sync.md). Query Data Source still at its usage limit; timeline row found through search.

## Phase 14 — Review
- Ran directly as spec-reviewer + code-reviewer subagents in parallel (Agent tool), range 3f717c6..HEAD; no Workflow tool, so not the verified `speckit-review` path.
- spec-reviewer: APPROVE. MEDIUM: T001 incomplete, `AUTH_TOKEN_SECRET` missing from the ci.yml job env → fixed (`ci-test-secret`). Cross-story contracts all hold.
- code-reviewer: BLOCK on 1 HIGH: `roleInUse` fell back to `lastRole` when an account had no role rows, so a fully revoked account kept its last role's rights → now returns null and ActorGuard answers 401 `sign_in_required`; spec edge case added; red first (2 failed), then green. Account loading extracted to `activeAccount()` to stay under Biome's complexity limit.
- Unfixed MEDIUM/LOW (reported): secret length not enforced; web Session treats a /me 5xx or network error as signed out; signAccessToken/AccountsService/assertOwner/assertGarage have no production caller yet (kept: ST-82 and later stories use them, agreed contract); token lifetime a default parameter; AuthModule owns its own PrismaClient; redundant `?.` in capabilitiesOf.
- After fixes: `npx jest libs/domain apps/api apps/web libs/contracts` → "Tests: 395 passed, 395 total"; typecheck exit 0; lint "Checked 121 files … No fixes applied".
