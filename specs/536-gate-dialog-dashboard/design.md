# Design check — 536-gate-dialog-dashboard

- Sources: ST-536 (Notion, 2026-10-07): Design and Design boards are rollups that resolve to nothing for this tech-debt task; the parent ST-130's check (`specs/130-sign-in-gate/design.md`, mock v22) reads the `auth` overlay over the current screen and notes no board for the screen behind it.
- Screens: none new. The dashboard frame (`mf-frame`: aside with logo, area tag, menu, role chips, name, sign-outs; the phone tab bar) as built by ST-130's predecessors, behind the sign-in dialog.
- Change: behind the gate dialog the frame keeps the account it showed (name, chips, menu) until the dialog closes; layout, texts and sizes unchanged.
- Not designed: the screen behind the dialog; built so it does not change while the dialog is over it.
- Mock: not opened — no boards linked to the task, and nothing visual changes.
