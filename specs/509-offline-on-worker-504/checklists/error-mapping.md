# Error-mapping Requirements Checklist: Offline message on the service worker's 504

**Purpose**: Unit tests for the requirements of the failure-to-problem mapping (completeness, clarity, consistency, edge cases)
**Created**: 2026-10-06
**Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Is the trigger for `offline` on a 504 defined by all three conditions (status, body, browser state)? [Completeness, Spec §FR-001]
- [x] CHK002 Is the outcome for a bodiless 504 while online defined? [Completeness, Spec §FR-003, US2-1]
- [x] CHK003 Is the outcome for a 504 that carries a problem code defined, both offline and online? [Completeness, Spec §FR-003, US2-2]
- [x] CHK004 Is the outcome for other statuses while offline defined, so the rule does not widen? [Completeness, Spec §FR-003, US2-3]
- [x] CHK005 Is the status-0 behaviour restated so the change cannot regress it? [Completeness, Spec §FR-002]

## Clarity

- [x] CHK006 Is "no problem body" defined precisely (string `code`, after the existing text-body parse; empty `code` counts as none)? [Clarity, Spec §FR-001, Edge Cases, Assumptions]
- [x] CHK007 Is "the browser reports offline" pinned to one signal and one moment (`navigator.onLine === false`, read at mapping time)? [Clarity, Spec §FR-001, Clarifications]
- [x] CHK008 Is the status carried on the `offline` problem specified (504, not 0)? [Clarity, Spec §FR-001, Assumptions]

## Consistency

- [x] CHK009 Do FR-001..FR-003 agree with the existing 159-FR-008 wording via the Spec Delta? [Consistency, Spec §Spec Delta]
- [x] CHK010 Do SC-002's "expectations unchanged" and the permitted adversary title rename agree? [Consistency, Spec §SC-002, Clarifications]

## Edge Cases and Scope

- [x] CHK011 Is the no-`navigator` (SSR) case specified? [Edge Case, Spec §Edge Cases, FR-003]
- [x] CHK012 Is a non-JSON string body (gateway HTML page) specified? [Edge Case, Spec §Edge Cases]
- [x] CHK013 Are the out-of-scope files and surfaces (copy, screens, worker config, `session.ts`, `new-password.ts`) named? [Scope, Spec §FR-004, Clarifications]
- [x] CHK014 Is the effect on the sign-in dialog's `sign_in_required` detection stated? [Coverage, Spec §Edge Cases]
