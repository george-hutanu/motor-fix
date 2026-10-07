[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr: "artifact not found — it may have been deleted, or it has not been shared with you"]

# Design: ST-491 Back closes the open task and keeps the page
Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, not opened this run) · Story: https://app.notion.com/p/3ef607bff0d281368c38d78fcc7b10ff

The task's `Design` and `Design boards` roll up from EP-1 (the same mock and the Overlays boards ST-157 read). This task adds no screen: it changes what the browser's Back button does while a task is open. The rest is filled from Notion's text and from `specs/157-dialog-drawer/design.md` (checked 2026-10-04 against mock v22).

## Boards
- Overlays › shell, dialog, drawer, phone sheet: unchanged by this task (see `specs/157-dialog-drawer/design.md`).
- Back closing the task: listed by ST-157's design check under "Not designed"; the Build brief's scenario 8 *(proposed)* is the only source.

## What to build to match it
- No layout, component, text or motion change. Back is a fourth way to close a task, behaving as the X does (including the discard question).

## States
- Shown in the mock: none for Back.
- Not designed (build from the Build brief, flag in the PR): Back closing the top task with the page kept; Back on a changed task showing the discard question.

## Mock vs Build brief
- None: the mock does not show Back. The Build brief's scenario 8 wins.
