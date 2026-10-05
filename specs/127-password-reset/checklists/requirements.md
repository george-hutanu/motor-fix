# Requirements checklist — 127-password-reset

- [x] Every Build brief scenario maps to an acceptance scenario (1→US1.1, 2→US1.2, 3→US1.3, 4→US2.2, 5→US2.3, 6→US3.1, 7→US2.5, 8→US1.4).
- [x] Every *(proposed)* detail is built as proposed or recorded as an autonomous default (texts, link, codes, limits, password_changed).
- [x] Each FR is testable from outside (HTTP status, rows, queued notification, Redis message, DOM, navigation).
- [x] Errors and edge cases named: unknown/suspended/deleted account, malformed/unknown/used/expired/voided token, weak password, concurrent completes, Redis down, queue failure, changed address.
- [x] Data and audit named (account_token, password identity, refresh_token delete, one audit entry without values).
- [x] Out of scope stated (password change while signed in, admin reset).
- [x] The one schema change (an enum value) is named in the plan.
- [x] Phone, tablet, desktop and both languages covered by the shared overlay (design.md).
