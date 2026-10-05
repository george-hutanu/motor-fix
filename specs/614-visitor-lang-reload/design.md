# Design: The visitor's language survives a reload at 320 px (ST-614)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr · Story: https://app.notion.com/p/3f0607bff0d281bb968ef54c590180fa

## Boards
- ST-614 is a bug filed by the PR tester on PR #99 (Issue type Bug, Role Visitor). It has no Build brief; its Design and Design boards roll up from EP-1 Foundations: Desktop (Cockpit) › Home, Mobile (Cockpit) › all nine mobile boards.
- [MOCK UNAVAILABLE: the artifact read answered "artifact not found" on 2026-10-05; retried on the next run.] The built Home (`apps/web/src/app/home/home.ts`) shows the RO/EN group (`mf-language-switch`, two 44 px buttons) in the header at every width, and `apps/web-e2e/src/language.spec.ts` already pins its look.

## What to build to match it
- No visual change. The fix is behavioural: a tap on EN that lands before the page has hydrated is no longer lost, so the chosen language is applied, moves the address to `/en` and survives a reload.

## States
- Tap after hydration: unchanged (English at once, `/en`, English after a reload).
- Tap before hydration (slow phone, cold load): today lost; after the fix replayed once the app hydrates.
- Storage blocked: unchanged (the address carries the language).
- Not designed: a loading indicator for the switch (none exists, none added).

## Mock vs Build brief
- None: no Build brief; the mock could not be read (above).
