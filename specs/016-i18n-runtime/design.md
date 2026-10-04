# Design: Set up translation files and runtime language switching (ST-16)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281c3927ec1b8e980be00

ST-16 is a system task: it builds the translation runtime, not a screen. The
boards below show what that runtime must make possible.

## Boards
- Desktop (Cockpit) › Home (`project/Main.dc.html`): header with brand, nav
  links, a `role="group"` labelled "Limbă"/"Language" holding two 44×44 buttons
  RO and EN (`aria-pressed`, aria-labels "Română" / "English"; active one amber
  #FFB000 on #0B0C0E, inactive #C9CBD0 on transparent, Michroma 10px). Every
  text on the board is a `[ro, en]` pair keyed `k0…k162`; switching re-renders in
  place, no reload.
- The same switch sits in the header of Results + map, Garage profile, the
  dashboards and the dialogs in Overlays.dc.html (Build brief › Screens).

## What to build to match it
- The runtime the switch drives: a current language (`ro` default), a call to
  set it, and every text bound to a key so a change re-renders in place.
- `<html lang>` follows the current language (the mock board keeps `lang="en"`
  static; the brief asks for it to change).
- The switch control itself, its styling and remembering the choice
  (the mock uses localStorage `mf-lang` and syncs tabs) are ST-17, not built here.
- The skeleton page that exists today (brand, version, health line) takes its
  texts from the shell area's keys.

## States
- Shown in the mock: Romanian (default) and English, switched live.
- Not designed (build from the Build brief, flag in the PR): a text missing in
  English (shows Romanian), a text file that fails to load (shows Romanian),
  counted texts (ICU plurals, "1 service / 3 service-uri / 48 de service-uri").

## Mock vs Build brief
- The mock's dictionary is one flat `k0…k162` table for the whole board; the
  brief wants English dotted keys per area and screen (`auth.signIn.title`), one
  file pair per area → the Build brief wins.
- The mock glues sentences from pieces (`k6` "la" / "for your" between other
  texts); the brief says sentences are never glued → the Build brief wins; later
  screens use whole sentences with parameters.
- The mock remembers the language in localStorage; the brief puts remembering in
  ST-17 → out of scope here.
