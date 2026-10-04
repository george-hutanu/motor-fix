# Tasks: Production deploys queue instead of cancelling, with no approval

**Input**: `specs/516-production-release-queue/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [P] [US1] Test: `scripts/release-workflow.spec.ts` — the `production` and `staging` jobs of `release.yml` each have their own concurrency group with `cancel-in-progress: false`, and `production` needs `staging` and has no other trigger (FR-001, FR-002, FR-003)
- [X] T002 [P] [US2] Test: `scripts/railway-deploy.spec.ts` — aborting the run's signal mid-deploy fails with "cancelled" and restores the touched services, redeploying the live ones (FR-005)

## Phase 2: Implementation

- [X] T003 [US1] `.github/workflows/release.yml`: `production` concurrency `cancel-in-progress: false`, and the job comment says why (FR-003)
- [X] T004 [US2] `scripts/railway-deploy.ts`: a `signal` option that aborts waiting and in-flight calls and triggers the restore; `main` wires SIGINT and SIGTERM to it (FR-005)
- [X] T005 `specs/421-monorepo-platform/quickstart.md`: the by-hand checks say production follows staging with no approval and is not cancelled by a newer merge (FR-004)

## Phase 3: Proof

- [X] T006 `npx jest -c scripts/jest.config.cts` green; `node .claude/scripts/capabilities.mjs validate specs/516-production-release-queue --check` green; archive the delta into `platform` (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002, FR-003 | `scripts/release-workflow.spec.ts` (job order and concurrency). The "no manual approval" part of FR-001 and FR-002 lives in the GitHub `production` environment's settings (no required reviewers), outside the repository; it is proved by the by-hand check in `specs/421-monorepo-platform/quickstart.md`, not by this spec |
| FR-004 | review of the quickstart diff (prose) |
| FR-005 | `scripts/railway-deploy.spec.ts` (cancel while waiting, while the deploy request is in flight, before start; one failing restore does not stop the others); `scripts/release-workflow.spec.ts` (`exec`, so the signal reaches node); the quickstart's by-hand cancel check |
