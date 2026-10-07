# Feature Context: Typed-text step in the live end-to-end test

- **Feature**: 586-live-e2e-typed-text
- **Anchor**: ST-586 "Tech debt (ST-256): add the typed-text step to the live end-to-end test with the first live form dialog" — https://app.notion.com/p/3f0607bff0d28116812ce6dfd2ce06e1
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature not read (live-updates page only located) | epic not read (fetch of the epic URL refused: "URL type webpage not currently supported") | architecture not read (test-only change) | decisions not read
- **Overall confidence**: medium (story, origin story and ST-131 read in full; epic, feature page and decisions skipped as not bearing on a test-only task)

## Story

- **ST-586 Tech debt (ST-256)** — status Planning, priority Medium, role System, type Task, PR https://github.com/george-hutanu/motor-fix/pull/204, epic EP-1 (relation), feature "Live updates between screens"
- Scope per the story: fix the spec-reviewer deferral: the Build brief check "open a dialog, type text, send the test update; the value changes and the dialog and text stay" needs a dashboard dialog with a text field; "add the typed-text step with the first live form dialog". Where: `apps/web-e2e/src/live.spec.ts:9`, severity medium, found by spec-reviewer in PR #79.
- Comments that moved scope: none (page has no comments; last edited 2026-10-07).

## Decisions

- ST-256's own acceptance criteria require the test update to change one value and "leave an open dialog and its typed text as they were"; its Build brief rule: never reload, change route, close a dialog or move focus because of a live update — [ST-256 "See live updates in place without losing my work", Acceptance criteria, Rules] (2026-10-05, high)
- ST-256 Build brief's end-to-end test is exactly the one this task adds: "open a dialog, type text, send the test update from another context; the value changes and the dialog and text stay" — [ST-256, Tests] (2026-10-05, high)
- Live updates raise no toasts; the ST-253 test toast became a status line under each dashboard header, e2e text unchanged — [ST-256 finish comment, Deviations (1)] (2026-10-05, high)
- ST-256's finish comment records the typed-dialog e2e as deferred to this task (component tests cover it meanwhile) — [ST-256 finish comment] (2026-10-05, high)

## Constraints

- Only the garage owner of that garage can send an invite; the "Invită în echipă" dialog is a minimal dialog on the garage dashboard frame, marked *(proposed)* and not in the mock — [ST-131 "Invite a mechanic or receptionist…", Scope, Screens] (2026-10-06, high)
- The dialog is a real invite form: submitting stores a STAFF_INVITE and sends an e-mail, so the check must not submit — [ST-131, Acceptance scenario 1, Data] (2026-10-06, high)
- Mechanic invites are not offered when the garage has "team and mechanics" off (scenario 8); the seeded garage is assumed to have it on — [ST-131, scenario 8] (2026-10-06, medium)

## Prior Art

- ST-256 (Done, PR #79): built the live library and the status-line test update; its component test in `frame.spec.ts` proves the typed-text case today — [ST-256 finish comment] (2026-10-05)
- ST-131 (Done, PR #152, merged 2026-10-06): shipped the "Invită în echipă" dialog; its five filed debts include the "Mecanic" option shown before the feature flag is known and an adversary spec duplicating the dialog harness (open, settle, field, fill) from `invite-staff.spec.ts`, to move into `invite-staff.testing.ts` — [ST-131 finish comment; ST-131 debt tasks (search)] (2026-10-06)
- Sibling debts from ST-256, not this task: list scroll and pill e2e (https://app.notion.com/p/3f0607bff0d281cab9d7cc0f31ca0c08), show the changed/gone texts on the first live form (https://app.notion.com/p/3f0607bff0d2817d8635f57addb49c88), status line flush against the RO/EN switch (https://app.notion.com/p/3f0607bff0d28119a01dcc35cb598b6e)

## Open Decisions

- none found (ST-256 Build brief "Open: None"; ST-131's one open item, the pending-move timeout, does not touch this task)

## Contradictions with spec.md

- none found. spec.md matches the story: test-only, first form dialog, no submit. Its premise that "Invită în echipă" exists with "Nume" and "E‑mail" fields is consistent with ST-131 (field labels not verified in Notion; they live in the code).

## Proposed Clarifications (this command's proposals, not requirements)

- Reuse the dialog open/field helpers from `invite-staff.spec.ts` rather than copying them, since a sibling debt already flags the duplicated harness — from ST-131 debt tasks
- Cancel the dialog or close the context at the end, never submit (the dialog sends a real e-mail on submit) — from ST-131 scenario 1

## Gaps

- The Live updates feature page, the EP-1 epic page and the open-decisions page were not read; nothing found in the story pages suggests they change a test-only task.

## Sources

- Tech debt (ST-256) ST-586 — https://app.notion.com/p/3f0607bff0d28116812ce6dfd2ce06e1
- See live updates in place without losing my work (ST-256) and its finish comment — https://app.notion.com/p/3ee607bff0d281a39af4f03b587eb2ae
- Invite a mechanic or receptionist to an account in my garage (ST-131) and its finish comment — https://app.notion.com/p/3ee607bff0d281f3aa26ca1f287f6138
- Live updates between screens (located, not read) — https://app.notion.com/p/3ee607bff0d281de9544d2b4e8331043
