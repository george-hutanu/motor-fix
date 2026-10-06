# Design: A late "who am I" answer never puts the old role back (ST-564)
Checked: 2026-10-06 · Story: https://app.notion.com/p/3f0607bff0d281cb8b9ad4180f54e7e4

## Boards
- ST-564 is a tech-debt task filed by the PR tester on PR #71 (Issue type Task, Role System). It has no Build brief and no Screens section; its Design and Design boards only roll up from EP-1 Foundations, none of them about this change.

## What to build to match it
- No visual change. The fix is in the web session's state (`apps/web/src/app/dashboard/session.ts`): a late answer to the account re-read no longer replaces the account the tab switched to. The dashboard, the role chip and the e-mail banner render as before.

## States
- Reload answers before a role switch: unchanged.
- Reload answers after a role switch: today the old role's account comes back; after the fix the switched role's account stays.
- Not designed: nothing new is shown.

## Mock vs Build brief
- None: no Build brief, and the story has no screens.
