# Requirements-quality Checklist: Keep garages hidden until approved, with a status flow

**Purpose**: Judge whether the spec's requirements are complete, clear, consistent and measurable before tasks are written
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Review Ownership**: reviewer-owned; `[x]` means the requirements-quality criterion is satisfied (autonomous run: judged by the agent, gaps fixed in spec.md).

## Completeness

- [x] CHK001 Is every one of the 25 ordered file-status pairs classed as allowed or refused? [Completeness, Spec §FR-002, §SC-002]
- [x] CHK002 Is the garage's status after each file decision, including on a reopened approved garage, stated? [Completeness, Spec §FR-003]
- [x] CHK003 Are the preconditions of a reopening stated so the one-live-file rule cannot be broken? [Gap, Spec §FR-002, §FR-004] (gap fixed: reopen of the newest file only)
- [x] CHK004 Is the source of the reason-code list stated? [Gap, Spec §Assumptions] (gap fixed: assumption added)
- [x] CHK005 Is the rollback of a transition whose audit or outbox write fails specified? [Coverage, Spec §FR-008, §SC-003]

## Clarity

- [x] CHK006 Is "public" defined as one testable predicate, and the bypass rule as a failing test naming the method? [Clarity, Spec §FR-005]
- [x] CHK007 Is the 409 detail sentence defined per status and its source (first name) named? [Clarity, Spec §FR-002, §Assumptions]
- [x] CHK008 Is the derivation of each of the seven labels unambiguous, including "approved whatever the newest file"? [Clarity, Spec §FR-006]

## Consistency

- [x] CHK009 Do the user stories, edge cases and FR-002/FR-003 agree on the reopened-file outcomes? [Consistency, Spec §Edge Cases]
- [x] CHK010 Do 404 for hidden, 404 for unknown and 410 for suspended agree between FR-005, Edge Cases and SC-001? [Consistency, Spec §FR-005]

## Scenario and edge coverage

- [x] CHK011 Are concurrent open and concurrent decide each specified with an observable outcome? [Coverage, Spec §Edge Cases, §SC-002]
- [x] CHK012 Is the failed live-event relay after commit addressed? [Edge Case, Spec §Edge Cases]
- [x] CHK013 Is the skip switch defined for each environment and for malformed values? [Edge Case, Spec §FR-009, §SC-005]

## Measurability and non-functional

- [x] CHK014 Does each success criterion state a countable outcome and the test layer? [Measurability, Spec §SC-001..SC-006]
- [x] CHK015 Are audit and notification-audience requirements specified for each transition? [Completeness, Spec §FR-008]
- [x] ~~CHK016 Are accessibility and responsive requirements defined?~~ N/A: the story ships no screen (Spec §FR-010).
- [x] ~~CHK017 Are performance thresholds defined for the public read?~~ N/A: a single-row indexed read; the platform's NFRs apply and the brief sets none.
