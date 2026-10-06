# Dispatch Requirements Quality Checklist: The phase model pins fire under /speckit-auto

**Purpose**: Unit tests for the requirements of the phase-agent dispatch (spec.md + plan.md)
**Created**: 2026-10-05
**Feature**: [spec.md](../spec.md)

**Note**: Reviewer-owned requirements-quality checklist. `[x]` means the requirements-quality criterion is satisfied (after a fix) and does not mean implementation is done.

## Requirement Completeness

- [x] CHK001 Is the set of dispatched phases stated once and identically in spec and plan? [Consistency, Spec §FR-001, Plan Summary]
- [x] CHK002 Is every phase 2-8 and 9-14 accounted for as dispatched, inline, or Opus-stays (including phase 3)? [Completeness, Spec §FR-002, Assumptions]
- [x] CHK003 Are the reply-line cap and envelope for a phase agent specified where the run reads them? [Gap, Spec §FR-003, Plan Design 1]
- [x] CHK004 Is the location of the per-phase run-log line (model + STATUS) stated, given FR-007's frozen sections? [Gap, Plan Design 4]
- [x] CHK005 Are requirements for the story agent depth (depth 2 and 3) documented? [Coverage, Spec Edge Cases]

## Requirement Clarity

- [x] CHK006 Is "the run's model" defined as a fixed value rather than a run-time property? [Clarity, Spec Clarifications]
- [x] CHK007 Is "cannot start" defined objectively, and distinguished from a silent substitution? [Ambiguity, Spec §FR-009, Edge Cases]
- [x] CHK008 Is the `partial` acceptance rule precise enough to decide pass or fail? [Clarity, Spec §FR-003]
- [x] CHK009 Is "no worse" for the spec-reviewer verdict given a concrete baseline? [Clarity, Spec §SC-004]

## Requirement Consistency

- [x] CHK010 Do FR-002 (phases 9-14 stay Opus) and the plan's harness-spec scope (which phases it checks for no `model:` token) agree? [Conflict, Spec §FR-002, Plan Design "The spec" test 3]
- [x] CHK011 Does FR-007's frozen region match the region the plan's verification diff compares? [Consistency, Spec §FR-007, Plan Order of work 4]
- [x] CHK012 Is the model router's non-involvement consistent between Edge Cases and the plan? [Consistency, Spec Edge Cases, Plan Decision 3]

## Acceptance Criteria Quality and Measurability

- [x] CHK013 Is SC-001 objectively measurable from a named source (transcript, per turn)? [Measurability, Spec §SC-001, FR-004]
- [x] CHK014 Are the before/after measures, and their not-measurable items, specified with a source for each? [Completeness, Spec §FR-005, Plan Measurement]
- [x] CHK015 Does SC-002 avoid a target that no source supports? [Clarity, Spec §SC-002]
- [x] CHK016 Is FR-008's "a harness spec MUST fail" traceable to a specified test in the plan? [Traceability, Spec §FR-008, Plan Design "The spec"]

## Scenario and Edge Case Coverage

- [x] CHK017 Are failure, blocked and pin-miss flows each given a defined outcome (stop, no retry, inline fallback)? [Coverage, Spec §FR-003, FR-009]
- [x] CHK018 Are skipped phases at size levels 0/1 covered, with no agent dispatched? [Coverage, Spec US1 scenario 5]
- [x] CHK019 Is the overlap with PR #140 and lever 4 a stated requirement? [Dependency, Spec §FR-007, Plan Constraints] (concurrent-run half struck: Parallel runs is outside phases 2-8 and untouched, plan Design 5)
- [x] CHK020 Are the dependencies on tools a phase agent needs (git, gh, Notion) documented? [Dependency, Spec Edge Cases, Assumptions]
