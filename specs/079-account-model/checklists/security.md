# Security, Data Model and Routing Requirements Checklist: Account model, roles and their rights

**Purpose**: Unit tests for the requirements — authorization (401/403/404), the data model and dashboard routing
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the reviewer judged the requirement quality satisfied, not that code exists. In this `/speckit-auto` run the reviewer is the run itself; each check carries its evidence.

## Requirement Completeness

- [x] CHK001 - Is every status code the guard can answer specified with its code (401 `sign_in_required`, 403 `account_suspended`, 404)? [Completeness, Spec §FR-011, §FR-013] — yes.
- [x] CHK002 - Is the list of capabilities in this story's table enumerated, with the role grants for each? [Completeness, Spec §FR-010] — enumerated after clarify Q1.
- [x] CHK003 - Are the invalid-token cases (malformed, wrong key, expired, unknown or deleted account) defined? [Completeness, Spec §Edge Cases] — yes.
- [x] CHK004 - Are the uniqueness rules for e-mail, phone, identity (method, subject), membership and mechanic link stated? [Completeness, Spec §FR-001, §FR-003, §FR-005] — yes.
- [x] CHK005 - Does the spec define what the frame shows when the area holds no content yet? [Completeness, Spec §FR-017, design.md States] — "a plain empty state", text proposed in design.md.

## Requirement Clarity

- [x] CHK006 - Is "role in use" defined unambiguously, including the fallback order? [Clarity, Spec §FR-012] — token role, then last role, then fixed order.
- [x] CHK007 - Is the mapping between account role and garage membership role explicit (`garage`→`owner`, `receptionist`→`receptionist`, `mechanic`→mechanic link)? [Clarity, Spec §FR-011] — fixed: FR-011 now names the matching membership; data-model.md gives the mapping.
- [x] CHK008 - Is "public endpoint" in FR-009 bounded to something checkable? [Clarity, Spec §FR-009] — this story ships only "who am I"; tested on use cases and the route list.

## Requirement Consistency

- [x] CHK009 - Are the 403/404 rules consistent between US2's intro, FR-011, FR-013 and SC-002? [Consistency] — aligned in clarify Q2.
- [x] CHK010 - Is the A34 "403 inside one garage" rule reconciled with the story's 404s? [Conflict, context.md Contradictions] — Clarifications: later endpoints; this story's calls answer 404.
- [x] CHK011 - Do the frame's menu entries agree with the capability names? [Consistency, design.md, Spec §FR-010, §FR-018] — design.md menu maps onto FR-010 names.

## Scenario and Edge Case Coverage

- [x] CHK012 - Is the rollback requirement stated when the audit or event step fails during account creation? [Coverage, Spec §FR-006, §SC-004] — yes.
- [x] CHK013 - Is the case of an account holding a garage role with no membership covered? [Edge Case, Spec §FR-011] — garage empty → 404.
- [x] CHK014 - Is the signed-out visitor's destination for a dashboard address specified? [Coverage, Spec §FR-017] — Home `/`.
- [x] CHK015 - Is the requirement that a refused area's code is not downloaded stated measurably? [Measurability, Spec §US3.1] — scenario states it; verified by the e2e on requested chunks.

## Dependencies and Assumptions

- [x] CHK016 - Are the boundaries with ST-82 (token issuing), ST-390 (audit), ST-257 (outbox), ST-394 (role switch) and EP-16 (assistant) recorded? [Dependency, Spec §Assumptions] — yes.
- [x] CHK017 - Is the token key's environment variable named? [Assumption, Spec §Assumptions] — `AUTH_TOKEN_SECRET`.

## Notes

- All items evaluated in the auto run on 2026-10-04; CHK007 needed a fix (FR-011 + data-model.md), already applied.
