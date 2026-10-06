# Design check — 610-dependabot-exemption

Story: ST-610 https://app.notion.com/p/3f0607bff0d281d6ab62d7fd978b5e01 (Task, Role System, epic Foundations). Checked 2026-10-06.

No screens: the task has no Build brief Screens section, and its `Design` and `Design boards` rollups are empty. The change is in the harness's merge and Stop gates (`.claude/hooks/merge-gate.mjs`, `.claude/hooks/pr-lifecycle-gate.mjs`); nothing in `apps/web` or `libs/ui-cockpit` changes, and no screen shows its result.
