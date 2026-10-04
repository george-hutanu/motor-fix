# Feature Specification: Keep exactly one stage label on every open PR

**Feature Branch**: `474-pr-stage-label`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-474 — https://app.notion.com/p/3ef607bff0d281cda7dbfd476542743c
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The PR list shows one stage, the same as the board (Priority: P1)

The owner reads a PR's stage off GitHub's PR list and the story's status off
the Notion board, and expects them to agree. Every lifecycle event (start,
implement, review, QA, blocked, unblock, finish) leaves the PR with exactly one
stage label, the one for the story's status, whether the event runs in order,
twice, late, after a block, or as a catch-up by a session whose rules changed
under it. PR #33 is the case this closes: a session that started on older rules
caught up by adding `QA` and left `in review` beside it.

**Independent Test**: ask the status decision for every event and status, and
check that its label instruction adds one stage label and removes the other
three, whatever labels the PR had.

**Acceptance Scenarios**:

1. **Given** a story at In review whose PR carries `in review`, **When** the QA event runs, **Then** the label instruction adds `QA` and removes `planning`, `in development` and `in review`.
2. **Given** a story already at QA whose PR carries both `in review` and `QA` (the PR #33 state), **When** the QA event runs again, **Then** the story is unchanged and the label instruction still removes `in review`, so the PR ends with `QA` alone.
3. **Given** a story at QA, **When** it is blocked, **Then** the label instruction keeps `QA` as the stage and adds `blocked`; **When** it is unblocked, **Then** it keeps `QA` and removes `blocked`.
4. **Given** a merged PR, **When** the finish event runs, **Then** the label instruction removes every stage label and `blocked`.

### User Story 2 - The stop gate refuses a PR whose stage labels disagree (Priority: P1)

Before a session ends on a task branch, the PR lifecycle gate checks the open
PR's stage labels. It refuses a PR carrying more than one, or one that does not
fit its draft state, and names the exact `gh pr edit` that leaves one fitting
stage label.

**Independent Test**: feed the gate declared PR states and read its exit code
and message.

**Acceptance Scenarios**:

1. **Given** a ready PR carrying `in review` and `QA`, **Then** the gate refuses it and names `gh pr edit <n> --remove-label "in review"`, keeping `QA`.
2. **Given** a draft carrying `in review`, **Then** the gate refuses it and names `gh pr edit <n> --remove-label "in review" --add-label "in development"`.
3. **Given** a ready PR carrying `planning` or `in development` and no `in review` or `QA`, **Then** the gate refuses it and names the command that removes that label and adds `in review`.
4. **Given** a draft with `planning` or `in development` alone, or a ready PR with `in review` or `QA` alone, **Then** the stage check passes.

### Edge Cases

- A Blocked story with no recorded prior status: its stage is unknown, so the instruction only adds `blocked` and leaves the stage labels as they are.
- A PR with no Notion story (`chore-*`): the same decision is asked with the status its work is at; only the Notion writes are skipped.
- Removing a label the PR does not carry is harmless, so the instruction names every other stage label without reading the PR first.
- The gate sees GitHub only: when a PR carries two fitting stage labels it keeps the furthest along the ladder, because stage labels only move forward.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An open PR MUST carry exactly one stage label: `planning` for Planning, `in development` for Implementing, `in review` for In review, `QA` for QA. A Blocked story's PR MUST keep the stage of the status it left and carry `blocked` beside it; a PR whose story is To do or Done MUST carry no stage label and no `blocked`.
- **FR-002**: The status decision MUST return, for every event and starting status, the stage label for the resulting status and the `gh pr edit` label arguments that set it: add that stage label, remove every other stage label, add `blocked` only for Blocked and remove it otherwise.
- **FR-003**: The label arguments MUST be returned whether or not the Notion status changes, so a repeated, late or catch-up event converges to one stage label.
- **FR-004**: A Blocked story with no recorded prior status MUST yield label arguments that only add `blocked`.
- **FR-005**: The `speckit-notion-sync` skill MUST state the one-stage-label rule and apply the decision's label arguments on every event in place of its per-event remove/add table, and the skills and AGENTS.md lines that quote a label move MUST point at it instead.
- **FR-006**: The PR lifecycle gate MUST refuse an open PR carrying more than one stage label, naming the `gh pr edit` that keeps the furthest fitting one and removes the rest.
- **FR-007**: The PR lifecycle gate MUST refuse an open PR whose stage label does not fit its draft state (a draft with `in review` or `QA`, a ready PR with only `planning` or `in development`), naming the `gh pr edit` that removes it and adds the fitting default (`in development` for a draft, `in review` for a ready PR).
- **FR-008**: Eval cases MUST show the gate refusing a ready PR with both `in review` and `QA`, and a draft with `in review`.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008

## Success Criteria *(mandatory)*

- **SC-001**: Starting from any combination of stage labels, applying the label arguments of any event leaves the PR with at most one stage label, and exactly one while the story is between Planning and QA.
- **SC-002**: The PR #33 state (ready, `in review` and `QA`) is refused by the gate with a one-line fix, and the harness specs and eval cases are green.

## Clarifications

### Session 2026-10-04

- Q: Which label does the gate keep when a PR carries two that fit its draft state? → A: the furthest along the ladder (`QA` over `in review`, `in development` over `planning`): labels only move forward, so the furthest is the latest move. (autonomous default; evidence: the ladder in `.claude/scripts/notion-status.mjs:19`)
- Q: Does a PR with no Notion story need its own rule? → A: no; the same decision is asked with `--current` set to the status its work is at, and only the Notion writes are skipped. One rule, one place (Principle V). (autonomous default)
- Q: Should the gate compare the PR's stage with the Notion status? → A: no; the gate reads GitHub only and fails open when it cannot see, and Notion is out of its reach (`.claude/hooks/pr-lifecycle-gate.mjs:19`). (autonomous default)

## Assumptions

- `gh pr edit --remove-label` on a label the PR does not carry succeeds and changes nothing; the finish step already relies on it (`.claude/skills/speckit-notion-sync/SKILL.md`, §2b). (autonomous default)
- The stage labels and `blocked` exist in the repository; they were created with the label rules of PR #30.
- The type, scope, epic, `ui` and `dependencies` labels are out of scope and keep their own rules.
