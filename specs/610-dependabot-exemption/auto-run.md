# Auto run — 610-dependabot-exemption

Level 1 (one-session). ST-610. Start commit 2070355 (origin/main).

- **Ownership**: no `610` branch, no `.worktrees/610-*`, watch.mjs listed no holder.
- **Size**: level 1 — classifier unsure ("and"); two LOW findings in two hooks, intent fully stated by the task, one session.
- **Notion**: ST-610 To do → Planning, Ready to work unticked; Foundations timeline row created (3f1607bff0d281fc9836ef1626b4e2ff) → Planning; EP-1 already In progress. Connector path (no NOTION_TOKEN).
- **Verify**: confirmed — `isDependabot` reads authors only (`pr-lifecycle-gate.mjs:74`); `gh pr view --json commits` has no committer; real Dependabot commit 46aaf57 (PR #99) is committer `web-flow`, verified `valid`.
- **Specify**: spec.md (FR-001–FR-003, Spec Delta), tasks.md (T001–T009). No screens (design.md).
