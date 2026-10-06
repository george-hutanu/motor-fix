Read by a task-runner fallback: org-researcher had no Notion tools this session.

# Feature Context: Staff notification preferences

- **Feature**: 198-staff-notification-preferences
- **Anchor**: ST-198 "Choose which messages I get as a garage, mechanic or admin" — https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78 | terms: notification, preference, mute, receptionist, can_answer_quotes
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture partial (Architecture decisions only) | decisions ok (Open decisions page grepped for W10, W12, W17, W18, X03, X26f, not read in full)
- **Overall confidence**: medium (sibling stories ST-196, ST-197, ST-392 and the Data model page were not opened; their state is taken from spec.md)

## Story

- **ST-198 Choose which messages I get as a garage, mechanic or admin** — status Planning, priority Medium, role Garage, epic EP-1 Foundations, feature MF-51 Notifications and reminders, 3 points, PR #155
- Scope per the story (page edited 2026-10-06T15:22Z; Build brief current as of 2026-10-03 and "wins"): one switch per kind of message per person for garage owner, receptionist, mechanic and admin, per channel e-mail, push, WhatsApp, never SMS; always-sent types locked on; the request mute is per person and also covers day-2 and day-5 reminders; same NOTIFICATION_PREFERENCE model as the driver's with garage_id; default for every staff type "on, push if a subscription exists, else e-mail (proposed)".
- Comments that moved scope: none (the story and the feature page have no comments, resolved or not).

## Decisions

- A garage can mute new quote request notifications on any channel; requests still show in the dashboard — [ST-198 Notes; MF-51 Open questions] (2026-10-03, confidence: high)
- Staff channels are e-mail, push, WhatsApp; SMS is only for drivers' reminders (W18); the mute also covers REQUEST_REMINDER, which has no switch of its own (W17); a receptionist mutes for themselves (W10) — [ST-198 Notes; MF-51 Build brief rules 5 and 7] (2026-10-03, high)
- Always sent, cannot be switched off: VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED (verification results always include e-mail); DOCUMENT_DUE and DOCUMENT_OVERDUE (X26f); ADMIN_OUTAGE_ALERT at launch (X03); the person "may change the channel of an always-sent type but cannot switch it off (proposed)" — [MF-51 Build brief rule 6] (2026-10-03, high for the first three groups, medium for the rest, marked proposed)
- Mechanic's REQUEST_RECEIVED, REQUEST_REMINDER and MESSAGE_RECEIVED depend on `can_answer_quotes` (W11); DAY_SHEET follows the garage's `day_sheets` and `whatsapp` switches, not a person — [ST-198 scenarios 7 and 9; MF-51 rule 9] (2026-10-03, high)
- `whatsapp` off stops WhatsApp to the garage's own staff only, drivers unaffected (W12); staff then go by their next chosen channel, else e-mail — [MF-51 Edge cases; Open decisions W12] (2026-10-03, high)
- Within one garage's staff a resource outside the person's scope answers 403, across garages 404 — [Architecture decisions A31, A34] (2026-10-04, medium: Proposed)

## Constraints

- The list per role comes from `NOTIFICATION_TYPES`, the catalogue's "Garage list" and "Admin list" columns, filtered by permission and GARAGE_FEATURE; staff rows carry garage_id, and a staff-and-driver person keeps the sets apart — [ST-198 Rules; MF-51 catalogue] (2026-10-03, high)
- Audit history of every change: who, type, channel, old and new value (A27 Given) — [Architecture decisions A27; ST-198 Data] (2026-10-04, high)
- Errors are RFC 9457 problem details with a lower snake case `code` (A28, A42, Proposed); live updates are server-sent events that say only what changed (A8, Given), via `account:{accountId}` and `garage:{garageId}` — [Architecture decisions] (2026-10-04, medium)
- Quiet hours (X25) and fallback rules (rule 13) sit in the worker, not in the preference check: held non-urgent sends are re-checked at release — [MF-51 rules 13 and 16, Edge cases; A37] (2026-10-03, medium)

## Prior Art

- ST-197 driver preference store, the model and the pipeline rule; spec.md calls it merged — [ST-198 Depends on] (2026-10-06)
- ST-196 Web Push, merged per spec.md; ST-392 WhatsApp and the garage's `whatsapp` switch, state not read — [ST-198 Depends on; epic Story order, slice 7] (2026-10-03)
- The mock has switches only for drivers (Driver dashboard · Setări · Notificări); the staff panels are not designed, so use the driver panel style — [ST-198 In the mock; Screens] (2026-10-03)

## Open Decisions

- Who pays for the WhatsApp Business account behind Brevo beyond "MotorFix for now" — blocks: nothing in this story (cost only).
- E-mail sending domain not chosen (S10) — blocks: production e-mail, not this story's tests.
- DOCUMENT_OVERDUE counted as a yearly-document reminder, so un-mutable, is listed under "Readings to confirm" — blocks: the lock on DOCUMENT_OVERDUE (FR-006, FR-010).
- Retention of audit history and NOTIFICATION rows pending the lawyer (T10) — blocks: nothing here.
- ST-198 itself says "Open: None". Its "May a garage switch off new request messages" question is decided (2026-10-03).

## Contradictions with spec.md

- **spec.md** (2026-10-06T15:23Z) FR-008: "no call names another account ... the brief's 403 case cannot arise" — **Notion**: scenario 10 and the Build brief: another person's settings answer 403 for the garage's other staff, 404 outside the garage; A34 repeats the 403 rule [ST-198; A34] (2026-10-06T15:22Z) — newer: same date (spec is one minute later)
- **spec.md** FR-006: e-mail locked on for BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_CONFIRM_REMINDER, BOOKING_MOVE_LAPSED, FACILITY_REMOVED, DOCUMENT_* with "at least one channel" — **Notion**: the story's lock list names only verification results, DOCUMENT_*, BOOKING_MOVE_LAPSED (own lapsed time) and ADMIN_OUTAGE_ALERT; the catalogue gives "E always" only to verification types and FACILITY_REMOVED, and rule 6 lets the person change the channel of an always-sent type [MF-51 rule 6, catalogue] (2026-10-03) — newer: spec.md
- **spec.md** FR-004: REQUEST_REMINDER listed for nobody — **Notion** scenario 7 names REQUEST_REMINDER among a mechanic's types, while the same story's Rules say it has no switch (W17) [ST-198] (2026-10-06) — newer: same date; the story contradicts itself, spec follows the Rules

## Proposed Clarifications (this command's proposals, not requirements)

- Accept the deviation from scenario 10 (no 403 test, since no route names another account), or add an owner-facing route for it? — from contradiction 1 (A34 keeps 403 within a garage)
- Do the booking always-sent types (BOOKING_CANCELLED, BOOKING_LAPSED, BOOKING_CONFIRM_REMINDER, BOOKING_MOVE_LAPSED) lock e-mail like verification types, or use the "at least one channel stays on" rule of DOCUMENT_*? — from contradiction 2
- Is BOOKING_MOVE_LAPSED locked for both variants (the driver's request lapsed, the garage's proposed time lapsed) or only the garage's own, as the story says? — from the story's Rules
- Should a mechanic's list state REQUEST_REMINDER (scenario 7) or only the switch REQUEST_RECEIVED that governs it? — from contradiction 3
- Confirm the staff default "on, push if a subscription exists, else e-mail" against the store's send-time default "a missing row means on" — from the story's Rules (proposed)

## Gaps

- [NEEDS CLARIFICATION: owner of the staff Setări placement in the garage dashboard — not designed in mock v22; the spec moves the push panel from the home view (FR-011), which no Notion page states.]
- Status of ST-392 (WhatsApp, `whatsapp` GARAGE_FEATURE switch, owned by ST-396/398 per W12) not read; spec FR-002 relies on both.
- Data model page not opened; NOTIFICATION_PREFERENCE columns taken from the feature page's Data section.

## Sources

- ST-198 — https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78
- MF-51 Notifications and reminders — https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas / Open decisions — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d, https://app.notion.com/p/3ee607bff0d2817d95ebd3b142c1de11
