# Feature Specification: Re-check a corrected PR title without re-running CI

**Feature Branch**: `440-pr-title-edited`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-440 — https://app.notion.com/p/3ef607bff0d28193b077c3fb8ac51fb9
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by code-reviewer on ST-435 (PR #18), severity medium. The Notion task has no comments.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A fixed PR title turns its check green on its own (Priority: P1)

An author opens a PR whose title is not a Conventional Commit; the PR title
check fails. They correct the title in GitHub. The title check runs again on
that edit and passes, without a new push and without re-running the build and
test jobs.

**Independent Test**: read the workflows: the title check is triggered by a PR
edit, and the CI workflow that holds the build and test jobs is not.

**Acceptance Scenarios**:

1. **Given** a PR whose title check failed, **When** the author corrects the title, **Then** the title check runs again on the same head commit and passes.
2. **Given** an open PR, **When** only its body is edited, **Then** no build, test or `CI OK` job runs again.
3. **Given** a push to a PR, **Then** the title check and every CI job run, as before.
4. **Given** a `workflow_call` run of the CI workflow from the release workflow, **Then** every CI job runs as before and no title check is involved.
5. **Given** a title that is not a Conventional Commit, **Then** the check fails with an error that tells the author to correct the title, without saying a push is needed.

### Edge Cases

- A title edited twice in quick succession: the earlier title-check run is cancelled and the latest one decides.
- A Dependabot PR: its title is checked the same way (the PR template check skips bots, so this check is the one that covers them).
- A documentation-only PR: the title check still runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The PR title check MUST run when a PR is opened, reopened, pushed to (synchronize) or edited.
- **FR-002**: The CI workflow's build, test and `CI OK` jobs MUST NOT run when a PR is edited; its pull-request trigger keeps its default types.
- **FR-003**: The PR title check MUST accept exactly the titles the CI title check accepts today (the same Conventional Commit pattern) and fail otherwise.
- **FR-004**: A failing title check's error MUST tell the author to correct the title, and MUST NOT say that a push is needed to re-check it.
- **FR-005**: A newer title-check run for the same PR MUST cancel one still in progress.
- **FR-006**: AGENTS.md MUST describe the title check as its own workflow beside CI, and no longer as a CI job a documentation-only PR runs.

## Success Criteria *(mandatory)*

- **SC-001**: After a title correction, the title check reports again with no push (observed on this PR or a later one).
- **SC-002**: A body-only edit starts zero CI-workflow runs.

## Assumptions

- The check moves to its own workflow rather than adding `edited` to the CI workflow's trigger, because the CI workflow cancels a run in progress on every new event for the PR: an `edited` event there would cancel the build and test run and start another one. (autonomous default — the finding's own reasoning)
- `CI OK` stops depending on the title check. The merge gate already requires every check green, so the title check still blocks a merge. (autonomous default — `.claude/hooks/merge-gate.mjs` judges every check's latest run)
- No branch protection names the check (`gh api …/branches/main/protection` answers 404), so nothing outside the repo has to change. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006
