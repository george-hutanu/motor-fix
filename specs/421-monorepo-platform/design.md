# Design: ST-421 Set up the monorepo, staging and production on Railway, and the release pipeline
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (rolled up from EP-1; not opened, see below) · Story: https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58

## Boards
- None. The story's `Design boards` roll up from the Foundations epic (sign-in dialog, Home, mobile boards, driver dashboard). They belong to the epic's later stories (ST-82, ST-16, ST-286 and others), not to this task.

## What to build to match it
- No screens: the Build brief's Screens section says none apart from a temporary skeleton page at `/`.
- Skeleton page: the name MotorFix, the deployed version, and the line "PostgreSQL: ok · Redis: ok". The Build brief: "Not designed, and not in the App Mock; it is removed when Home is built [ST-225]." Plain markup, no Cockpit theme (ST-50 builds the theme).

## States
- Shown in the mock: none.
- Not designed (built from the Build brief, flagged in the PR): the skeleton page when a check fails ("PostgreSQL: error" or "Redis: error"), and while the status loads.

## Mock vs Build brief
- No difference: the mock has no board for this page. The mock was not opened because no board applies to this story.
