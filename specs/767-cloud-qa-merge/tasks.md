# Tasks: Cloud sessions run QA and merge on their own

**Input**: `specs/767-cloud-qa-merge/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `.claude/scripts/pr-test/pr-qa-workflow.spec.mjs` — the pull_request trigger, its draft and fork guard, the per-PR concurrency group, statuses: write, and the pending/success/failure status steps (FR-001, FR-002)
- [X] T002 [US1] Test: `.claude/scripts/pr-test/dispatch.spec.mjs` — in the cloud no `gh workflow run`, the PR and the run read over REST, the same hand-off line; locally unchanged (FR-003)
- [X] T003 [US1] Test: `.claude/scripts/pr-test/post.spec.mjs` — in the cloud no statuses call, the review still posted (FR-004)
- [X] T004 [US1] Test: `.claude/scripts/lifecycle.spec.mjs` — cloud merge over REST, the gate fed the PUT, `--pr` required; local unchanged (FR-005)
- [X] T005 [US1] Test: `.claude/hooks/merge-gate.spec.mjs` — the REST reads mapped to the rollup the rule reads; harness-eval cases for the cloud merge command (FR-005)
- [X] T006 [US1] Test: `.claude/scripts/pr-test/qa-in-ci.spec.mjs` — AGENTS.md Cloud sessions says QA starts by itself and the merge goes over REST (FR-006)

## Phase 2: Implementation

- [X] T007 [US1] `.github/workflows/pr-qa.yml` (FR-001, FR-002)
- [X] T008 [US1] `.claude/scripts/pr-test/dispatch.mjs` and `post.mjs` (FR-003, FR-004)
- [X] T009 [US1] `.claude/scripts/lifecycle.mjs` merge and `.claude/hooks/merge-gate.mjs` readPr (FR-005)
- [X] T010 [US1] AGENTS.md "Cloud sessions" (FR-006)
- [X] T011 Re-record the edited hook's fingerprint: read the diff, `node .claude/scripts/doctor.mjs --bless-hooks`, then `doctor.mjs` clean

## Phase 3: Proof

- [X] T012 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | pr-qa-workflow.spec.mjs |
| FR-002 | pr-qa-workflow.spec.mjs |
| FR-003 | dispatch.spec.mjs |
| FR-004 | post.spec.mjs |
| FR-005 | lifecycle.spec.mjs, merge-gate.spec.mjs, evals/cases/merge-gate.json |
| FR-006 | qa-in-ci.spec.mjs |
