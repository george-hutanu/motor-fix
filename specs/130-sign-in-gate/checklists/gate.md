# Sign-in Gate Checklist: Be asked to sign in when an action needs an account

**Purpose**: Unit tests for the requirements of the deny-by-default API and the client-side resume
**Created**: 2026-10-04
**Audience**: PR reviewer (defaults: standard depth, the two focus areas named by the request)

`[x]` means the requirements-quality criterion is satisfied, not that the code is done. `/speckit-implement` reads these markers and does not change them.

## Requirement Completeness

- [x] CHK001 - Is the exact set of routes reachable without a session enumerated, rather than described by category? [Completeness, Spec §FR-002] — six routes listed.
- [x] CHK002 - Is the mechanism by which a future route becomes public specified, so that "public" cannot happen by omission? [Completeness, Spec §FR-001, Assumptions] — an explicit mark; absence means gated.
- [x] CHK003 - Are the answers for an expired, malformed and wrongly signed token specified, not only a missing one? [Completeness, Spec §US1 scenario 2]
- [x] CHK004 - Is the outcome of closing the dialog without signing in specified for both the call and the form? [Completeness, Spec §FR-006]

## Requirement Clarity

- [x] CHK005 - Is "before the body is validated" stated, so a visitor cannot learn a route's validation rules without a session? [Clarity, Spec §FR-001]
- [x] CHK006 - Is "sent again once" bounded, so a repeated call that is refused again does not loop? [Clarity, Spec §FR-005, SC-003] — once; a second refusal fails as the original.
- [x] CHK007 - Is it clear which client calls never open the dialog (session calls, "who am I", live stream, server render)? [Clarity, Spec §FR-004, §FR-009, Edge Cases]

## Requirement Consistency

- [x] CHK008 - Do FR-007 and FR-008 agree on what happens when a refused call waits on a dialog opened by "Autentificare"? [Consistency, Spec §FR-007, §FR-008] — the call is repeated and the landing opens.
- [x] CHK009 - Is the reason-line wording the same in the dialog and in the form's message? [Consistency, Spec §FR-004, §FR-006]

## Scenario and Edge Case Coverage

- [x] CHK010 - Are refusals other than `sign_in_required` (403 suspended, 404 missing right, 401 invalid credentials) excluded from the gate? [Coverage, Spec §Edge Cases, SC-004]
- [x] CHK011 - Is the case of signing in as an account that lacks the action's right covered? [Edge Case, Spec §Edge Cases] — the repeated call's 404 reaches the screen.
- [x] CHK012 - Is the reload of a remembered session (no token in memory, valid cookie) covered so it does not open the dialog? [Coverage, Spec §FR-004, Clarifications] — renewal first.

## Non-Functional: Security

- [x] CHK013 - Is it stated that the browser gate is a convenience and the server's refusal is the control? [Security, Spec §US1, Assumptions] — US1 "a check made only in the browser is not a check".
- [x] CHK014 - Is the unchanged behaviour of the suspended and capability answers stated for gated routes? [Security, Spec §FR-003]
- [x] CHK015 - Are the brief's *proposed* details this spec departs from recorded for the owner rather than silently changed? [Assumption, Spec §Assumptions, context.md Contradictions]

## Notes

- Evaluated 2026-10-04 by the autonomous run against spec.md after clarification; no gap required a spec edit.
