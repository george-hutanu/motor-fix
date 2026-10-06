# Feature Specification: The PR lifecycle gate finds a zero-padded feature folder

**Feature Branch**: `725-lifecycle-gate-feature-dir`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "`.claude/hooks/pr-lifecycle-gate.mjs` `prLinked(cwd, branch, number)` reads `specs/<branch>/notion-sync.md` only. For branch `83-sign-in-apple-google` the feature folder is `specs/083-sign-in-apple-google`, so the Stop gate falsely refused with 'PR #136 is not linked from its Notion story'. `handedOff()` already resolves the folder through `.specify/feature.json` and falls back to `specs/<branch>`. Fix: one shared resolver for both (feature.json pointer, then `specs/<branch>`, then a `specs/` folder whose numeric prefix equals the branch's ignoring leading zeros)."

Notion: ST-725 https://app.notion.com/p/3f1607bff0d28185977bc201f6135d4a (Bug, Medium, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707).

## Finding, verified against the code

- `prLinked` (`.claude/hooks/pr-lifecycle-gate.mjs:165`) reads `join(cwd, "specs", branch, "notion-sync.md")` and nothing else.
- `handedOff` (`:154`) reads `.specify/feature.json`'s `feature_directory`, else `specs/<branch>`; it never finds `specs/083-…` from branch `83-…` when the pointer is missing.
- The `83-sign-in-apple-google` worktree's `.specify/feature.json` points at `specs/083-sign-in-apple-google`, whose `notion-sync.md` logs `· pr · ST-83 · PR #136`: the gate's refusal was false.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A linked PR on a zero-padded feature folder ends the session (Priority: P1)

**Acceptance Scenarios**:

1. **Given** branch `83-x`, folder `specs/083-x` with `notion-sync.md` logging `· pr · ST-83 · PR #136`, and `.specify/feature.json` pointing at it, **When** the gate checks the link, **Then** PR #136 is linked.
2. **Given** the same folder and no `.specify/feature.json`, **When** the gate checks the link, **Then** PR #136 is linked.
3. **Given** a `handoff.md` in `specs/083-x` and no pointer, **When** the gate checks the hand-off, **Then** the PR counts as handed off.

### Edge Cases

- A pointer to another feature wins over the branch (unchanged: `handedOff` already does this).
- Two `specs/` folders with the same numeric prefix: the exact `specs/<branch>` wins; otherwise the first folder whose slug also matches the branch's, else none (never a guess between two).
- A branch with no numeric prefix (`chore-*`): only the pointer and `specs/<branch>` are tried.
- A folder with the same number but another slug (`specs/083-other`) is not this branch's feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The gate MUST resolve a branch's feature folder in one place: `.specify/feature.json`'s `feature_directory`, then `specs/<branch>` when it exists, then the `specs/` folder whose numeric prefix equals the branch's, compared as numbers, and whose slug equals the branch's slug.
- **FR-002**: `prLinked` MUST read `notion-sync.md` from the resolved folder.
- **FR-003**: `handedOff` MUST read `handoff.md` from the resolved folder.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: The vitest cases for a zero-padded folder, with and without `feature.json`, fail before the fix and pass after it.
- **SC-002**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.

## Assumptions

- The slug must match as well as the number (autonomous default): a number alone could pick another feature's folder after a renumbering, and the branch always carries the slug (`specs/083-sign-in-apple-google` vs `83-sign-in-apple-google`).
- No eval case: `.claude/evals/cases/pr-lifecycle.json` drives the gate through `SPECKIT_PR_STATE`, which replaces `readState` and so never reaches the folder lookup; the unit specs cover it.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-003
