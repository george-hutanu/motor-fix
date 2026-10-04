# Formats Requirements Quality Checklist: Prices, numbers and dates in the format of my language

**Purpose**: Unit tests for the requirements of the locale formats — formats, edge cases, server rendering, language switch
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the requirements-quality criterion is satisfied (marked by `/speckit-auto` after fixing the gap, with the note in brackets); it does not mean the implementation is done.

## Requirement Completeness

- [x] CHK001 - Is a format defined for every value kind the Build brief lists (money, numbers, ratings, distances, dates, times) plus ranges and percentages? [Completeness, Spec §FR-001–FR-006]
- [x] CHK002 - Are the exact short month names written out for both languages? [Completeness, Spec §FR-005]
- [x] CHK003 - Are the calendar names' short day names specified, not only the full ones? [Gap, Spec §US3] (added "lun. … dum." / "Mon … Sun")
- [x] CHK004 - Is the input type of each format stated? [Completeness, Spec §FR-008, Clarifications Q2]

## Requirement Clarity

- [x] CHK005 - Is "whole lei" vs "two decimals" defined by a testable rule? [Clarity, Spec §FR-001]
- [x] CHK006 - Are the separator characters (space before unit, minus sign, dash in ranges) named exactly? [Clarity, Spec §FR-001, FR-002, Clarifications Q5]
- [x] CHK007 - Is the rounding of ratings, distances and percentages specified? [Clarity, Spec §Edge Cases]

## Requirement Consistency

- [x] CHK008 - Do the calendar names use the same short months as the date format? [Consistency, Spec §FR-009, FR-005]
- [x] CHK009 - Is the missing-value text the same for every format? [Consistency, Spec §FR-008]
- [x] CHK010 - Is the date-picker library consistent with the current stack decision (Spartan, not PrimeNG)? [Conflict, Spec §Assumptions, context.md] (assumption updated)

## Acceptance Criteria Quality

- [x] CHK011 - Does every acceptance scenario give an exact expected string in both languages? [Measurability, Spec §US1–US4]
- [x] CHK012 - Can "changes at once, with no reload" be verified objectively? [Measurability, Spec §FR-010, SC-002]

## Scenario and Edge Case Coverage

- [x] CHK013 - Are device time zones other than Bucharest and the day boundary covered? [Coverage, Spec §US2 scenarios 3–4]
- [x] CHK014 - Are values outside their normal range (rating > 5, percentage > 100, inverted range) addressed? [Edge Case, Gap] (added: shown as given)
- [x] CHK015 - Is a date-only ISO string's day defined? [Edge Case, Gap] (added: midnight UTC, same day in Bucharest)
- [x] CHK016 - Are server rendering and hydration defined for the formats? [Coverage, Spec §FR-011, Clarifications Q4]

## Dependencies & Assumptions

- [x] CHK017 - Is the dependency on the ST-16 runtime and the absent ST-17 switch stated, with how the switch is proven meanwhile? [Dependency, Spec §Assumptions]
- [x] CHK018 - Is the deferred Playwright check on Results recorded with its reason? [Assumption, Spec §Assumptions]

## Notes

- 18 items, 0 unchecked after three spec edits (CHK003, CHK014, CHK015) and the assumption update already made in clarify (CHK010).
