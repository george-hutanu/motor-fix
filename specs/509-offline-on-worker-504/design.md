# Design: ST-509 Show the offline message when the service worker answers a failed fetch with 504
Checked: 2026-10-06 · Mock: not opened (no boards of its own) · Story: https://app.notion.com/p/3ef607bff0d281c497dadbe0862dbc54

## Boards
- None. The story is a Task (role System, epic EP-1 Foundations) filed as
  tech debt from ST-82's PR tester (PR #45, lap 2). Its `Design` and
  `Design boards` properties are rollups from the epic, not boards of its
  own, and its page has no Build brief and no Screens section; it has no
  comments.

## What to build to match it
- No screens: the story names none. The offline message and its placement in
  every task form and the sign-in dialog already exist (overlays 159-FR-008,
  accounts 082-FR-016) and were checked by their own stories; this task only
  changes which failed answer selects that message (`toProblem` in
  `libs/overlays/src/form.ts`). No text, component or phone behaviour changes.

## States
- Shown in the mock: none of this task's own.
- Not designed: none needed. The one observable change is that a form sent
  offline in the production build shows the existing offline message instead
  of the general one; both states are already designed.

## Mock vs Build brief
- No difference: neither names a screen for this task.
