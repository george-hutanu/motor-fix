# Live Connection Requirements Checklist: Set up the real-time connection to open dashboards

**Purpose**: Unit tests for the spec's requirements on security, reliability and fan-out
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the requirement quality was judged sufficient (in this `/speckit-auto` run, by the run itself, with the reason given); it says nothing about the implementation.

## Security

- [x] CHK001 - Is the only accepted way of presenting the token stated, and is the token in the address explicitly ruled out? [Clarity, Spec §FR-001] — yes, FR-001 "by the `Authorization: Bearer` header only, never a token in the address".
- [x] CHK002 - Are the answers for no token, a suspended account and a non-admin on the test address each specified, and do they agree with every other signed-in call? [Consistency, Spec §FR-002, §FR-012] — 401 / 403 / 404, same as ActorGuard and the 404-not-403 rule (policy.ts).
- [x] CHK003 - Does the spec say that nothing personal travels on the wire, and name what an event carries instead? [Completeness, Spec §FR-005, Assumptions] — kind, id, time; the `live.test` id is a fresh event id, never the account id.
- [x] CHK004 - Is it stated which channels a person may join and that the server, not the client, chooses them? [Completeness, Spec §FR-004] — channels come from the role in use on the server; the client sends nothing but the token.

## Reliability

- [x] CHK005 - Is the heartbeat interval quantified and is "no event" defined as the trigger? [Clarity, Spec §FR-007] — 25 s of silence.
- [x] CHK006 - Are the server-initiated ends enumerated, and does the client's reconnect rule cover each of them? [Coverage, Spec §FR-008, §FR-014] — `bye` expired / evicted / shutdown; reconnect on expired and shutdown only.
- [x] CHK007 - Is the reconnect time bounded and the no-reconnect cases listed? [Measurability, Spec §FR-014, SC-003] — within 3 s; never after evicted, sign-out or a failed renewal.
- [x] CHK008 - Is the Redis outage covered for open streams, new streams and recovery? [Coverage, Spec §FR-011, US3 §6] — all three, after clarification Q5.
- [x] CHK009 - Is a lost connection without `bye` placed in or out of scope? [Gap → resolved, Spec Assumptions] — out: ST-255.

## Fan-out

- [x] CHK010 - Is "exactly once per connection in the audience" stated for more than one API copy? [Clarity, Spec §FR-006, SC-002]
- [x] CHK011 - Is the audience format defined (a list of channel keys) and the match rule (any of the connection's channels)? [Clarity, Spec §FR-006] — "whose channels meet the audience".
- [x] CHK012 - Is the behaviour for a malformed fan-out message specified? [Edge Case, Spec §FR-011, Edge Cases]
- [x] CHK013 - Is the scope of the 10-stream cap (per account, per API copy) explicit and recorded as a narrowing of the brief? [Assumption, Spec §FR-009, Assumptions]

## Notes

- `/speckit-implement` reads these markers; it does not change them.
