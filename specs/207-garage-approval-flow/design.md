# Design: ST-207 Keep garages hidden until approved, with a status flow

[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr answered "artifact not found" (not shared with this account); boards read from Notion's text only]

Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, not opened) · Story: https://app.notion.com/p/3ee607bff0d2818b8b02f41b122c27f6 · Epic: https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf

No screens: the Build brief's Screens section says none. The story is the verification state machine, the `publicGarages()` scope and the shared status labels; the screens that show them belong to other stories.

## Boards

From the epic's Design table and the story's Screens section (the mock itself could not be opened):

- Desktop (Cockpit) › List your garage (ListGarage.dc.html): the six steps; after sending, the preview state "Ciornă · se publică după verificare" and the stages "Trimis", "În verificare", "Aprobat, pe hartă".
- Mobile (Cockpit) › Mobile · List your garage (MList.dc.html): the same form and stages on a phone.
- Dashboards (Cockpit) › Dashboard · Admin (DashAdmin.dc.html): Service-uri de verificat, the drawer Dosar de verificare; the decision shown on the admin's row: "Aprobat, e pe hartă", "Cerute completări", "Respins".
- Mobile (Cockpit) › Mobile · Admin dashboard: the admin dashboard on a phone.

## What to build to match it

- No layout or component here. The shared status labels (Romanian, English) in the forms the boards use: "Ciornă" (draft, with the preview line "se publică după verificare"), "Trimis", "În verificare", "Cerute completări", "Respins", "Aprobat, pe hartă" (the admin row says "Aprobat, e pe hartă"), "Suspendat"; the unpublished states carry "· nepublicat".
- The screens that show them (ST-116 sending, ST-206 status after sending, ST-300/ST-302 admin queue and file, ST-303 to ST-305 decisions) read the label from this story's derived status, never their own copy.

## States

- Shown in the mock (per Notion): Ciornă (preview), Trimis, În verificare, Aprobat, pe hartă; on the admin row Aprobat, e pe hartă, Cerute completări, Respins.
- Not designed (build from the Build brief, flag in the PR): Suspendat (MF-59), the 404 page for a hidden garage's link (the "no longer available" page is ST-?'s, Build brief scenario 8), the reopened-file state (the garage stays "Aprobat, pe hartă").

## Mock vs Build brief

- The admin row says "Aprobat, e pe hartă" while the garage's label is "Aprobat, pe hartă": the Build brief's label table wins for the shared label; the admin screen story may keep its own wording.
- No other difference can be checked until the mock is shared with this account; re-run the check before `/speckit-plan` and `/speckit-implement` once it is.
