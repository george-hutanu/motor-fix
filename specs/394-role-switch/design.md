# Design: Switch between my driver and garage roles in one account (ST-394)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr · Story: https://app.notion.com/p/3ee607bff0d281029850d5192fa1e164

[MOCK PARTIAL: the artifact's canvas loads its boards by script; the static read returns only the loader. The dashboard boards are taken from what earlier runs recorded (`specs/288-dashboard-tab-bar/design.md`, `specs/128-sign-out/design.md`, `specs/079-account-model/design.md`) and from the Build brief's Screens section.]

## Boards
- Dashboards (Cockpit) › Dashboard · Driver, Dashboard · Garage: the side menu
  ends with the account block (avatar, name, "Ieși din cont"). The mock's
  "Vezi ca" chips Șofer, Service, Mecanic, Admin jump between all four roles for
  the demo (Build brief, Screens; ST-79 kept them out as demo-only).
- Mobile (Cockpit): no side menu; the account block is the account band on top
  (ST-288). The Build brief puts the chips "in the account menu of the mobile
  dashboards" *(proposed)*.
- "Adaugă o mașină" in the account menu of a garage-only account: not designed
  (and out of this PR, spec Clarifications Q2).

## What to build to match it
- A row of chips in the frame's `.account` block, above the name, only when
  the account holds two or more roles: "Șofer", "Service", "Recepție",
  "Mecanic", "Admin", in that order, only the account's own roles.
- The chip of the role in use pressed (`aria-pressed="true"`, amber ink like the
  menu's current link); the others quiet. Cockpit tokens only, 44 px touch
  height, wrapping at 320 px.
- Same block on a phone, so the account band carries them.

## States
- Shown in the mock: the chips (demo).
- Not designed (build from the Build brief, flag in the PR): a switch in
  progress (chips disabled), the failure toast, one-role accounts (no chips).

## Mock vs Build brief
- The mock's chips show all four roles for every viewer (demo); the Build brief
  shows only the account's own roles → Build brief wins.
