# Auto run — 470-chart-reduced-motion

- Description (user): fix Notion task ST-470 — the charts read `matchMedia('(prefers-reduced-motion: reduce)')` once per redraw instead of the shared `REDUCED_MOTION` signal; take it through the whole PR lifecycle.
- Mode: agent worktree `.claude/worktrees/agent-a01da58b9f0d31aa3`, based on `origin/main` b76ea92; its own `npm ci` (no symlink).
- Start commit: b76ea92

## 0. Size

- Level 1 (one-session): the task sets the intent fully (what changes, the tests, what must not change). Phases 2, 7, 9, 10, 12, 14, 16 plus hand-off.

## 2. Specify

- Branch `470-chart-reduced-motion` (story-numbered). Capability `cockpit-charts`.
- Autonomous answers (spec Clarifications): jump to the end on switch-on (ST-53 design States); no replay on switch-off; unit test on the component, not the page (owner instruction).
