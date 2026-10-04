# Design: Keep my language on my account for messages (ST-20)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375, `project/Main.dc.html`) · Story: https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117

## Boards
- Desktop (Cockpit) › Home (`Main.dc.html`): the header's RO / EN switch, a
  pill group of two 44×44 px buttons with `aria-pressed`. A tap writes
  `localStorage['mf-lang']` (errors swallowed) and re-renders every text in
  place. Nothing else happens: the mock has no accounts, no save, no toast and
  no error for the language.
- The same switch sits in the header of the dashboards and the mobile boards
  (ST-17's design check, `specs/017-language-switch/design.md`). The epic's
  `Design boards` add Sign in · dialog, Mobile · Sign-in sheet and
  Dashboard · Driver; none of them shows a language setting.

## What to build to match it
- No visual change. The switch already built by ST-17 (`libs/i18n/src/switch.ts`)
  keeps its look, its texts and its behaviour; the only new behaviour is
  invisible: while signed in, a tap also saves the language on the account.
- No separate language setting (Build brief › Screens: "there is no separate
  language setting in the mock").

## States
- Shown in the mock: Romanian and English, switched live; the current button
  pressed.
- Not designed (build from the Build brief, flag in the PR): saving the
  language fails → the interface still switches and no error is shown, the
  save is retried at the next change; signed out → device only; signed in on a
  new device → the account's language wins.

## Mock vs Build brief
- The mock keeps the language per device only, with no accounts → the Build
  brief wins: signed in, the choice is saved on the account as well.
- Error colour (`--mf-red-ink`) and Romanian texts: not used, since the save
  failure shows nothing.
