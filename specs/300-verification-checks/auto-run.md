# Auto run — 300-verification-checks

- Description: ST-300 Store each file's checks and their results (Notion https://www.notion.so/3ee607bff0d281eb88ffff1135141301, EP-2, Highest).
- Start commit: bbc171f8 (origin/main), worktree .worktrees/300-verification-checks, branch 300-verification-checks.

## Preflight
- Tree clean; typecheck, lint and unit tests green (exit 0). Integration specs left to CI and the pre-commit hook.
- Constitution v1.8.2 card read; no placeholders.

## 0 Size
- Level 2 (feature): classifier 0.80, touches an endpoint and tables.

## 2 Specify
- Phase agent fable: STATUS success, 11 FRs, autonomous defaults in Assumptions (rows in the submit/resend transaction; documents part of the summary deferred; admin channel only; error codes; RAR activity seed).
- Draft PR #201 opened (lifecycle open): planning, feature, scope: domain, EP-2; Notion start and pr written.

## 3 Context
- org-researcher: context.md, 14 findings, decisions page partial. Contradictions carried into clarify (consumer vs transaction, more_requested).

## 4 Clarify (spec-challenger + context)
- Q1 more_requested accepts a record? → 409 (MF-58 rules 1, 4).
- Q2 rows by consumer or transaction? → transaction; the migration back-fills files sent earlier.
- Q3 summary language → RO and EN from one contracts function; record call returns both.
- Q4 first-part kinds and wording → company and rar only; gender agreement; `<kind name> <detail>`; "Neverificat" with neither part.
- Q5 activities list / evidence / audit → list required when ok; evidence column dropped (Principle I); one audit entry per save with result, detail (and list).
- level check: 2, unchanged.

## 5 Plan
- Phase agent fable: STATUS success; design.md (no screens of its own; mock not openable, logged), plan, research, data-model, contracts, quickstart. Migration 20261007140000_verification_check.

## 6 Checklist
- Phase agent sonnet: STATUS success; file-checks.md 25 items all checked; fixed: detail replaced on each save, row read FOR UPDATE, 400 for activities on another kind.

## 7 Tasks
- Phase agent sonnet: STATUS success; 10 tasks (T001 schema, T002–T005 tests, T006–T010 build). level 2 unchanged.

## 8 Analyze
- artifact-lint --check: 0 errors after adding the Spec Delta (garage-verification, Adds FR-001..FR-011); capabilities validate clean. FR coverage: every FR mapped to T002–T005. No CRITICAL.

## 9 Tests
- Red proved: contracts spec failed to compile (module missing); domain 3 failed + 1 suite failed to run (VerificationChecksService missing); API route absent from openapi.
- Fixed in the tests: activity_log is not truncated between tests, so history queries are scoped to the test's garage.

## 10 Implement
- T006 contracts summary/lamp/DTOs; T007 createMany skipDuplicates in submit and resend; T008 VerificationChecksService (FOR UPDATE reads of the check and the garage list); T009 controller + module; T010 openapi and data-access regenerated.
- Green: contracts 16/16, domain garages/verification 122/122, api verification-checks + admin-routes 28/28.

## 11 Converge
- Every task [X]; the spec's FRs all map to code and tests; nothing new appended.

## 12 Harden
- contract-check green after commit; artifact-lint 0 errors.
- diff-audit: `import-extension` ERRORs on the service are the known false positive (domain is commonjs/bundler, no lib uses `.js`; same verdict as 016-052); `suppression` ERRORs are in generated data-access files (never edited by hand); `untested-new-file` on the service is the extension-matching false positive (its spec imports it); `test-only-export` VERIFICATION_CHECK_RESULTS kept as the queue story's public API.

## 13 Refresh
- org-researcher: STATUS success; ST-300 now Implementing, no comments, EP-2 unchanged; no new evidence or contradictions.

## 15 Agent context
- CLAUDE.local.md is untracked and local; its managed block is not written from a worktree (AGENTS.md is shared). Nothing to commit.

## 16 Retrospective evidence (unjudged)
- retro-evidence --since bbc171f8: deferred 0 open at the time; 10 carry-over items from earlier retros (none on garage verification); 9 commits. Jev lane unavailable (no key). instincts triggered: none listed.

## 12/14 Harden and review
- test-adversary: 57 tests in libs/contracts/src/verification-checks.adversary.spec.ts; 3 genuine defects (blank, empty and control-character detail accepted by the DTO) fixed with @Length(1,200) and a no-control-character rule.
- code-reviewer (BLOCK): HIGH #1 record could land on a file decided concurrently -> file row read FOR SHARE, race test added (red without the lock, green with it); MEDIUM #2 CheckRecord duplicated the DTO -> removed; LOW #3 lamp kept (FR-008, the queue story's API); LOW #4 TODO on the seeded codes.
- spec-reviewer (APPROVE): MEDIUM #1 fileId missing from VerificationCheckDto -> added, client regenerated; LOW #2 activities audit now always carries the list for the activities kind; LOW #3 deferred.md written (documents summary, lawyer's activity list).
