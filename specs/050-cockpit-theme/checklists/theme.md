# Theme Requirements Quality Checklist: The Cockpit theme

**Purpose**: Unit tests for the requirements of the Cockpit theme (tokens, preset, type, contrast, focus, panel, sample page)
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

Ownership: `[x]` means the requirements-quality criterion is satisfied, not that the implementation is done. In this `/speckit-auto` run the items were evaluated by the run itself (Autonomy Contract, phase 6); each check carries its justification.

## Requirement Completeness

- [x] CHK001 - Is every colour of both themes given an exact value? [Completeness, Spec §FR-001, §FR-002] — US1 scenarios 1–2 list every value; data-model.md adds the derived tokens.
- [x] CHK002 - Are the non-colour tokens (type, spacing, radius, focus) enumerated with values? [Completeness, Spec §FR-005] — FR-005 + data-model.md.
- [x] CHK003 - Is the set of PrimeNG components the preset must style named? [Completeness, Spec §FR-006] — button, input, toggle switch, dialog, drawer, toast, popover, table.
- [x] CHK004 - Are the sample page's required contents listed? [Completeness, Spec §FR-015, US6] — US6 scenario 1.
- [x] CHK005 - Does the spec say how the theme is registered for the app? [Completeness, Spec §FR-008]

## Requirement Clarity

- [x] CHK006 - Is "strong contrast" quantified per pair class? [Clarity, Spec §FR-009] — 4.5:1 / 3:1 with pairs enumerated (Clarification Q1).
- [x] CHK007 - Is "44 px" defined as which box, at which widths? [Clarity, Spec §FR-013] — interactive box incl. padding, every width (Q2).
- [x] CHK008 - Is "selected state in amber" defined visually? [Clarity, Spec §FR-007] — text and border on a 10% tint (Q5).
- [x] CHK009 - Is the colour-literal check's scope and pattern defined? [Clarity, Spec §FR-016] — directories, file types, patterns (Q3).

## Requirement Consistency

- [x] CHK010 - Are the text-size rules consistent between the story's acceptance criteria and the Build brief? [Consistency, Spec §FR-010] — superseded 9 px rule recorded in Sources; one 12 px floor.
- [x] CHK011 - Is the amber-only-for-main-action rule consistent with the toggle on-state and the selected state? [Consistency, Spec §FR-007, US2] — solid amber for the main action and toggle-on only; tint for selection.
- [x] CHK012 - Is the light focus-ring colour consistent with the 3:1 focus-ring contrast rule? [Consistency, Spec §FR-009, design.md] — 8A5E00 in light, recorded in design.md "Mock vs Build brief".

## Scenario & Edge Case Coverage

- [x] CHK013 - Are requirements defined for the scheme changing while a form is open? [Coverage, Spec §FR-003, US1-3]
- [x] CHK014 - Are font-load failure and missing-glyph fallbacks specified? [Edge Case, Spec §FR-011, US3-3/4]
- [x] CHK015 - Are forced-colours requirements stated for panels and focus? [Edge Case, Spec §FR-012, §FR-014]
- [x] CHK016 - Is the behaviour with no colour-scheme preference and when printing defined? [Edge Case, Spec Edge Cases, §FR-002]

## Dependencies & Assumptions

- [x] CHK017 - Is the owner's approval of the light theme recorded as outside this build, with its gate? [Assumption, Spec Clarifications, US6] — approval is the owner's step before launch [X26g].
- [x] CHK018 - Are out-of-scope neighbours (lamp, dial, charts, motion, phone layout, dialogs as parts) named? [Dependency, Spec Assumptions]
- [x] CHK019 - Is the PrimeNG licence-key dependency documented? [Dependency, plan research.md §2] — research.md §2; carried as an open question to the report.
- [x] CHK020 - Is the font-file budget conflict (ST-249, proposed) recorded? [Assumption, Spec Assumptions, research.md §3]

## Notes

- 20/20 satisfied on 2026-10-04 after the clarify pass; CHK019 resolved by research.md.
