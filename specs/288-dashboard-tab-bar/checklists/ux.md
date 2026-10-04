# UX and accessibility requirements checklist: dashboard tab bar

**Purpose**: Unit tests for the requirements of the dashboard tab bar (UX and accessibility)
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the requirements-quality criterion is satisfied, not that code is done. Marked by the speckit-auto run (phase 6), each with the spec section that settles it.

## Requirement Completeness

- [x] CHK001 - Is the view list of every dashboard (driver, garage, admin, and the mechanic's limited garage list) stated, with order and labels? [Completeness, Spec §FR-001, data-model.md]
- [x] CHK002 - Are the account controls' whereabouts on a phone specified when the side menu is hidden? [Completeness, Spec §FR-012, Assumptions]
- [x] CHK003 - Is the view body defined for views not yet built? [Completeness, Spec §FR-013]

## Requirement Clarity

- [x] CHK004 - Are the tab size, label size and phone boundary given as numbers? [Clarity, Spec §FR-008, §FR-004]
- [x] CHK005 - Is "named after the dashboard" given as concrete landmark texts in both languages? [Clarity, Spec §FR-010, contracts/ui.md]
- [x] CHK006 - Is "scrolled into sight" bounded so it never scrolls the page vertically? [Clarity, Spec §FR-006, research.md §4]

## Requirement Consistency

- [x] CHK007 - Do the menu and bar requirements state the same views and order, with only the label length differing? [Consistency, Spec §US2, §FR-004/§FR-005]
- [x] CHK008 - Are the mock's choices that the Build brief overrides (900 px, aria-pressed, "Secțiuni", AI tab) recorded with the winner? [Consistency, design.md "Mock vs Build brief"]

## Scenario and Edge Case Coverage

- [x] CHK009 - Are refused and unknown view addresses covered, with the outcome stated? [Coverage, Spec §FR-003, Edge Cases]
- [x] CHK010 - Is a session change (role or capability) that removes the open view covered? [Coverage, Spec §FR-011, Edge Cases]
- [x] CHK011 - Is the single-tab case (a mechanic with no permissions) covered? [Edge Case, Spec Edge Cases]
- [x] CHK012 - Are long Romanian labels at 320 px covered without cutting? [Edge Case, Spec §US3 scenario 2, §FR-008]

## Non-Functional (Accessibility)

- [x] CHK013 - Is the current-page state required in an assistive-technology form, not only by colour? [Accessibility, Spec §FR-006]
- [x] CHK014 - Is the safe-area requirement stated for phones with a home indicator? [Accessibility, Spec §FR-009]

## Dependencies and Assumptions

- [x] CHK015 - Is the deferral of garage feature switches and the live tab refresh recorded with its owner? [Assumption, Spec Assumptions, deferred.md]

## Notes

- `/speckit-implement` reads this checklist's state but does not change it.
