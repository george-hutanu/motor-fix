# Requirements Checklist: account language (API and web save)

**Purpose**: check the requirements, not the code, for the saved account language
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

## Completeness

- [x] CHK001 Who may change the language is stated (every signed-in account, itself only, every role) [FR-001]
- [x] CHK002 The accepted values and the default are stated [FR-003, FR-004]
- [x] CHK003 The answer of the change is specified (same shape as "who am I") [FR-001]
- [x] CHK004 The refusals and their codes are specified: no token, suspended, bad body [FR-002, FR-003]
- [x] CHK005 The audit entry's shape and when none is written are specified [FR-005]
- [x] CHK006 The signed-out behaviour is specified [FR-007]
- [x] CHK007 The failure behaviour on the web is specified [FR-009]

## Clarity

- [x] CHK008 "Signed in" in the web app is defined (the session holds an account) [FR-006, Clarifications]
- [x] CHK009 What counts as a choice that saves is separated from other language changes [FR-008]
- [x] CHK010 Concurrent taps and late answers are specified [FR-006, Edge Cases]

## Consistency

- [x] CHK011 The retry rule and the account-wins rule at sign-in do not conflict (retry only at the next tap) [FR-009, Assumptions]
- [x] CHK012 The brief's "Emits: none" matches the plan (no event) [plan Constitution Check VI]

## Scope

- [x] CHK013 Messages, templates and the reset e-mail are out of scope and say who owns them [Assumptions]
- [x] CHK014 No visual change is promised beyond the existing switch [design.md]
