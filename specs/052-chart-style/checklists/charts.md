# Requirements checklist: The shared chart style

**Purpose**: unit tests for the requirements — are they complete, clear and measurable before tasks are written.
**Created**: 2026-10-04 · **Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Are all nine Build brief scenarios mapped to a requirement? [Completeness] — 1→FR-001/003, 2→FR-002, 3→FR-005, 4→FR-005, 5→FR-006/007, 6→FR-008, 7→FR-010, 8→FR-013/014, 9→FR-015.
- [x] CHK002 Are the three states (loading, empty, error) and their precedence specified? [Completeness, Spec §Edge Cases, FR-010–012]
- [x] CHK003 Is every unit's formatting named? [Completeness, Clarifications, FR-004]
- [x] CHK004 Is server rendering behaviour specified? [Completeness, FR-018]
- [x] CHK005 Are the interface texts in both languages required? [Completeness, FR-017]

## Clarity

- [x] CHK006 Are bar thickness, radius, line width and fill stops quantified? [Clarity, FR-001, FR-002]
- [x] CHK007 Is the animation duration and easing exact? [Clarity, FR-008]
- [x] CHK008 Is "tap elsewhere" defined? [Clarity, Assumptions]
- [x] CHK009 Is the tooltip text format exact? [Clarity, FR-005, US3]
- [x] CHK010 Is the summary's content enumerated? [Clarity, FR-013]

## Measurability

- [x] CHK011 Is the contrast floor a number with named pairs? [Measurability, FR-007, SC-002]
- [x] CHK012 Is the 320 px fit measurable (no horizontal scroll, ≥12 px)? [Measurability, FR-015, SC-003]

## Consistency and scope

- [x] CHK013 Do the spec and design.md agree where the mock and brief differ? [Consistency] — design.md records each difference with the brief winning.
- [x] CHK014 Are the dashboards' own charts kept out of scope? [Scope, Assumptions, context.md]
- [x] CHK015 Is the new dependency's licence checked against the free-software rule? [Dependency, Assumptions, plan Technical Context]
