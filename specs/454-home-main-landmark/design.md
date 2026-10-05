# Design: Give the home page its landmarks
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22) · Story: https://app.notion.com/p/3ef607bff0d28150a4b9d50fbc0092b5

## Boards
- Mobile › Mobile · Home (`MHome`) and the desktop Home board: a top bar (brand, sign-in on desktop), the page content, and on phones the fixed bottom tab bar (as recorded in `specs/286-phone-layout/design.md` and `specs/287-*`). The mock opened; the story is a tech-debt task with no board of its own (its Design rollups are the epic's).

## What to build to match it
- Nothing visual. The change is semantic only: the public frame's top bar becomes a banner landmark (`<header>`), the page content stays in the frame's one `<main>`, the tab bar stays a `<nav>`. Layout, spacing, texts (RO/EN) and phone behaviour are unchanged.

## States
- Shown in the mock: phone 390 px and desktop, dark.
- Not designed (build from the finding, flag in the PR): no new state — the server-rendered `/` before the browser moves it to `/<lang>` must carry the same landmarks.

## Mock vs Build brief
- No difference: the task's brief is the axe finding (landmark-one-main, region); the mock has no landmark annotations.
