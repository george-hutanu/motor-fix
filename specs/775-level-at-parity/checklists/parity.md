# Parity Checklist: level_at parity between the two readers

**Purpose**: Requirements quality of the hour-24 `level_at` parity (JS `pendingLevel`, Python `_pending_level`)
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Review Ownership**: reviewer-owned; evaluated here by the /speckit-auto run from spec.md and plan.md.

## Requirement Completeness

- [x] CHK001 Are both readers and both files named, with the regex edit for each? [Completeness, Plan Summary]
- [x] CHK002 Is every refused stamp enumerated (nine: three hour-24 shapes plus six already refused)? [Completeness, Spec §Scenarios 1, 3]
- [x] CHK003 Are the accepted stamp shapes listed so the fix cannot narrow them? [Completeness, Spec §Scenario 2, SC-002]

## Requirement Clarity and Consistency

- [x] CHK004 Is "the same answer" defined (level or none at the same `now` and TTL, no remaining time)? [Clarity, Spec §Clarifications]
- [x] CHK005 Do FR-001, FR-002, SC-001..003 and the plan's regex groups agree on hour `00`-`23`? [Consistency, Spec §FR-001]
- [x] CHK006 Is the day-of-month rollover's exclusion consistent between spec, edge cases and the original task text? [Conflict resolved, Spec §Clarifications]

## Acceptance Criteria and Coverage

- [x] CHK007 Can SC-003 be objectively checked (a reader accepting a refused stamp fails `test:harness`)? [Measurability, Spec §SC-003]
- [x] CHK008 Is the boundary hour 23 minute 59 stated as still valid? [Edge Case, Spec §Edge Cases]
- [x] CHK009 Is the Python-unavailable case for the parity specs addressed? [Coverage, Plan §Technical Context]
- [x] CHK010 Is "what /speckit-size writes is unchanged" stated as a constraint? [Assumption, Spec §Assumptions]
