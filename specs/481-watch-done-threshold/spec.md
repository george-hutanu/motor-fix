# Feature Specification: A grace period before watch removes a finished worktree

**Feature Branch**: `481-watch-done-threshold`
**Created**: 2026-10-07
**Status**: Archived (2026-10-07)
**Level**: 2 (feature)
**Notion story**: ST-481, https://app.notion.com/p/3ef607bff0d2811e9a0bd0abcf3e0ace (Tech debt from ST-464, PR #29)
**Input**: User description: "watch.mjs's done phase has no stale threshold (harness, .claude/scripts/watch.mjs; DEFAULT_THRESHOLDS has planning/tests/development/review/qa/merging but no done)"

## Clarifications

### Session 2026-10-07

- Q: How long is the grace period? → A: 30 minutes, the review threshold, as the story suggests; overridable like every other phase with `--stale done=<minutes>`.
- Q: What does the grace period measure? → A: the worktree's last activity (464-FR-004), the same clock every other phase uses, so a tail agent that commits or writes run-state after the merge restarts it.
- Q: Does the grace period also change who counts as holding a done worktree? → A: yes: a `claude agent` lock and a claim count as live within the phase's threshold (464-FR-003), and the done phase now has one, so a tail agent finishing its post-merge steps holds its worktree for the grace period instead of reading as gone at once.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A just-merged worktree is left alone for a while (Priority: P1)

A tail agent merges its PR, then runs the finish (Notion, the merged PR's
comment) in its worktree. Today the first `watch.mjs --fix` pass after the
merge unlocks and removes that worktree, seconds after its last commit,
because the done phase has no threshold: a `claude agent` lock reads as gone
at once and removal needs no quiet time. With a done threshold, removal waits
until the worktree has been quiet past it.

**Why this priority**: removing a worktree an agent still works in loses its gitignored notes and breaks the agent's finish.

**Independent Test**: `fixOf` on a merged, clean, at-head, unheld row: quiet under the threshold gives no fix; quiet past it gives `remove-worktree`.

**Acceptance Scenarios**:

1. **Given** a merged, clean worktree at the merged head, not held, quiet 5 minutes, **When** watch runs, **Then** its verdict is done with no fix and the reason names the quiet minutes against the threshold.
2. **Given** the same worktree quiet 120 minutes, **When** watch runs, **Then** its fix is `remove-worktree`.
3. **Given** a merged worktree with a `claude agent` lock whose session still runs and activity 5 minutes ago, **When** watch runs, **Then** its holder is live and it is not removed.
4. **Given** `--stale done=0`, **When** watch runs on a just-merged clean worktree, **Then** it gets `remove-worktree`, as before this change.
5. **Given** a just-merged clean worktree, **When** `--gate` runs, **Then** it stays silent for that worktree.

### Edge Cases

- A done worktree that is dirty, ahead of the merged head, held, or the main checkout keeps its existing reason and never gets a fix, whatever the quiet time.
- A run-state `done` worktree with no merged PR keeps "run done" and no fix.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A worktree MUST be stale when its phase is neither done nor blocked, its holder is neither `live` nor `owner`, and its last activity is older than its phase's threshold: planning 30, tests 45, development 45, review 30, qa 30, merging 30 minutes by default; the done phase MUST have a threshold too, 30 minutes by default, its grace period (FR-002); each is overridable with `--stale <phase>=<minutes>`, `done` included.
- **FR-002**: Each stale worktree MUST get exactly one fix, the first that applies of `merge` (PR ready, checks passed, `agent-review` success on the head, the tree clean and at the PR head), `fix-ci` (a check on its open PR failed), `rerun-qa` (PR ready, checks passed, no `agent-review` result on the head), `resume` (anything else, an `agent-review` failure included); a done worktree whose PR is merged, whose tree is clean, whose `HEAD` is the PR's merged head, whose holder is not live and whose last activity is older than the done threshold MUST get `remove-worktree`; inside the threshold its verdict MUST be done with no fix and a reason naming its quiet minutes and the threshold; every other worktree gets none.
- **FR-003**: Within the done threshold, a `claude agent` lock whose session runs, and a claim, MUST count as a live holder of a done worktree, as they do for every other phase (464-FR-003).
- **FR-004**: `--gate` and `--fix` MUST follow FR-002: neither fires for nor removes a done worktree inside its grace period.

## Success Criteria *(mandatory)*

- **SC-001**: No worktree whose last activity is under 30 minutes old is removed by a default `--fix` pass.
- **SC-002**: Every harness spec, `doctor.mjs` and the eval baseline pass; no other verdict changes.

## Assumptions

- 30 minutes, the review threshold, is the default the story names; a longer one only delays cleanup of a disk the owner can prune by hand. (autonomous default, story text)
- The stale verdict and the dispatch plan never include done rows, so no agent fix changes. (autonomous default, `watch.mjs` fixOf/dispatchPlan)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-003–FR-004
- **Modifies**: 464-FR-005 → FR-001, 464-FR-006 → FR-002
