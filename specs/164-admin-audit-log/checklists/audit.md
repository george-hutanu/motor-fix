# Audit Requirements Checklist: Admin actions in the audit history

**Purpose**: Validate the quality of the admin-audit requirements (FR-001 to FR-007) and the admin-route guard test.
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Note**: Reviewer-owned requirements-quality checklist; `[x]` means the criterion is satisfied in the spec/plan, not that code is done.

## Requirement Completeness

- [x] CHK001 Are all `admin/*` data-changing routes in the API today enumerated with the entry each owes? [Completeness, Spec §SC-001, §FR-002, §FR-003]
- [x] CHK002 Are the entry fields (action, subject, kind, old/new value) defined for both new entries? [Completeness, Spec §FR-002, §FR-003]
- [x] CHK003 Is the failure behaviour defined when the entry cannot be written? [Completeness, Spec §FR-001, §FR-003]
- [x] CHK004 Is the guard test's behaviour defined for a route with no fixture? [Completeness, Spec §FR-004, §US2.2]
- [x] CHK005 Is the guard's call order defined so a per-admin before/after count cannot be polluted by other calls? [Gap, fixed: FR-004 now says one call at a time]

## Requirement Clarity

- [x] CHK006 Is "an entry made by the admin" defined by concrete fields (actor_id, role, first name)? [Clarity, Spec §FR-001]
- [x] CHK007 Is "known-good request" tied to a fixture table keyed by `METHOD /path`? [Clarity, Spec §FR-004]
- [x] CHK008 Are the stored new values specified precisely (validated body as JSON, shape given)? [Clarity, Spec §FR-002, §FR-003]

## Requirement Consistency

- [x] CHK009 Do User Story 1 scenarios and FR-001..FR-003 agree on action `create` and the subjects? [Consistency, Spec §US1.1-2]
- [x] CHK010 Is the "entry commits first" rule for the test message consistent between spec, plan and Clarifications? [Consistency, Spec §FR-003, Plan §Summary]
- [x] CHK011 Are SC-001/SC-002 counts (three changing, one reading) consistent with the plan's route list? [Consistency, Spec §SC-001, §SC-002]

## Scenario and Edge Case Coverage

- [x] CHK012 Are refused calls (404, 400, 409) and rolled-back changes covered as no-entry cases? [Coverage, Spec §US1.6-7, §SC-004]
- [x] CHK013 Is the read-route rule and the exception for later logged reads specified? [Coverage, Spec §US3, §FR-004]
- [x] CHK014 Are multi-entry actions and system-on-behalf actions addressed? [Edge Case, Spec §Edge Cases]
- [x] CHK015 Is the admin-via-assistant case addressed? [Edge Case, Spec §Edge Cases]

## Dependencies, Assumptions and Scope

- [x] CHK016 Are unbuilt admin stories and the legal-document `open` read explicitly out of scope with who owns them? [Dependency, Spec §Assumptions, §Out of scope]
- [x] CHK017 Are retention and append-only assumptions stated as open or already enforced? [Assumption, Spec §Assumptions]
- [x] CHK018 Is Playwright absence justified and the Spec Delta consistent with FR-005..FR-007 being non-additive? [Consistency, Spec §FR-007, §Spec Delta]
