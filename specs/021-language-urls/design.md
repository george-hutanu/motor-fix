# Design: Give each language its own web address for search engines (ST-21)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2

[UNAVAILABLE: design mock — the read returned only the canvas loader ("Design · Loading…"); the boards render client-side and are not in the fetched HTML. The ST-17 design.md (same mock version) is used for the Home board.]

## Boards
- No board of its own: the Build brief's Screens section says it "applies to
  Home, Results + map, Garage profile and List your garage, desktop and mobile".
  Of those, only Home (the skeleton page) exists in the app.
- Desktop (Cockpit) › Home (from ST-17's design.md): the RO / EN switch in the
  header; every text re-renders in place on a switch.
- Story note "In the mock": "Each screen has one address. The language is a
  setting kept in the browser." The mock has no per-language address; that is
  this story's addition.

## What to build to match it
- No visual change. The switch looks and behaves as ST-17 built it; the address
  bar now shows `/ro/…` or `/en/…` and changes with the switch.
- The not-found page (brief › States and errors, *(proposed)*) is not designed:
  a heading, one line and a link to Home, with shell keys in both languages,
  no styling beyond the shell's.

## States
- Shown in the mock: none for addresses.
- Not designed (build from the Build brief, flag in the PR): the not-found page
  for an unknown address; the `noindex` signals are not visible.

## Mock vs Build brief
- The mock keeps one address per screen; the Build brief gives each language its
  own → the Build brief wins (newer, and it is this story's scope).
