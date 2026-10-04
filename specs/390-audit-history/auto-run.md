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

## Phase 10 — Implement
- before_implement hooks: design.md current; notion-sync start → story already In progress (unchanged).
- Schema `audit.prisma` (ActivityLog, enums audit_action / audit_actor_role; `at` timestamptz(6) default clock_timestamp()). Migration `20261004120000_audit_history` generated with `prisma migrate diff --from-schema <main's schema copy> --to-schema prisma/schema --script`, plus the append-only function and two triggers. Applied to motorfix_390 with psql (P1010 workaround).
- `AuditService` (record, recordChanges, first-name rule, garage→owner, KEY_CHANGES set, JSON nulls → SQL NULL); `AuditPort` gains the brief's fields and `recordChanges`; `noAudit` removed; `AuthModule` binds `useClass: AuditService`; ST-79's two HTTP specs use `new AuditService()`; accounts.service.spec mock gains `recordChanges`.
- Biome complexity limit (10) on the coverage scanner → split into `isWrite`/`facts`/`scan`.
- Verification: `npx jest src` (cwd libs/domain) → "Tests: 1 failed, 550 passed, 551 total"; the one failure is health.controller.spec "is ready when PostgreSQL, Redis and storage all answer" (56 s timeout under load; passes alone; nx flagged domain:test as flaky at preflight too). `tsc --noEmit` lib + spec OK; `npm run lint` "Checked 173 files … No fixes applied".
- Fresh database: `createdb motorfix_390_fresh`, accounts then audit_history migrations with psql → applied, both triggers present. (`prisma migrate diff --from-config-datasource` drift check also hits P1010.)
- Commit 496b145 `feat(audit): record every change in the append-only audit history inside its transaction` — pre-commit (identity, typecheck, lint, test) green. The coverage spec went in the same commit (it was staged), so the planned separate `test(audit)` slice did not happen.
- Mid-run rule from the orchestrator ("push as you go, draft PR at first push, then ready → CI → merge → finish"): pushed `390-audit-history`, opened draft PR https://github.com/george-hutanu/motor-fix/pull/12. This replaces the earlier "do not push" instruction.

## Phase 11 — Converge
- 10/10 tasks built (T009 delivered inside 496b145; T010 is the final verification). No new work appended.

## Phase 12 — Harden
- artifact-lint: 0 errors. diff-audit (--no-jev): 10 ERROR import-extension, kept: the rule assumes nodenext libs; libs resolve `bundler` (tsconfig.base.json:10) and every existing domain import is extensionless (same call as 422's run). Gate scripts not edited.
- Mutation: no stryker config in the repo → not measured.
- test-adversary: `audit.adversary.spec.ts`, 76 tests, 2 failed (report relayed by the orchestrator), both defects against FR-003: (1) key order made equal objects "changed" → compare canonical JSON with sorted object keys; (2) `after` keys like `constructor`/`__proto__` read Object.prototype from `before` and crashed `json()` → `Object.hasOwn`. Spec edge case updated. `npx jest src/audit` → "Tests: 110 passed, 110 total".
- spec-reviewer: APPROVE; LOW: T009/T010 unchecked → checked.
- Biome `--write` (useSortedKeys) auto-sorted the adversary's key-order literal and made the test vacuous; the unordered object is now built with `JSON.parse`. Proven: with the old comparison the test fails ("1 failed"), with the fix "Tests: 110 passed, 110 total". One pre-commit run failed before that (the flaky 56 s health spec or the unsorted literal); the retry passed: 831912f.
- code-reviewer: APPROVE. MEDIUM #1 key-order compare → fixed in 831912f. LOW #2 test rows accumulate, LOW #3 diff-audit regex → deferred.md.

## Phase 13 — Ticket refresh
- ST-390 page: last edit 2026-10-04T07:07Z (this run's status write); no discussions. No new evidence.

## Phase 14 — Review
- spec-reviewer APPROVE (1 LOW fixed), code-reviewer APPROVE (1 MEDIUM fixed, 2 LOW deferred). No CRITICAL/HIGH; no re-review needed.

## Phase 15 — Agent context
- CLAUDE.local.md "Active plan" line pointed at specs/390-audit-history/plan.md (one line, same size).

## Phases 16–17
- Retro evidence and archive left to the owner: archive belongs after the merge; retro is not self-graded.
- Merged origin/main (b422966) into the branch before ready.

## Resume (orchestrator, after a session break)
- Heavy-command lock: the worktree guard refuses `heavy.sh git commit`, so typecheck, lint and test run through `heavy.sh` right before a plain `git commit` (the hook then hits the Nx cache).
- c5e366b docs commit; merged origin/main c03d769 (ST-50, ST-19, ST-17, harness: PR-lifecycle gate, mutation testing) → ea2a0f7, CLAUDE.local.md conflict resolved to this feature's plan line. `npm install` for main's new dev dependencies. Under the lock: typecheck 12/12, lint 232 files clean, test 10/10 projects.
- Re-review (code-reviewer, once) of 831912f: APPROVE; fix correct (canonical JSON at every depth, arrays order-kept, Object.hasOwn, no prototype pollution). MEDIUM: 7 adversary tests duplicated audit.service.spec cases → removed (adversary 76 → 62 tests, all pass).
- Full run: adversary 'orders entries … with distinct times' failed once: it asserted distinct JS milliseconds, but Date drops the microseconds PostgreSQL stores, so fast inserts can share a millisecond. The spec promises order only → that assertion removed; the order assertion stays.
- Merged origin/main 9a2753c (PR template #17) → b366b64. PR #12 marked ready; title and body set to the new template. Notion review: story and timeline → In review.
- HOLD from the owner (via orchestrator): no ready/merge until ST-434 (#21) merges. #12 had already been marked ready (CI: checks pass, body pass on 48b565d) → converted back to draft; Notion story and timeline back to In progress. Next, on the go-ahead: rebase onto origin/main, typecheck and test under heavy.sh, push --force-with-lease, then gh pr ready, speckit-pr-test, CI, merge --match-head-commit, notion finish.
