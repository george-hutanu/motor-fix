# Requirements Checklist: public tab bar

**Purpose**: Are the bar's requirements complete, clear and testable before tests are written?
**Created**: 2026-10-04 · **Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Every tab's destination is specified for every state (no brand / brand; signed in / out) [FR-004, FR-005, FR-006]
- [x] CHK002 The active tab is specified for every public screen, and screens without the bar are named [FR-003, Edge Cases]
- [x] CHK003 Both languages' texts are named, including the landmark [FR-001, FR-002, FR-012]
- [x] CHK004 The breakpoint and the keyboard rule state what "hidden" means [FR-008, FR-009]
- [x] CHK005 The placeholders' content and addresses are specified [FR-011]

## Clarity

- [x] CHK006 "Amber" is a named token, not a pixel colour [FR-003]
- [x] CHK007 Which fields count as text fields is listed [FR-009]
- [x] CHK008 "Last brand" says how long it lives and what clears it [FR-005, Key Entities, Edge Cases]

## Consistency

- [x] CHK009 Mock and Build brief differences are resolved in design.md, the Build brief winning [design.md]
- [x] CHK010 SC-001 is reachable: each tab from Home leads to a different address [FR-004..FR-006, Clarifications]

## Measurability and accessibility

- [x] CHK011 Sizes are numbers (44 px tabs, 12 px labels, 320 px width) [FR-007, SC-002]
- [x] CHK012 Screen-reader and keyboard behaviour is stated [US2 scenarios 4–5, FR-002, FR-003]
- [x] CHK013 Short-page and long-page placement are both stated [FR-010]
