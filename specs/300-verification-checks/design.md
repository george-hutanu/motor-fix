# Design: ST-300 Store each file's checks and their results

[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr answered "artifact not found" (not shared with this account); boards read from Notion's text only]

Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, not opened) · Story: https://www.notion.so/3ee607bff0d281eb88ffff1135141301 · Epic: https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf

No screens: the Build brief's Screens section says none ("None of its own. The lamps and summary appear in the queue and the file, DashAdmin.dc.html and MDashAdmin.dc.html"). The story is the store (one check per kind, the record call, the lamp colours and the one-line summary); the screens that show them belong to the queue and file stories.

## Boards

From the epic's Design table and the story's Screens section (the mock itself could not be opened):

- Dashboards (Cockpit) › Dashboard · Admin (DashAdmin.dc.html): Service-uri de verificat — one queue line per file with a lamp per check and one short summary; the drawer "Dosar de verificare" with the sample results (per MF-58, "In the mock today": sample results, no register queried).
- Mobile (Cockpit) › Mobile · Admin dashboard (MDashAdmin.dc.html): the same queue and drawer on a phone.

## What to build to match it

- No layout or component here. What the boards consume, built by this story and reused by the queue and file stories:
  - the lamp per check: `ok` green, `warning` amber, `failed` red, `not_run` grey;
  - the summary line in Romanian (and English), at most two parts joined with " · ": "CUI verificat", "Autorizație RAR verificată", "CUI și autorizație RAR verificate", "Lipsește autorizația RAR", "<kind name> <detail>" (e.g. "fotografii neclare"), "Neverificat";
  - the detail line the admin typed, at most 200 characters, shown as typed.

## States

- Shown in the mock (per Notion): the drawer with sample results per check; the queue line with lamps and a summary.
- Not designed (build from the Build brief, flag in the PR): the 8 `not_run` grey lamps of a file just sent ("Neverificat"); a `more_requested` file's lamps after a resend (results kept); the error answers of the record call (404, 409 "Dosarul e deja decis", 422, 400) — API only, no screen.

## Mock vs Build brief

- Nothing can be compared until the mock is shared with this account; the Build brief (2026-10-03) and the spec's Clarifications fix the texts. Re-run the check before `/speckit-implement` once it is shared.
