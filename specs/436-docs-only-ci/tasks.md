# Tasks: Skip the build and test jobs on documentation-only pull requests

**Input**: `specs/436-docs-only-ci/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 Test: `scripts/docs-only.spec.ts` — which paths are documentation, documentation-only decisions (Markdown, docs/, mixed, harness and workflow Markdown, empty), and the CLI against a temporary git repository (renames count both paths, `docs-only=` written to `GITHUB_OUTPUT`) (FR-001, FR-002, FR-003)

## Phase 2: Implementation

- [X] T002 `scripts/docs-only.ts`: `isDocumentation`, `isDocsOnly`, and the CLI (`node scripts/docs-only.ts <base-ref>`) (FR-001, FR-002, FR-003)
- [X] T003 `.github/workflows/ci.yml`: `changes` job; every other job except `pr-title` needs it and skips on a documentation-only PR; `ci-ok` needs it (FR-003, FR-004, FR-005)
- [X] T004 AGENTS.md: documentation-only PRs skip the jobs (FR-006)

## Phase 3: Proof

- [ ] T005 The PR runs every job on itself, `CI OK` green (SC-001)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002, FR-003 | `scripts/docs-only.spec.ts` |
| FR-004, FR-005 | the `ci.yml` diff and the PR's own CI run |
| FR-006 | AGENTS.md diff |
