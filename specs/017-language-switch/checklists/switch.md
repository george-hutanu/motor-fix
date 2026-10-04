# Requirements Checklist: language switch

**Purpose**: unit-test the requirements of 017 before tasks
**Created**: 2026-10-04

- [x] CHK001 Is the control's accessible structure specified (group name, button names, pressed state)? [Completeness, FR-001, Clarifications Q6]
- [x] CHK002 Is the minimum touch size quantified? [Clarity, FR-002]
- [x] CHK003 Is "keeping the screen's state" defined for the only screen with state? [Clarity, FR-003, Q2]
- [x] CHK004 Is the default independent of the browser language stated? [FR-004]
- [x] CHK005 Is the storage name fixed and an invalid stored value covered? [FR-005]
- [x] CHK006 Are blocked read and blocked write both covered? [Coverage, FR-006, Edge Cases]
- [x] CHK007 Is the tab-sync requirement scoped to the state where it can hold? [Consistency, FR-007 vs FR-006, Q5]
- [x] CHK008 Is when the account language applies (and when not) specified? [Clarity, FR-008, Q1]
- [x] CHK009 Is the server-render behaviour for a remembered English device stated? [Edge Cases, Q4]
- [x] CHK010 Are the parts owned by ST-20 and ST-21 excluded explicitly? [Scope, Assumptions]
- [x] CHK011 Is SC-001 measurable? [Measurability, Q3]
- [x] CHK012 Are dialog texts covered although no dialog exists? [Edge Cases — guaranteed by the runtime, no dialog test]
