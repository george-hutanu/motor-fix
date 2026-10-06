# Tasks: Audit history specs without restatements

**Input**: `specs/473-audit-history-spec-dedup/` (spec.md, plan.md)
**Tests**: the change is the tests; all edits are under `libs/domain/src/audit/`, `*.spec.ts` and one `*.testing.ts` only (FR-005).

## Phase 1: User Story 1 - The audit history suites say each thing once (P1)

**Independent test**: the three suites pass; adversary `it(` count is 6 lower, service and API unchanged (SC-003).

- [X] T001 [US1] Create `libs/domain/src/audit/audit-history.testing.ts` (new): export `auditHistoryApp()` per plan.md (registers `serialDatabase`, `beforeAll` app boot with the API's `ValidationPipe` options, `afterAll`, `beforeEach` truncate; returns `{ prisma, accounts, account, bearer, get }`). Covers FR-002.
- [X] T002 [US1] Switch `libs/domain/src/audit/audit-history.api.integration.spec.ts` to `auditHistoryApp()` and delete its own bootstrap, lifecycle, `account`, `bearer`, `get`. Covers FR-003. Needs T001.
- [X] T003 [US1] Switch `libs/domain/src/audit/audit-history.adversary.integration.spec.ts` to `auditHistoryApp()` and delete the same declarations (keep its `garage`, `owner`, `admin`, `entry`, `minutesAgo`, `ids`, `MASK`). Covers FR-003. Needs T001, T002.
- [X] T004 [US1] In `libs/domain/src/audit/audit-history.service.integration.spec.ts`, add the distinct assertions from the six adversary cases to the existing service cases per plan.md table (platform-entry cursor refusal; arrays-in-arrays and array `oldValue` masking; admin read writes no entry if not asserted). Covers FR-004.
- [X] T005 [US1] Delete the six restated cases from `libs/domain/src/audit/audit-history.adversary.integration.spec.ts`. Covers FR-001, FR-004. Needs T004.
- [X] T006 [US1] Run `sh scripts/heavy.sh npx jest libs/domain/src/audit/audit-history` (services up); confirm adversary title count is 6 lower, others unchanged, and `git diff --stat origin/main` shows only the three specs, the new module and `specs/`. Covers FR-005, SC-003, SC-004. Needs T005.

## Dependencies

T001 -> T002 -> T003; T004 -> T005 -> T006. T001 and T004 are independent of each other.
