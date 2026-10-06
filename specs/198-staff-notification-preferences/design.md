[UNAVAILABLE: design mock — artifact EoPWH9MHmuY5Jfw7vTWTHr "not found — it may have been deleted, or it has not been shared with you" for this session's account]

# Design: Choose which messages I get as a garage, mechanic or admin (ST-198)
Checked: 2026-10-06 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, not opened) · Story: https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78

The story says "In the mock: Not shown. The mock has switches only for drivers", and the
Build brief's Screens section says the garage and admin Setări · Notificări are not designed.
The mock could not be read, so the driver's panel is described below from what the earlier
design checks recorded (ST-196, ST-197, ST-201, all read from mock v22) and from the Build
brief. Re-check against the mock when it is shared; the points marked (to confirm) are the ones
this session could not see.

## Boards
- Dashboards (Cockpit) › Dashboard · Driver (`DashClient.dc.html`, phone `MDashClient.dc.html`) › Setări:
  subtitle "Datele contului și notificările"; two sections, "Datele tale" and "Notificări".
  Notificări holds one switch per kind of message (four in the mock, five in the brief), with a
  small line under the label where one is needed (for example "Noutăți MotorFix" with "Cel mult
  un e-mail pe lună"). The driver's panel is not built in code yet (ST-138); it is the style reference.
- Garage dashboard › Setări › Notificări and Admin dashboard › Setări › Notificări: NOT designed in mock v22.
- Mechanics use the limited garage dashboard (W01); their settings are in its Setări, the same
  panel as the garage's with the types their permissions allow.

## What to build to match it
The staff panels are built in the driver's Setări style, as the Build brief says: the same Cockpit
card, section heading, row and switch pattern as ST-138's driver Notificări section, so the two
look like one family. Do not invent a new layout or component library; use the Spartan UI switch
(helm, `libs/ui-cockpit`) and Cockpit tokens.

What the driver panel looks like (from the earlier checks; to confirm in the mock):
- Setări view: title "Setări", subtitle "Datele contului și notificările", then sections each with
  a heading ("Datele tale", "Notificări") over a Cockpit card.
- A row = label on the left, switch on the right (one switch per kind); an optional smaller muted
  helper line under the label. Rows are separated inside the card (to confirm: divider vs gap, exact spacing).
- On a phone the same single column (MDashClient), no sideways scroll at 320 px.
- Locked / always-sent items: the mock's driver panel shows none that are described in earlier
  checks (to confirm). The staff locked state below is therefore built from the Build brief.

Staff panel (from the Build brief, each *(proposed)* detail flagged in the PR):
- Setări › Notificări lists the types the person's role and permissions can receive, grouped in
  sections "Cereri și oferte", "Programări", "Recenzii", "Cont și verificare" (proposed).
- One row per type; three switches per row: E-mail, Push, WhatsApp. No SMS for staff.
- Phone (320 and 390 px): the row stacks, type name (and helper line) on top, the three switches
  under it, each labelled; tablet and desktop: type name left, three labelled switches on the right
  (in columns with a column header row E-mail / Push / WhatsApp) (proposed).
- Locked on: VERIFICATION_RESULT, GARAGE_SUSPENDED, GARAGE_RESTORED: the E-mail switch is on and
  disabled with the line "Se trimite mereu"; Push and WhatsApp can be added. DOCUMENT_DUE and
  DOCUMENT_OVERDUE cannot be switched off entirely: at least one channel stays on (e-mail by
  default). BOOKING_MOVE_LAPSED (the garage's own proposed time) locked on (proposed). Admin:
  ADMIN_OUTAGE_ALERT locked on for push and e-mail.
- WhatsApp off for the garage: the WhatsApp switches are disabled with "WhatsApp este oprit
  pentru acest service" (proposed text). WhatsApp switches also need a verified phone (proposed).
- REQUEST_RECEIVED row also covers the day-2 and day-5 reminders; REQUEST_REMINDER has no row.
  A helper line says so (text to write, Romanian and English through the i18n catalogue).
- Mechanics: BOOKING_MOVED always; REQUEST_RECEIVED and MESSAGE_RECEIVED only with
  can_answer_quotes. DAY_SHEET types are not listed for a person; DAY_SHEET_OUTDATED and
  DAY_SHEET_NOT_SENT are hidden when the garage has day_sheets off.
- Admin dashboard: the "Admin list" types, in the same style.
- Switches save on toggle (optimistic); the switch reverts and a toast shows on failure.

Placement: the admin dashboard has a Setări view (placeholder today). The garage dashboard has
NO Setări view in code (`apps/web/src/app/dashboard/views.ts`: "the garage has no Setări yet"),
and ST-196 put its push panel on the garage home view. This story must add a Setări view to the
garage views (visible to owner, receptionist and the limited mechanic dashboard) or the brief's
"Setări · Notificări" has no place to sit; flag in the PR.

## States
- Shown in the mock: the driver panel's switches on and off (to confirm).
- Not designed (build from the Build brief, flag in the PR): loading (row skeletons); error (the
  panel shows "Reîncearcă"); a locked row; a disabled WhatsApp column; a failed save (revert and
  toast); an empty role list (no types for the person); a switch muted for the person only
  (receptionist) versus the owner's own; the other-tab live refresh.

## Mock vs Build brief
- Mock has switches only for drivers → the Build brief's staff panel, in the driver's style, wins.
- Brief says Setări · Notificări in the garage dashboard; the app's garage dashboard has no Setări
  view yet → add one (decision for the owner, recorded in the PR).
- The driver panel in the mock could not be opened this run → its details above are second-hand;
  compare the built staff panel with the mock board when it is shared.
