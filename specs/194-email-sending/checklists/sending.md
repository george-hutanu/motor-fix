# Requirements Checklist: e-mail sending — reliability, trust boundaries, timing

**Purpose**: Unit tests for the requirements of 194-email-sending before planning sign-off
**Created**: 2026-10-04
**Audience**: PR reviewer (standard depth). `[x]` means the requirement text satisfies the item, not that code exists. Evaluated autonomously under `/speckit-auto`; each tick cites what satisfied it.

## Requirement Completeness

- [x] CHK001 - Are the states of a NOTIFICATION row and every transition between them specified? [Completeness, Spec §FR-003, §FR-008, §FR-010, §FR-011] — queued/held/sent/failed with release and failure paths.
- [x] CHK002 - Is the outcome of a grouped e-mail that fails for good specified for every row it carries? [Gap → fixed, Spec §FR-009]
- [x] CHK003 - Are the failure reasons a row can carry enumerated? [Completeness, Spec §FR-008, §FR-014, §FR-015, data-model.md]
- [x] CHK004 - Is what may and may not appear in logs specified? [Gap → fixed, Spec §FR-020]

## Requirement Clarity

- [x] CHK005 - Are the quiet-hours bounds stated with inclusive/exclusive ends and a time zone? [Clarity, Spec §FR-010, Edge Cases]
- [x] CHK006 - Is "retryable" defined by concrete provider answers? [Clarity, Spec §FR-008] — 5xx, 429, timeout, network.
- [x] CHK007 - Is the allow-list format and its empty case defined? [Clarity, Spec §FR-015]

## Requirement Consistency

- [x] CHK008 - Do the grouping rule and the 60-second send scenario agree? [Conflict → resolved, Spec §Clarifications Q1, §FR-009, US1]
- [x] CHK009 - Is idempotency consistent with direct sends that must never be deduplicated? [Consistency, Spec §FR-005, §FR-012]
- [x] CHK010 - Do the always-sent, transactional and groupable flags exclude each other as stated? [Consistency, Spec §FR-001]

## Acceptance Criteria Quality

- [x] CHK011 - Can every success criterion be checked by an automated test without a real provider? [Measurability, Spec §SC-001–SC-007]

## Scenario Coverage

- [x] CHK012 - Are recovery requirements stated for a job lost from Redis? [Coverage, Recovery, Spec §FR-002] — rows before jobs.
- [x] CHK013 - Are requirements defined for a worker crash between the provider accepting and the job finishing? [Coverage, Edge Cases]
- [x] CHK014 - Are deleted and address-less recipients covered? [Coverage, Spec §FR-003, US1 scenario 5]

## Non-Functional Requirements (security)

- [x] CHK015 - Is the trust boundary of the webhook stated, with the answer to a missing or wrong secret? [Security, Spec §FR-014]
- [x] CHK016 - Is the admin endpoint's answer for each other role and for no session specified? [Security, Spec §FR-013]
- [x] CHK017 - Is a bound on how many recipients one admin call may reach specified? [Security, Spec §FR-013] — 1 to 20.
- [x] CHK018 - Is accidental mailing of real people outside production prevented by a stated rule? [Security, Spec §FR-015, US7]

## Dependencies & Assumptions

- [x] CHK019 - Are the dependency on ST-257 (relay) and the open S10 decision recorded with their effect on this story? [Dependency, Spec §Assumptions, §FR-015]
- [x] CHK020 - Is the unverified webhook authentication method recorded as an assumption? [Assumption, Spec §Assumptions, research.md R4]

## Notes

- Two gaps fixed in spec.md during this pass (FR-009 failure of a grouped e-mail, FR-020 logs).
