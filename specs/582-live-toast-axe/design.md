# Design: Fix the live toast's axe findings (ST-582)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22) · Story: https://app.notion.com/p/3f0607bff0d281abbe99d98e58a87bd3

[UNAVAILABLE: design mock — artifact not found / not shared with this session's account]

No screens: a Tech debt task with no Build brief; its Design and Design boards
roll up from EP-1 (Foundations) and none of them is about the toast. The toast
is the shared kit toast (`HlmToaster` / `toast` in `libs/ui-cockpit`, Spartan
sonner coloured by `cockpit.css` through `spartan-toast`), mounted in the
dashboard frame and on the /cockpit sample page.

## Boards
- None for the toast. ST-253's design check (specs/253-live-connection/design.md)
  read the same mock: neither dashboard board contains a toast; the toast's
  place and duration are sonner's defaults.

## What to build to match it
- Nothing visible changes: same place, colours, text, timing and close button.
- Only the toast stack's ARIA roles change, so axe passes and each toast is
  still announced (aria-live polite, assertive when important, aria-atomic).

## States
- Shown in the mock: none.
- Not designed: the toast itself (sonner's defaults, unchanged here).

## Mock vs Build brief
- No Build brief for this task; the finding (PR #77 QA lap 2) is the brief.
