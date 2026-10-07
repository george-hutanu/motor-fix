# Parity Checklist: impossible day in level_at, both readers

**Purpose**: Requirements quality of the calendar-day refusal in JS `pendingLevel` (Python `_pending_level` already refuses)
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Review Ownership**: reviewer-owned; evaluated here by the /speckit-auto run from spec.md and plan.md.

## Requirement Completeness

- [x] CHK001 Are the reader to change and the reader left alone both named, with the edit (three captures, one comparison)? [Completeness, Plan Summary]
- [x] CHK002 Is every refused impossible-day shape enumerated (29 Feb common year, 30 Feb, 31 in a 30-day month; seconds, fraction, offset)? [Completeness, Spec §Scenario 1]
- [x] CHK003 Are the accepted last-of-month stamps and their eight shapes listed so the fix cannot narrow them? [Completeness, Spec §Scenario 2, SC-002]

## Requirement Clarity and Consistency

- [x] CHK004 Is "the same answer" defined with a fixed `now` per scenario (rolled instant + 1 min; stamp + 1 min)? [Clarity, Spec §Clarifications]
- [x] CHK005 Is it stated that the written fields decide and an offset never moves the day? [Clarity, Spec §FR-001, Edge Cases]
- [x] CHK006 Do FR-003 and the Spec Delta agree that 677-FR-003 is modified, not duplicated? [Consistency, Spec §Spec Delta]

## Acceptance Criteria and Coverage

- [x] CHK007 Can SC-003 be objectively checked (a JS-only assertion fails when a scenario 1 stamp is accepted)? [Measurability, Spec §SC-003, FR-002]
- [x] CHK008 Are leap-year and offset-crossing boundaries (`2024-02-29`, `2026-03-01T01:00+02:00`) stated as valid? [Edge Case, Spec §Edge Cases]
- [x] CHK009 Is the Python-unavailable case addressed so the JS half still locks the fix? [Coverage, Spec §Clarifications, Plan §Technical Context]
- [x] CHK010 Is "what /speckit-size writes is unchanged" stated as a constraint? [Assumption, Spec §Edge Cases, Assumptions]
