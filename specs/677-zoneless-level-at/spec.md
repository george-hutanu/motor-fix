# Feature Specification: Zone-less level_at is no waiting level

**Feature Branch**: `677-zoneless-level-at`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "ST-677 "A zone-less level_at is read as local time in JS and UTC in Python" (Notion https://app.notion.com/3f0607bff0d281fe8d32e51335e46153)"

**Sources**: Notion story ST-677 (Tech debt, System role, Priority Low, Epic https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707; no comments on the page), deferred from ST-662 PR #134 lap 2 review, finding 10; the two pending-level readers and their parity test in this repo. Design: N/A — no screens, a harness script change only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A waiting level without a zone is dropped by both readers (Priority: P1)

The harness records a level sized "for the next feature" together with the moment it was sized (`level_at`), and either reader (the JS one used by the gates and `level.mjs point`, the Python one used by the spec-kit helper scripts) decides whether that waiting level is still fresh when a new feature is pointed to. Today a `level_at` without a time-zone designator is read as local time by one and as UTC by the other, so on a machine away from UTC they can disagree: one drops the level, the other carries it onto the new feature. The operator wants both readers to give the same answer, and the answer is "no waiting level": the file was hand-edited, since the harness only ever writes stamps with a zone.

**Why this priority**: it is the whole story. One reader carrying a level the other refuses breaks `/speckit-size`'s contract that the pointer and the level stay in step across the two helpers.

**Independent Test**: point the feature pointer at a new feature from a state whose `level_at` has no zone, once through the JS pointer and once through the Python helper, and compare the resulting `feature.json`.

**Acceptance Scenarios**:

1. **Given** a `feature.json` with `level_for: "next"`, a valid level and a `level_at` that has no zone designator (for example `2026-10-06T20:18:13` or `2026-10-06`), **When** the pointer is moved to a new feature through the JS helper, **Then** no level is carried: the result holds only the new `feature_directory`.
2. **Given** the same file, **When** the pointer is moved through the Python helper, **Then** the result is byte-for-byte what the JS helper produced.
3. **Given** a `level_at` written by the harness (`Z` or a `±hh:mm` offset) that is still fresh, **When** the pointer is moved to a new feature, **Then** the level is carried as before; nothing else about freshness changes.
4. **Given** the parity test in the repo, **When** it runs, **Then** the zone-less case is among the states it compares between the two helpers, and the suite is green.

### Edge Cases

- A stamp with a zone but otherwise malformed (`2026-13-40T00:00:00Z`): already invalid in both readers; unchanged.
- A stamp with a `±hh:mm` offset rather than `Z`: valid in both readers today; stays valid.
- A date-only stamp (`2026-10-06`): has no zone; invalid in both after this change (today JS reads it as UTC and Python as midnight UTC, so they happen to agree; the rule is simpler when every zone-less form is refused).
- A lower-case `z` or a `+hhmm` offset without a colon: not something the harness writes; whichever way each reader treats it today is out of scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The JS pending-level reader MUST report no waiting level when `level_at` is a string without a time-zone designator (`Z` or `±hh:mm`), regardless of the machine's time zone.
- **FR-002**: The Python pending-level reader MUST report no waiting level for the same input, so the two readers agree on every machine.
- **FR-003**: A `level_at` that carries `Z` or a `±hh:mm` offset MUST keep its current freshness behaviour in both readers.
- **FR-004**: The Python-vs-JS parity test MUST include a fresh, zone-less `level_at` among its compared states, and both helpers MUST produce the same `feature.json` for it (the pointer alone, no level).

### Key Entities

- **Waiting level**: the `level`, `level_for: "next"` and `level_at` trio in `.specify/feature.json`, written by `/speckit-size` for the feature about to be created and consumed once by the first pointer move.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a zone-less `level_at`, the JS and Python helpers produce identical `feature.json` output on any machine time zone (verified by the parity test, which runs in the harness suite on every commit).
- **SC-002**: Every existing case of the parity test and of the pending-level tests keeps passing (0 regressions in `npm run test:harness`).
- **SC-003**: The change touches only the two readers and their test; the harness still writes `level_at` with `Z` and never produces the refused form itself.

## Assumptions

- "Without a zone" means the string ends in neither `Z` nor a `±hh:mm` offset; a date-only string counts as zone-less (autonomous default — the story names "no zone", and the harness only ever writes full timestamps with `Z`).
- The fix is a strict refusal, not a repair: a zone-less stamp is not reinterpreted as UTC or local in either reader (autonomous default — the story's What says "treat as invalid", and refusing is the smallest change under Constitution I).
- The parity case uses a fresh zone-less stamp (one minute old) so that it would be carried if either reader accepted it; a stale zone-less one would hide the bug (autonomous default).
- No behaviour outside the two readers changes: `setLevel` keeps writing `toISOString()`, and the TTL, the clock-skew slack and the level-0 rule stay as they are (autonomous default — Constitution I).
- Design check: N/A, there are no screens; `design.md` records this (autonomous default).

## Spec Delta

- **Adds**: a zone-less `level_at` is refused as a waiting level by both the JS and the Python feature-pointer helpers (capability: harness feature pointer / sizing).
- **Modifies**: nothing else.
- **Removes**: nothing.
