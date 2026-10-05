# Design check — 659-merge-gate-carry-deadline

Story: ST-659 https://app.notion.com/p/3f0607bff0d2816aa0f1e3c59c556c73 (Tech debt, Role System, epic Foundations). Checked 2026-10-05.

No screens: the task has no Build brief Screens section, and its `Design` and `Design boards` rollups are empty. The change is in the harness's merge gate (`.claude/hooks/`), its carry check (`.claude/scripts/pr-test/carry.mjs`) and the hook wiring; nothing in `apps/web` or `libs/ui-cockpit` changes, and no screen shows its result.
