# Requirements checklist — 128-sign-out

- [x] Every Build brief scenario maps to an acceptance scenario (1→US1.1, 2→US1.2, 3→US2.3–4, 4→US1.3, 5→US3.1).
- [x] Every *(proposed)* detail is either built as proposed or recorded as an autonomous default (placement, English texts, message name).
- [x] Each FR is testable from outside (HTTP status, rows, Redis message, DOM, navigation).
- [x] Errors and edge cases named: no/unknown/expired/reused token, Redis down, offline, already signed out, several tabs.
- [x] Data and audit named (refresh_token delete, one audit entry; single sign-out none).
- [x] Out of scope stated (ST-129, settings pages).
- [x] No requirement needs a schema change or a new dependency.
- [x] Phone, tablet, desktop and both languages covered by the frame's shared account block (design.md).
