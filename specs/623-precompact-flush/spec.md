# Feature Specification: The pre-compact hook leaves archived features alone and keeps porcelain spacing

**Feature Branch**: `623-precompact-flush`
**Created**: 2026-10-05
**Status**: Archived (2026-10-05)
**Level**: 1 (one-session)
**Notion story**: ST-623, https://app.notion.com/p/3f0607bff0d2815d9c5ee0902c807bc3 (Task, Low; deferred from PR #81 QA, lap 2). The page has no comments.
**Epic**: EP-1 Foundations

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An archived feature's run log stays closed (Priority: P1)

When the context of a session is about to be summarised, the pre-compact hook
appends a Compaction block to the active feature's `auto-run.md`, so a resumed
run knows where it stood. Once a feature is archived its run log is a closed
record; a session that compacts later, with the pointer still on that feature,
must not keep adding blocks to it.

**Independent Test**: run the hook against a feature whose spec says
`**Status**: Archived` and check its `auto-run.md` is unchanged.

**Acceptance Scenarios**:

1. **Given** the active feature's spec status is Archived, **When** the hook runs, **Then** `auto-run.md` is byte-for-byte unchanged and the hook exits 0.
2. **Given** the active feature's spec status is anything else (Draft, In progress), **When** the hook runs, **Then** a Compaction block is appended as before.

### User Story 2 - Every uncommitted entry keeps its status columns (Priority: P2)

The block lists the uncommitted files as `git status --porcelain` prints them.
The two status columns are part of each line (` M` is modified in the working
tree, `M ` is staged); the hook currently trims the whole output, so the first
entry loses its leading space and reads differently from the rest.

**Independent Test**: run the hook with a tree whose first porcelain entry is
modified but unstaged, and check every listed entry keeps its two columns.

**Acceptance Scenarios**:

1. **Given** two files modified in the working tree and not staged, **When** the hook runs, **Then** both are listed as `  -  M <path>` (the two status columns intact).
2. **Given** a clean tree, **When** the hook runs, **Then** the block says the working tree is clean.

### Edge Cases

- A status line such as `**Status**: Archived (2026-10-04)` carries a date after the word; it still counts as archived.
- No active feature, or no `auto-run.md`: the hook stays a silent no-op (unchanged).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The hook MUST NOT write to `auto-run.md` when the active feature's `spec.md` has a `**Status**:` line whose value begins with `Archived`, and MUST exit 0.
- **FR-002**: The hook MUST still append its Compaction block for a feature whose status is not Archived.
- **FR-003**: Each uncommitted entry in the block MUST keep the full porcelain line, both status columns included, for the first entry as for every other.

## Success Criteria *(mandatory)*

- **SC-001**: Compacting with an archived feature active adds 0 lines to its run log.
- **SC-002**: In a block listing unstaged changes, every entry has the same prefix shape; none has lost a status column.

## Assumptions

- Archived is read from the spec's `**Status**:` line, the marker `/speckit-archive` writes (seen in `specs/516-production-release-queue/spec.md:5`). (autonomous default)
- The skipped write is silent: no message, exit 0, like the hook's other no-op paths. (autonomous default)
- The `before_specify` branch hook was not run: the branch `623-precompact-flush` already existed, created from origin/main by the dispatching agent. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001-FR-003
