# Feature Specification: The watcher counts PR QA runs on GitHub Actions

**Feature Branch**: `602-watcher-counts-qa-runs`

**Created**: 2026-10-06

**Status**: Archived (2026-10-06)

**Input**: User description: "ST-602 Make the watcher count PR QA runs on GitHub Actions" — Notion story https://app.notion.com/p/3f0607bff0d28134bb0ec384e5b5c5ba (epic EP-1, Task, deferred from the review of PR #62).

## Why

QA boots on GitHub Actions (`.github/workflows/pr-qa.yml`), but `.claude/scripts/watch.mjs`
counts only laptop QA runs (`mf-prtest-<pr>-…-<pid>` worktrees). A lap in flight on
Actions therefore looks like nobody holds the PR: after the quiet threshold the
watcher offers `rerun-qa` and a second run is dispatched for the same head. Its
header `QA runs n/cap` divides a laptop count by an Actions budget, and the
dispatch plan fills QA places that Actions jobs already take.

## Clarifications

### Session 2026-10-06 (autonomous)

- Q: Which runs count as in flight? → A: Every `pr-qa.yml` run whose status is not `completed` (`queued`, `in_progress`, `waiting`, `pending`, `requested`), not only `in_progress`: a queued run already holds the PR and a place in the budget. (autonomous default, from the story's intent "a lap in flight")
- Q: How is a run tied to its PR? → A: By its run name, `PR QA #<n> at <sha> lap <k> …` (`.github/workflows/pr-qa.yml:56`), which both the `pull_request` and the `workflow_dispatch` events fill. A run whose name does not match is ignored.
- Q: Does an Actions run make a handed-off PR "held"? → A: No. A row with a hand-off note whose recorded run tests the PR's head keeps today's `waiting` verdict (ST-688); the Actions run counts only toward the QA budget there. Any other row with an Actions run in flight for its PR is held (`live`), so it is never re-dispatched.
- Q: What if `gh run list` fails? → A: It reads as no Actions runs (fail open, as today), and the watcher behaves exactly as before this change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A lap in flight on Actions is not dispatched again (Priority: P1)

A ready PR whose QA run is queued or running on Actions is shown as held, not
stale, however long its worktree has been quiet.

**Why this priority**: a second run for the same head wastes an Actions job and
cancels the first (the workflow's concurrency group), so the PR is tested later.

**Independent Test**: `collect` with a fake PR list and a fake Actions run list.

**Acceptance Scenarios**:

1. **Given** a ready PR quiet past the qa threshold with no verdict and an
   `in_progress` or `queued` `pr-qa.yml` run named for it, **When** the watcher
   runs, **Then** its holder is `live`, its verdict `ok`, and the dispatch plan
   does not include it.
2. **Given** the same PR with only `completed` runs, **When** the watcher runs,
   **Then** it behaves as today (`rerun-qa`).
3. **Given** a handed-off PR whose recorded run tests its head, **When** an
   Actions run for it is in flight, **Then** its verdict stays `waiting`.

---

### User Story 2 - The QA budget counts what Actions is running (Priority: P2)

The header `QA runs n/cap` and the dispatch plan count laptop runs and Actions
runs in flight together, so `n` and `cap` measure the same thing.

**Independent Test**: `collect` with Actions runs in flight and stale rows that
need QA places; the plan dispatches only what the cap leaves.

**Acceptance Scenarios**:

1. **Given** k Actions runs in flight and a cap of k, **When** the watcher
   plans, **Then** no `rerun-qa` or `tail` fix is dispatched.
2. **Given** `gh run list` fails, **When** the watcher runs, **Then** the
   report is what it was before this change (no Actions runs counted).

### Edge Cases

- A run whose name names no PR, or a PR with no worktree here: it still counts
  toward the budget (it takes an Actions job) but holds no row.
- A laptop run and an Actions run for the same PR: both count; the row is held.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The watcher MUST read the `pr-qa.yml` runs from GitHub with one
  call per pass and keep those whose status is not `completed`, each with the
  PR number parsed from its run name.
- **FR-002**: A worktree row whose PR has an Actions run in flight MUST be held
  (`live`), unless the row has a hand-off note whose recorded QA run tests the
  PR's head, which keeps its `waiting` verdict.
- **FR-003**: The report's QA run count, its header and the dispatch plan's QA
  budget MUST count laptop runs and Actions runs in flight together.
- **FR-004**: When the run list cannot be read, the watcher MUST count no
  Actions runs and otherwise behave as before.

### Key Entities

- **Actions QA run**: `{ pr, run, status }` — the PR number from the run name,
  the run's database id and its status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No `rerun-qa` or `tail` fix is planned for a PR with a QA run in
  flight on Actions (scenario tests).
- **SC-002**: `QA runs n/cap` shows n equal to the laptop runs plus the Actions
  runs not completed.

## Assumptions

- The run list's 50 newest runs cover every run in flight: the workflow's
  concurrency group keeps one per PR, and the cap is 20. (autonomous default)
- Report entries for laptop runs keep their shape `{ pr, pid }`; Actions entries
  are `{ pr, run, status }`, so existing readers are unchanged. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001-FR-004
