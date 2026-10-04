# Templates Checklist: Message templates in Romanian and English

**Purpose**: Unit tests for the requirements of the template system: content rules, languages and formats, channel limits, failure handling
**Created**: 2026-10-04
**Feature**: [spec.md](../spec.md)

`[x]` means the reviewer judged the requirement quality satisfied (here: the /speckit-auto run, phase 6, each with its resolution), not that code exists.

## Requirement Completeness

- [x] CHK001 - Are the channels a template may define listed exhaustively? [Completeness, Spec §FR-001] — e-mail, push, SMS, WhatsApp, bell.
- [x] CHK002 - Is the set of texts this story must write named, with the variants of ACCOUNT_EMAIL? [Completeness, Spec §FR-010] — TEST_MESSAGE, ACCOUNT_EMAIL check/reset, generic and QUOTE_RECEIVED grouped.
- [x] CHK003 - Is the behaviour defined for a type that has no template on a channel? [Gap → resolved, Spec §Edge Cases, Clarifications Q1]
- [x] CHK004 - Is the source of the button link defined for a message that has no caller-given link (the test message)? [Gap → resolved, plan R8: the `app` value]

## Requirement Clarity

- [x] CHK005 - Are the price and date formats given as exact strings in both languages? [Clarity, Spec §US1 scenarios 3–4]
- [x] CHK006 - Is "fits one SMS" quantified, including whether the link counts? [Clarity, Spec §FR-007] — 70 characters, link included.
- [x] CHK007 - Is "missing value" defined precisely enough to separate it from an invalid one? [Clarity, Spec §Edge Cases] — absent/null fails; not-a-number renders "—".
- [x] CHK008 - Is the privacy rule stated per value name and audience, with its exceptions? [Clarity, Spec §US3 scenario 2]

## Requirement Consistency

- [x] CHK009 - Is the phone rule consistent with the Notion source, or is the difference recorded? [Conflict → recorded, Spec §Clarifications Q2]
- [x] CHK010 - Do FR-002 and the bell's "viewer's language" rule agree on who picks the language? [Consistency, Spec §FR-002, Clarifications Q5]

## Acceptance Criteria Quality

- [x] CHK011 - Can every check rule of FR-009 be shown failing by one example? [Measurability, Spec §US3, SC-004]
- [x] CHK012 - Is "not sent" for a failed render measurable (provider calls, row state, reason)? [Measurability, Spec §US4, SC-005]

## Scenario Coverage

- [x] CHK013 - Are Romanian plural forms for grouped counts specified? [Gap → resolved, Spec §Edge Cases, Clarifications Q4]
- [x] CHK014 - Is the HTML escaping of values addressed for both parts of the e-mail? [Coverage, Spec §Edge Cases]
- [x] CHK015 - Are dates around the daylight-saving change covered? [Edge Case, Spec §Edge Cases]

## Dependencies & Assumptions

- [x] CHK016 - Is the end-to-end test's absence justified and its replacement named? [Assumption, Spec §Assumptions]
- [x] CHK017 - Is the environment the worker newly needs (the web URL) named as a dependency the owner must set? [Dependency, plan R8] — PR Risk section carries it.

## Notes

- All 17 items resolved in phase 6 of /speckit-auto; CHK003, CHK004 and CHK013 were gaps fixed in spec.md/plan.md before this checklist closed.
