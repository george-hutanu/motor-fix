# CI Speed Checklist: CI finishes faster and queues less on the free runner cap

**Purpose**: Unit tests for the requirements of ST-750: are they complete, clear, consistent and measurable before tasks are written
**Created**: 2026-10-06
**Feature**: [spec.md](../spec.md), [plan.md](../plan.md)

**Review Ownership**: Reviewer-owned requirements-quality artifact. `[x]` means the requirements-quality criterion is satisfied, not that implementation is done.

## Requirement Completeness

- [x] CHK001 Is every check that runs today named in a requirement that it must keep running and keep failing CI OK? [Completeness, Spec §FR-002, §SC-006]
- [x] CHK002 Are requirements stated for the parallel-only test failure class (shared account, mailbox, port), including who fixes it and when? [Coverage, Spec §Edge Cases, §US1-2, Plan §D1]
- [x] CHK003 Are requirements defined for an empty, evicted or unavailable Docker layer cache? [Gap, fixed: added to Spec §Edge Cases]
- [x] CHK004 Is the release path (`run-many` on `main`) covered, not only PR runs? [Coverage, Spec §Edge Cases, §FR-006]
- [x] CHK005 Is the effect on consumers of check names (merge gate, tail CI wait, fix-ci, AGENTS.md, pr-test run.mjs) covered by a requirement? [Completeness, Spec §FR-007, §FR-008, Plan §D2]

## Requirement Clarity

- [x] CHK006 Is "fewer runner jobs" quantified with a number and a baseline? [Clarity, Spec §FR-002, §SC-001]
- [x] CHK007 Is "pending release" bounded so a running deploy is never cancelled? [Clarity, Spec §FR-006, §Clarifications Q1]
- [x] CHK008 Is "identifiable by name" for a failed folded check defined by a concrete mechanism? [Clarity, Spec §FR-003, §Clarifications Q2]
- [x] CHK009 Is "passes only on retry" scoped to PR CI versus the deployed-address run? [Clarity, Spec §FR-010, §Clarifications Q5]

## Requirement Consistency

- [x] CHK010 Do SC-001 (at most 8 jobs) and the plan's layout (7 jobs, 3 setups) agree with SC-003 (at most 4 setups)? [Consistency, Spec §SC-001, §SC-003, Plan §D2]
- [x] CHK011 Do SC-002 (E2E at most 7 min) and SC-007 (CI OK no later than about 11 min) hold together with the baseline of 629 s E2E and 675 s total? [Consistency, Spec §SC-002, §SC-007, Plan §Baseline]
- [x] CHK012 Do the Out of Scope entries (Node matrix, runner labels, E2E after merge) conflict with any requirement? [Consistency, Spec §Out of Scope]

## Acceptance Criteria Quality and Measurability

- [x] CHK013 Can each of SC-001 to SC-007 be measured from a named source, and is it said which can only be seen after merge? [Measurability, Spec §Assumptions, Plan §Measurement]
- [x] CHK014 Does every FR map to an acceptance scenario or success criterion? [Traceability, Spec §FR-001..FR-010; FR-010 via US1-2 and the plan's config spec]

## Non-Functional and Dependencies

- [x] CHK015 Are the Evidence numbers sourced, and are unsourced numbers kept in Assumptions? [Assumption, Spec §Evidence, §Assumptions]
- [x] CHK016 Is the dependency on the 4-vCPU runner and the 20-job cap documented? [Dependency, Spec §Evidence, Plan §Technical Context]

## Notes

- CHK003 was the only gap; the cold-build fallback is now an edge case in the spec.
