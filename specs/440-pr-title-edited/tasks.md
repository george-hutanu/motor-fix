# Tasks: Re-check a corrected PR title without re-running CI

**Input**: `specs/440-pr-title-edited/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 Test: `scripts/pr-title-workflow.spec.ts` — the title workflow runs on opened, edited, synchronize and reopened, and cancels an older run of the same PR; ci.yml keeps the default pull_request types and neither holds a title job nor makes `CI OK` need one; the check's own script, run with bash, accepts and refuses the same titles as before, and its error asks for a corrected title, not a push (FR-001, FR-002, FR-003, FR-004, FR-005)

## Phase 2: Implementation

- [X] T002 `.github/workflows/pr-title.yml`: the `PR title` job, moved out of ci.yml, on `pull_request` types opened, edited, synchronize, reopened, with a per-PR concurrency group that cancels a run in progress (FR-001, FR-003, FR-004, FR-005)
- [X] T003 `.github/workflows/ci.yml`: drop the `pr-title` job and its entry in `ci-ok.needs`; update the header comment (FR-002)
- [X] T004 AGENTS.md: the PR title check is its own workflow, re-run when a PR is edited; a documentation-only PR runs only Changes and `CI OK` in CI (FR-006)

## Phase 3: Proof

- [ ] T005 On this PR: correct the title and see the PR title check run again with no push, and no CI run start (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002, FR-003, FR-004, FR-005 | `scripts/pr-title-workflow.spec.ts` |
| FR-006 | AGENTS.md diff |
| SC-001, SC-002 | this PR's own runs after a title edit |
