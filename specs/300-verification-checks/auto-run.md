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
