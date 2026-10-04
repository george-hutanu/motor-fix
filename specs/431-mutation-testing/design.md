# Design: Set up mutation testing across every app and lib in the monorepo
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (rolled up from EP-1; not opened — no board applies) · Story: https://app.notion.com/p/3ef607bff0d28172bf64e2e2cdb952f4

No screens: the Build brief's Screens section says none ("### Screens — None"), and the story is build tooling ("Who can do it: no person; build tooling only").

## Boards
- None. The `Design` and `Design boards` properties roll up from EP-1 Foundations; none of its boards (sign-in, home, mobile, dashboards) shows anything this story produces.

## Where the result shows
- The CI job summary on a pull request: one mutation score line per project that ran.
- The terminal output of `nx run <project>:test:mutation` and the Stryker HTML report under `reports/`.

## States
- Shown in the mock: none.
- From the Build brief (no design): a project with no tests is skipped with a clear message; a run below its floor exits non-zero; a run that times out in CI fails and names the project.

## Mock vs Build brief
- No difference: the mock does not cover this story.
