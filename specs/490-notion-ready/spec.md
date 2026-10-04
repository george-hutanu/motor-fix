# Feature Specification: Keep Ready to work current and comment on finished stories

**Feature Branch**: `490-notion-ready`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-490 — https://app.notion.com/p/3ef607bff0d281aca4f1d1635a0bb6c4
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The board says what can be started (Priority: P1)

The owner filters MotorFix stories on **Ready to work** to pick the next item.
A ticked item is still To do and nothing it depends on is open; an unticked
To do item is waiting on another item or on someone outside the build. The
owner asked for this on 2026-10-04 and asked for a checkbox, not a label.

**Independent Test**: give the readiness decision a set of items with their
statuses, blockers, holds and current ticks, and read back which to tick,
which to untick, and the ready list in priority order.

**Acceptance Scenarios**:

1. **Given** a To do item whose every timeline blocker is Merged, **When** the decision runs, **Then** it is ready, and it is ticked if it was not.
2. **Given** a To do item with one blocker still Implementing, **Then** it is not ready.
3. **Given** a ticked item that is now Planning (or Done), **Then** the decision unticks it.
4. **Given** a To do item with no open blocker but waiting on the lawyer, **Then** it is not ready and its hold is reported.
5. **Given** ready items of mixed priority, **Then** the list is Highest, High, Medium, Low, none, and by ID within a priority.
6. **Given** an item that is already ticked and still ready, **Then** nothing is written for it.

### User Story 2 - It stays current without anyone asking (Priority: P1)

Every time a story starts or finishes, the sync that moves its status also
refreshes Ready to work for the story's epic and records that it did. A
finished story may unblock others; a started one must lose its tick.
`/speckit-archive` will not close a feature until that refresh is recorded
after the finish.

**Independent Test**: feed the archive check a feature's sync log and read
whether a ready line follows the last finish line.

**Acceptance Scenarios**:

1. **Given** a log whose last finish line is followed by a ready line, **Then** the check passes.
2. **Given** a log with a finish line and no ready line after it, **Then** the check fails and names what to run.
3. **Given** a log whose ready refresh failed and was logged PENDING after the finish, **Then** the check passes: a Notion outage never blocks the build.
4. **Given** a log with no finish line yet, **Then** the check fails: there is nothing to archive.

### User Story 3 - A finished story says what happened (Priority: P2)

When a story finishes, the owner reads on its Notion page what differs from
its Build brief, which decisions were taken on the owner's behalf, what was
deferred and what is still open — when there is any. A story built exactly as
briefed gets no comment.

**Independent Test**: read the sync skill's finish step and the log line it
records.

**Acceptance Scenarios**:

1. **Given** a finished story with an autonomous decision in its run log, **When** finish runs, **Then** a comment listing it is posted on the story and logged.
2. **Given** a finished story with nothing to record, **Then** no comment is posted and the log says so.

### Edge Cases

- A blocker that is not on the timeline but named on the item's page counts the same as a timeline blocker: it must be Done.
- An item that is Blocked, In review or QA is never ready, whatever its blockers.
- A legacy `In progress` status is not To do, so it is not ready.
- A blocker reported as `Merged` (timeline) or `Done` (story) both count as finished.
- Log lines are written with and without the ` · ` after the date; both are read.
- Several finish lines (a story re-finished after a correction): the last one is the one that needs a ready line after it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The readiness decision MUST mark an item ready exactly when its status is To do, every blocker it has is Done or Merged, and it carries no outside hold.
- **FR-002**: The decision MUST return the items to tick (ready and not ticked) and to untick (ticked and not ready), and nothing for an item whose tick is already right.
- **FR-003**: The decision MUST return the ready items ordered by priority (Highest, High, Medium, Low, then none) and by ID within a priority, and the not-ready To do items with what holds each one.
- **FR-004**: The `notion-ready` skill MUST write only the Ready to work checkbox, and MUST NOT use the Labels property for readiness.
- **FR-005**: `speckit-notion-sync` MUST end every `start` and `finish` event by running `notion-ready` for the story's epic and logging one `ready` line in `specs/<feature>/notion-sync.md`, or a PENDING line when Notion fails.
- **FR-006**: On every `finish`, `speckit-notion-sync` MUST post a comment on the story listing deviations from its Build brief, decisions taken on the owner's behalf, deferred follow-ups and open questions when there is at least one, post nothing otherwise, and log which it did.
- **FR-007**: The archive check MUST pass only when the sync log has a `ready` line, or a PENDING ready line, after its last `finish` line, and MUST name the command to run when it fails; `/speckit-archive` MUST run it before closing a feature.
- **FR-008**: AGENTS.md MUST state that every start and finish refreshes Ready to work and that every finish comments when there is something to record.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008

## Success Criteria *(mandatory)*

- **SC-001**: For the Foundations epic as it stood on 2026-10-04, the decision's ready list matches the 34 items ticked by hand that day, minus the ones whose holds are recorded. (autonomous default: the hand run is the reference)
- **SC-002**: A feature whose finish has no ready refresh after it cannot be archived, and the harness specs are green.

## Clarifications

### Session 2026-10-04

- Q: Who decides that an item waits on an outside party? → A: the skill reads it from the page and passes it to the decision as a hold; the decision only applies the rule. Judgement stays in the skill, the rule is tested. (autonomous default; evidence: `.claude/scripts/notion-status.mjs:1-4` splits decision from writes the same way)
- Q: Do `implement`, `review`, `qa` or `blocked` refresh readiness? → A: no. `start` already unticks the story and only `finish` can unblock others; a blocked story was already unticked at `start`. (autonomous default)
- Q: What does "after the finish" mean in the log? → A: later in the file. Lines share a date, so order, not date, decides. (autonomous default)

## Assumptions

- The Ready to work checkbox exists in MotorFix stories (added 2026-10-04) and is written as `"__YES__"` / `"__NO__"`.
- The epic's build timeline is the source of `Blocked by`; items not on it carry prerequisites on their page.
- Commenting needs the Notion `notion-create-comment` tool, which the sync skill already uses for blocked reasons.
