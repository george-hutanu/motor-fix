# Requirements Quality Checklist: Save a draft and come back to it later

**Purpose**: Unit tests for the requirements of ST-114: link-token security and privacy, offline and sync conflict rules, API contract, accessibility and phone layout.
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

**Review Ownership**: reviewer-owned; `[x]` means the requirements-quality criterion is satisfied, not that code is done.

## Token security and privacy

- [x] CHK001 Is the token's entropy, storage form and lookup rule stated? [Clarity, Spec §FR-007, §FR-008]
- [x] CHK002 Is the response identical for a wrong, foreign, deleted and missing token? [Consistency, Spec §FR-007, §SC-003]
- [x] CHK003 Is the token's exposure in the address bar defined? [Coverage, Spec §FR-011]
- [x] CHK004 Are cache and referrer leakage of the token and draft specified? [Gap, fixed: Spec §FR-021]
- [x] CHK005 Is abuse of the public create route to mail third parties bounded beyond the per-draft cap? [Gap, fixed: Spec §FR-021]
- [x] CHK006 Is the fate of earlier tokens defined when the e-mail changes? [Edge Case, Spec §Edge Cases]
- [x] CHK007 Are logs, audit and outbox exclusions for the address and token stated? [Coverage, Spec §FR-018]
- [x] CHK008 Is retention stated, with its single source and the pending legal confirmation? [Assumption, Spec §FR-016]
- [x] CHK009 Is enumeration by e-mail ruled out? [Coverage, Spec §FR-006]

## Offline and sync conflict rules

- [x] CHK010 Is the winner of two concurrent saves defined without merging? [Clarity, Spec §FR-013]
- [x] CHK011 Is the load-time choice between browser and server copy defined by an explicit mark? [Clarity, Spec §Clarifications, §FR-013]
- [x] CHK012 Are offline and failed-save behaviours and recovery triggers specified? [Completeness, Spec §FR-014]
- [x] CHK013 Is browser storage being unavailable addressed? [Edge Case, Spec §FR-003]
- [x] CHK014 Is a save to a deleted or sent draft defined? [Exception Flow, Spec §FR-012, §Edge Cases]
- [x] CHK015 Is the save cadence quantified (1 s, 5 s, step change, button)? [Measurability, Spec §FR-002, §FR-005]

## API contract

- [x] CHK016 Are all four routes, the header, status codes and stable error codes named? [Completeness, Spec §FR-005..FR-012, contracts/listing-drafts.md]
- [x] CHK017 Is the 256 KB limit and its error specified? [Measurability, Spec §FR-006]
- [x] CHK018 Is the rate-limit response (429 with seconds) specified for send and for create? [Completeness, Spec §FR-009, §FR-021]
- [x] CHK019 Is the e-mail validation rule precise and referenced? [Clarity, Spec §FR-001]
- [x] CHK020 Are the notifications changes and their scope limit stated? [Dependency, Spec §FR-010]
- [x] CHK021 Are timer idempotence and the retention/reminder thresholds quantified? [Measurability, Spec §FR-015, §FR-016]

## Accessibility and phone layout

- [x] CHK022 Are 320 px, target size, text size, themes and languages quantified? [Measurability, Spec §FR-019]
- [x] CHK023 Are announcements for errors and the link-sent line required? [Coverage, Spec §FR-019]
- [x] CHK024 Are the undesigned elements (e-mail field, notes, error pages) acknowledged? [Assumption, Spec §Sources]
- [x] CHK025 Does the language switch keep the draft and notes? [Consistency, Spec §US1 scenario 5]
- [x] CHK026 Is the highlighted-field state defined beyond colour (error text and focus)? [Clarity, contracts/page.md]
