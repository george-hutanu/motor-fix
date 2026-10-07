# File Checks Checklist: Store each file's checks and their results

**Purpose**: Requirements quality for data integrity, API contract and errors, audit/outbox transactionality and summary text
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Note**: Reviewer-owned requirements-quality checklist; `[x]` means the criterion is satisfied in the spec and plan, not that code is done.

## Data integrity

- [x] CHK001 Is "exactly one check per kind" stated with a uniqueness rule and a resend rule that cannot conflict? [Consistency, Spec §FR-001, data-model.md]
- [x] CHK002 Are files sent before this change covered, not only new submissions? [Coverage, Spec §FR-002]
- [x] CHK003 Is it defined what a save does to the stored detail when none is sent? [Gap, Spec §FR-003] (fixed: replaced, empty)
- [x] CHK004 Is the detail length bound stated once, with the same value in spec, contract and storage? [Consistency, Spec §FR-010, data-model.md]
- [x] CHK005 Is the owner of the garage's activities list, and the effect of an omitted list, unambiguous? [Clarity, Spec §FR-004]
- [x] CHK006 Is the behaviour of a `failed` check kept across a resend explicit? [Edge Case, Spec Edge Cases]
- [x] CHK007 Is the outcome of two concurrent saves defined with respect to the audit's old values? [Gap, Spec §FR-003] (fixed: row lock)

## API contract and errors

- [x] CHK008 Does every refusal have one status, one code and one trigger, with no trigger in two rows? [Consistency, Spec §FR-010, contracts]
- [x] CHK009 Is the order in which refusals apply defined when several hold at once? [Completeness, contracts "Order"]
- [x] CHK010 Does the spec's refusal list match the contract's (activities on another kind)? [Conflict, Spec §FR-010] (fixed)
- [x] CHK011 Is the non-admin and unknown-file answer the same, so the route's existence is not revealed? [Clarity, Spec §FR-011, SC-004]
- [x] CHK012 Is the success response's content (check, both-language summary, activities list) fully specified? [Completeness, contracts]
- [x] CHK013 Is the result set accepted by the route stated, including that `not_run` is never written back? [Clarity, contracts]
- [x] CHK014 Is the file-status rule for accepting a record, including reopened files, unambiguous? [Clarity, Spec §FR-010, Clarifications]

## Audit and outbox transactionality

- [x] CHK015 Is "all saved together or not at all" required for check, garage list, audit entry and event? [Completeness, Spec §FR-004, FR-006, FR-007, SC-002]
- [x] CHK016 Does the spec state what the audit entry carries, and that creating rows writes none? [Clarity, Spec §FR-006, data-model.md]
- [x] CHK017 Are the event's payload and audience defined? [Completeness, Spec §FR-007, data-model.md]
- [x] CHK018 Is the transaction boundary of row creation at submit and resend stated? [Clarity, Spec §FR-001]
- [x] CHK019 Is it stated that a rolled-back record leaves no audit or event? [Measurability, Spec §SC-002]

## Summary text

- [x] CHK020 Is every summary string fixed in both languages, including the singular/plural forms? [Completeness, Spec §FR-009, Clarifications]
- [x] CHK021 Are the tie-break rules for the second part total (severity, rar, kind order)? [Clarity, Spec Edge Cases, FR-009]
- [x] CHK022 Are the Romanian names of the kinds beyond the examples fixed somewhere? [Gap, Spec Assumptions, research.md R5]
- [x] CHK023 Is it stated that the detail is shown as typed and not translated? [Clarity, Clarifications]
- [x] CHK024 Is the documents part of the summary explicitly out of scope with a recorded deferral? [Assumption, Spec Assumptions]
- [x] CHK025 Is the lamp mapping total over all four results? [Completeness, Spec §FR-008]

## Notes

- Gaps fixed: detail replaced on save, row lock for old values, activities-on-other-kind refusal in FR-010.
