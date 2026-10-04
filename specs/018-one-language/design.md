# Design: Read every screen in one language, with user text as written (ST-18)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d28104acfbf6d2ef09ee7a

[UNAVAILABLE: design mock — the read returned only the canvas loader ("Design · Loading…"); the boards render client-side and are not in the fetched HTML. The ST-286 design.md (same mock version, read from `canvas.json`) is used for the mobile boards.]

## Boards
- No board of its own. Story note "In the mock": every screen, in both
  languages; the mock was checked at 320 px wide. Build brief › Screens: "Every
  board, in both languages".
- Of the boards, the app today has Home (`/ro`, `/en`), the cockpit sample
  (`/cockpit`) and the empty frame of the driver, garage and admin dashboards.
  Results, Garage profile, reviews and captions are not built yet.
- Mobile · Results (from ST-286's design.md): tab labels 11 px — the Build brief
  and the decision of 2026-10-03 set 12 px as the floor.

## What to build to match it
- No visual change. Every existing screen keeps its look; what changes is
  invisible on a wide screen:
  - Romanian words with a hyphen ("service-ul", "Service-uri", "s-a") use a
    non-breaking hyphen, so they never break at the hyphen on a phone.
  - Text people wrote and names go through one display that shows them as
    written and tells the browser not to translate them; today that is the
    signed-in name in the dashboard frame.
  - A catalogue name helper for the screens that list job types and car systems
    later.
- Phone behaviour: at 320 px, in Romanian and English, every screen wraps its
  longest text with no sideways scroll and nothing under 12 px.

## States
- Shown in the mock: none specific to this story.
- Not designed (build from the Build brief, flag in the PR): how a review in
  the other language is marked — the brief says shown as written with no
  translate button, so nothing is added; a catalogue item with no English name
  (shows the Romanian name, the app's existing fallback).

## Mock vs Build brief
- Tab labels 11 px on the mobile results board → 12 px (Build brief scenario 6,
  decision 2026-10-03). No tab bar exists yet; ST-286's phone check already
  holds the floor and this story runs it in English too.
- The mock writes "service-ul" with a plain hyphen → the Build brief's proposed
  non-breaking hyphen wins (it is newer and it is this story's scope).
