# Design: ST-586 live e2e typed-text step
Checked: 2026-10-07 · Mock: not opened (Design rollup empty on the story; not needed, no screen changes) · Story: https://app.notion.com/p/3f0607bff0d28116812ce6dfd2ce06e1

No screens: the story is test-only (a Playwright step in `apps/web-e2e/src/live.spec.ts`). It types into the garage dashboard's existing "Invită în echipă" dialog while a live test update lands.

## Boards
- None named: the story's Design and Design boards properties carry no board.

## What to build to match it
- Nothing visual. The step drives the existing dialog and its text field as built; no layout, component or text change.

## States
- Shown in the mock: n/a.
- Not designed: none. The expectation (from the ST-256 Build brief) is that the live value changes while the dialog stays open and the typed text stays.

## Mock vs Build brief
- No difference to report.
