# Requirements Quality Checklist: Back closes the open task and keeps the page

**Purpose**: validate the quality of ST-491's requirements (front-end history behaviour in `libs/overlays`) before tasks are written
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md), [plan.md](../plan.md)

**Review Ownership**: reviewer-owned requirements-quality artifact. `[x]` means the criterion is satisfied for requirements quality, not that implementation is done.

## Requirement Completeness

- [x] CHK001 Are the number, marker and address of the history entry a task adds specified? [Completeness, Spec §FR-001]
- [x] CHK002 Is every close path (X, Escape, outside, drag, Discard, self-close, service close) assigned to Back-close or entry-removing close? [Completeness, Spec §FR-002, §FR-004]
- [x] CHK003 Is the behaviour for a Back press on a task exempt from the discard question stated? [Completeness, Spec §FR-003]
- [x] CHK004 Is server rendering (no browser history) covered by a requirement? [Coverage, Spec §FR-008]
- [x] CHK005 Is Forward after a Back close specified? [Coverage, Spec §FR-006]
- [x] CHK006 Is Back while a task is already closing addressed? [Gap, Edge Case, Spec Edge Cases]

## Requirement Clarity

- [x] CHK007 Is "top task" defined for stacked tasks, with order of closing? [Clarity, Spec §FR-002, US1 §3]
- [x] CHK008 Is "the router ignores it" turned into a testable condition (no navigation start)? [Clarity, Spec §FR-001]
- [x] CHK009 Is "only after the entry has been removed" defined by an observable event with no timer? [Clarity, Spec §FR-005]
- [x] CHK010 Is how an entry is recognised as the task's own defined? [Clarity, Spec Clarifications, §FR-001]

## Requirement Consistency

- [x] CHK011 Do FR-004's close list and Story 2's close list agree? [Consistency, Spec §FR-004, US2]
- [x] CHK012 Does FR-007 (no move when entry is not current) agree with the dropped close-on-navigation clarification? [Consistency, Spec §FR-007, Clarifications]
- [x] CHK013 Does the Spec Delta list every FR it adds or modifies and map to 157's ids? [Consistency, Spec Delta]
- [x] CHK014 Do the discard-question steps (re-added entry) agree between Story 3, FR-003 and the Assumptions? [Consistency, Spec §FR-003]

## Acceptance Criteria Quality

- [x] CHK015 Are SC-001 to SC-004 stated as countable results over a named suite? [Measurability, Spec §SC-001..SC-004]
- [x] CHK016 Is non-regression of existing overlay behaviour measurable? [Measurability, Spec §SC-005]
- [x] CHK017 Is the untestable race interleaving replaced by an invariant? [Measurability, Spec Edge Cases, §SC-002]

## Scenario and Edge Case Coverage

- [x] CHK018 Are reload, external return and an app navigation during an open task handled as accepted edges? [Coverage, Spec Edge Cases, Assumptions]
- [x] CHK019 Are tasks opened by their own route (ST-22) explicitly out of scope? [Dependency, Spec Edge Cases]
- [x] CHK020 Is the opener-navigates-on-result recovery path (sign-in) required? [Coverage, Spec §FR-005, SC-004]

## Non-Functional and Dependencies

- [x] CHK021 Are focus return and scroll preservation required on a Back close? [Coverage, Spec §FR-002]
- [x] CHK022 Is the dependency on the CDK's close-on-navigation default documented with evidence? [Dependency, Plan Design §1]
- [x] CHK023 Is the "no new text, option, control or dependency" boundary stated? [Assumption, Spec Unchanged note, Plan Constitution Check I]
- [x] CHK024 ~~Are requirements defined for a browser without the History API?~~ N/A: pushState and popstate are universal in every supported browser; the no-window case is FR-008.
