# Feature Specification: Skip the build and test jobs on documentation-only pull requests

**Feature Branch**: `436-docs-only-ci`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-436 — https://app.notion.com/p/3ef607bff0d281aabbd3f7430ecaac0c
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A documentation-only PR does not wait for builds (Priority: P1)

A PR that only edits documentation runs the PR title check, a change detector
and `CI OK`; every job its change cannot affect is skipped, and `CI OK` passes.

**Independent Test**: classify a list of changed paths; a PR that changes only
`README.md` is documentation only, one that also changes `apps/api/src/main.ts`
is not.

**Acceptance Scenarios**:

1. **Given** a PR whose changed files are all documentation, **When** CI runs, **Then** Biome, typecheck, unit, integration, e2e, build, harness, contract, audit and Docker are skipped, and `CI OK` passes.
2. **Given** a PR that changes at least one file that is not documentation, **When** CI runs, **Then** every job runs as before.
3. **Given** a `workflow_call` run from `release.yml`, **Then** every job runs as before.
4. **Given** the change detector fails, **Then** `CI OK` fails.

### Edge Cases

- A rename from a code file to a Markdown file: both paths count, so it is not documentation only.
- Markdown under `.claude/`, `.specify/` or `.github/` is harness or workflow input (skills, the PR template), not documentation.
- An empty diff is not documentation only: run everything.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A path MUST be documentation when it is under `docs/`, or ends in `.md` (case-insensitive) and is not under `.claude/`, `.specify/` or `.github/`.
- **FR-002**: A PR MUST be documentation only when its changed paths, with both sides of every rename, are non-empty and all documentation.
- **FR-003**: On a pull request, a `changes` job in `ci.yml` MUST compute FR-002 against the PR's base branch and expose it as a job output.
- **FR-004**: When the PR is documentation only, every `ci.yml` job except `pr-title`, `changes` and `ci-ok` MUST be skipped; otherwise, and on every non-PR run, they MUST run as before.
- **FR-005**: `CI OK` MUST need `changes`, so a failed detector fails `CI OK`.
- **FR-006**: AGENTS.md MUST say documentation-only PRs skip the build and test jobs.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006

## Success Criteria *(mandatory)*

- **SC-001**: The PR that ships this (it changes code) runs every job on itself and `CI OK` is green.

## Clarifications

### Session 2026-10-04

- Q: How is the change detected? → A: a tested script, `scripts/docs-only.ts`, run with Node's type stripping like `scripts/pr-body-check.ts`; no third-party path-filter action, no token. (autonomous default; evidence: `.github/workflows/pr-template.yml:35`)
- Q: Is Markdown inside `apps/` or `libs/` documentation? → A: yes; nothing in the build reads Markdown there. (autonomous default)
- Q: Does the PR template check skip too? → A: no, it is a separate workflow and runs on every PR (story: out of scope).

## Assumptions

- No branch protection exists (private repository on the free plan: the API returns 403), so a skipped job cannot block a merge; `CI OK` is the aggregate. (autonomous default)
