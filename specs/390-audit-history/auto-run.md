# Auto run — 390-audit-history

- Description: ST-390 — Record every change in the audit history: the audit history writer every module uses inside its own transaction, implementing ST-79's AuditPort (no-op until now) in libs/domain, with its own Prisma schema file for the audit module.
- Start commit: 202c88e (origin/main), branch 390-audit-history created by the orchestrator's instruction (`git switch -c 390-audit-history origin/main`).
- Worktree: .claude/worktrees/agent-ac71ad0463d0f5f7f; DB `motorfix_390` on the local PostgreSQL 17 (localhost:5432), Redis db 3 (not used by these tests).

## Preflight
- Tree clean on the new branch. `npm run typecheck` green, `npm run lint` green, `npm test` green (9 projects); `nx run domain:test --skip-nx-cache` against motorfix_390 green.
- No docker on this machine; the local Homebrew PostgreSQL and Redis serve instead.
- **P1010 workaround**: `npx prisma migrate deploy` (cwd libs/domain, DATABASE_URL=postgresql://localhost:5432/motorfix_390) fails with "P1010: User was denied access on the database `(not available)`". As the orchestrator directed, migrations are applied with psql instead: `psql -h localhost -d motorfix_390 -v ON_ERROR_STOP=1 -f <migration.sql>`, ST-79's `20261004053640_accounts` first, then this story's. No grants or permissions on the shared PostgreSQL were changed.
- spec-drift --status: no active feature before specify.

## Phase 0 — Size
- Level 2 (feature): the Build brief defines done (11 scenarios), but the design has choices (append-only enforcement, actor name source, the coverage check, the key-change rule, wiring into ST-79).

## Phase 1 — Constitution
- v1.1.0 read, no placeholders. Principle I first.

## Phase 2 — Specify
- before_specify hook (speckit.git.feature) not run: the orchestrator created the branch; the spec folder is fixed at specs/390-audit-history (named after the ST number).
- Story ST-390 read from Notion with discussions (none open); Build brief governs. Epic EP-1 Build plan read: ST-390 is slice 1, after ST-79.
- Autonomous: append-only by triggers, not grants (shared DB grants are off limits; the app user owns the table locally).
- Autonomous: account deletion keeps names in entries (no anonymisation) until the lawyer answers; nothing purged here.
- Autonomous: assistant marker = caller-given grant id; grants arrive with EP-16.
- Autonomous: coverage check reads the domain service classes instead of a decorator.
- Autonomous: ST-79's create-account entries kept as ST-79 specified them.
- after_specify hooks: notion-sync start (story To do → In progress, timeline Not started → In progress, epic unchanged In progress); design-check wrote design.md (no screens); git commit hook: specs/ is tracked in this repo, so the artifacts commit with the first implementation slice; agent-context: phase 15.
- Mid-run (orchestrator): fast-forwarded to origin/fix-shell-frame-keys (3aa8faf), then to origin/main bec0eee (PR #7 merged) — the i18n check on frame.ts was red on 202c88e. frame.ts untouched.

## Phase 3 — Org context
- org-researcher returned [UNAVAILABLE: notion]: its tool list holds a different Notion connector id than this session's. The parent session read Notion read-only instead (story, epic, Decisions and ideas, Data model, ST-176, admin-actions search) and wrote context.md: 6 decisions, 8 constraints, 3 prior art, 1 open, 0 contradictions, 3 proposed clarifications. Security and Backend architecture pages not read (size).

## Phase 4 — Clarify (spec-challenger + context.md, 5 answered with the challenger's recommendations)
- Q1 coverage test → static read of domain `*.service.ts` methods with a Prisma write and no audit call; only the writer exempt.
- Q2 writer API → `record` (one entry) + a field-by-field helper; ST-79 per-role entries kept; FR-004 reworded.
- Q3 first name → trimmed text before the first whitespace, for caller and looked-up names; system "MotorFix".
- Q4 key changes → writer-owned `subject_type.field` table, no override; cancellation deferred (no column name in the Data model).
- Q5 FR-015 → indexes only; `at` = clock at insert (clock_timestamp), so one transaction's entries keep their order.
- Also from context.md without a question: role `owner` (ST-390 brief newer than ST-176's `garage`); `request_id`/`assistant_tool` not built (brief's newer list omits them); kind/text optional.
- after_clarify git commit hook: nothing committed (artifacts go with the first slice).

## Phase 5 — Plan
- plan.md, research.md, data-model.md, contracts/audit-writer.md, quickstart.md. Constitution Check PASS. Complexity Tracking: AuditPort kept (ST-79 seam), triggers in a hand-edited migration.
- Decisions: triggers for append-only (R1); `at` default clock_timestamp() (R2); JSON nulls → SQL NULL (R3); migration via `prisma migrate diff --from-schema/--to-schema` because of P1010 (R4); static TS-AST coverage check (R5); no AuditModule, AuthModule binds the writer.
- before_plan design-check: design.md current (written this run).

## Phase 6 — Checklist
- checklists/audit.md: 16 items [x], 1 struck as not applicable (localisation: views build display text). requirements.md 16/16.

## Phase 7 — Tasks
- tasks.md: 10 tasks (Foundational 2, US1 3, US2 2, US3 2, Polish 1) and the FR → test table. Spec Delta added (capability `audit`, Adds FR-001–FR-015); `.specify/capabilities/audit.md` created so the delta resolves.

## Phase 8 — Analyze
- artifact-lint: 0 errors, 0 warnings (Jev lane unavailable: no key). Manual pass: 15/15 FRs mapped to tasks and tests; no CRITICAL/HIGH. LOW: FR-012 has no test of its own (it is structural: the writer has one table) → mapped to the "stores who, what, when" test.

## Phase 9 — Tests (red first)
- Wrote `libs/domain/src/audit/audit.service.spec.ts` (writer, DB), `libs/domain/src/audit/audit-coverage.spec.ts` (the write-use-case check), and one real-writer test plus a `recordChanges` mock in `libs/domain/src/auth/accounts.service.spec.ts`.
- RED: `npx jest src/audit src/auth/accounts.service.spec.ts` (cwd libs/domain) → "Test Suites: 2 failed, 1 passed, 3 total": both DB suites cannot resolve `audit.service`. The coverage spec passes (8 tests): it is the deliverable itself (the check lives in the spec) and a regression guard over ST-79's AccountsService; its fixture cases prove it fails on a write without an entry.
- Adversarial pass deferred to phase 12 (harden runs test-adversary; one pass, not two).
