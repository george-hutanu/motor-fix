# Requirements checklist: 255-live-resync

- [X] CHK001 Every Build brief scenario (1–9) maps to an FR: 1→FR-004/SC-001, 2→FR-002, 3→FR-003, 4→FR-005, 5→FR-006, 6→FR-007/FR-009, 7→FR-010, 8→FR-012, 9→FR-008
- [X] CHK002 Every connection state of the brief (open, reconnecting, polling) is named, with when each starts and ends (FR-001–FR-003)
- [X] CHK003 Every number has a source or is marked proposed: 1/2/5/10/30 s, 3 tries, 60 s, 10 s, 24 h (brief); ±10% jitter, 60 s hidden, 60 s silence (Assumptions)
- [X] CHK004 Every text is given in Romanian and English (FR-006, FR-010–FR-012, design.md)
- [X] CHK005 Every refusal status has a defined outcome (FR-009, FR-010, Clarification Q4)
- [X] CHK006 Sign-out, role switch and eviction stop the connection without a bar (Edge Cases, FR-001)
- [X] CHK007 The rules for persistence across a reload and for order are testable without a server (FR-008, FR-009; fake-indexeddb in plan)
- [X] CHK008 The e2e proof says how the network is cut and what counts as "shows" (plan: setOffline, the /me answer)
- [X] CHK009 Out of scope names the owner of each excluded part (ST-253, ST-395, Quotes and booking, Mechanic workspace)
- [X] CHK010 No requirement needs a server change; the Spec Delta lists every new FR
- [X] CHK011 The 320 px rule is stated for the new bar (FR-006, SC-003)
