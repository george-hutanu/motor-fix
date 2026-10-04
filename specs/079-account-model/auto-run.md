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
- (see below)

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

## Phase 4 (cont.)
- Resolved from context without questions: token carries role (ST-394); FR-015 staff conditions deferred to quote/job epics; table in domain lib; A34 403 intra-garage is for later endpoints; port payloads follow ST-390/ST-257 names; UUID/UTC types; assistant context deferred to EP-16.
