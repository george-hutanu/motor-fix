# Design: Sign out, on this device or on all devices (ST-128)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22; the dashboard boards as recorded today in `specs/288-dashboard-tab-bar/design.md`) · Story: https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7

## Boards
- Dashboards (Cockpit) › Dashboard · Driver, Dashboard · Garage, Dashboard · Admin,
  Dashboard · Mechanic: the 252 px side menu (`aside.mf-side`) ends with the
  avatar, the name and "Ieși din cont" at the bottom.
- Mobile (Cockpit) › the mobile dashboard boards: the side menu is hidden and
  there are no account controls (ST-288 kept the aside's account block on top as
  the account band, with "Ieși din cont").
- "Ieși de pe toate dispozitivele" is on no board (Build brief, Screens: not designed).

## What to build to match it
- "Ieși din cont" stays where ST-82/ST-288 put it: the frame's `.account` block,
  bottom of the aside on a desktop, the account band on a phone.
- "Ieși de pe toate dispozitivele" directly under it, the same quiet text-button
  style, in the same block, so a phone gets it in the account band too.
- The confirmation is the shared overlay (`Overlays.open`, shape `dialog`; a
  bottom sheet on a phone): title "Ieși de pe toate dispozitivele?", the line
  "Va trebui să te autentifici din nou peste tot.", the primary "Ieși" and the
  secondary "Renunță" (Build brief, Rules, *(proposed)*). Cockpit tokens only.
- After either sign-out: Home, signed out.

## States
- Shown in the mock: the menu with "Ieși din cont".
- Not designed (build from the Build brief, flag in the PR): the "all devices"
  action and its confirmation; the other tabs and devices going to Home; the
  offline sign-out.

## Mock vs Build brief
- The Build brief proposes the "all devices" row in Setări' account section for
  every role; the garage and mechanic dashboards have no Setări view and the
  existing ones are placeholders → built in the account block under "Ieși din
  cont" (spec Clarifications Q1); recorded as a decision for the owner.
