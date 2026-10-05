# Tasks: split speckit-auto (ST-704)

- [X] T001 Write the rule-inventory spec `.claude/skills/speckit-auto/layout.spec.mjs` (FR-003, FR-004), red
- [X] T002 Fix the stale text in SKILL.md: app names, tracked `specs/`, CI-only mutation, `biome.jsonc`, story id, Notion connector (FR-005)
- [X] T003 Write the section → file map in plan.md
- [ ] T004 Wait until #141 and #144 are merged or no longer touch SKILL.md, then merge `origin/main`
- [ ] T005 Move the sections into preflight.md, phases-plan.md, phases-build.md, phases-close.md, commit-protocol.md, hand-off.md, tail.md and report.md; shrink SKILL.md to the run order (FR-001, FR-002)
- [ ] T006 Retarget tail-handoff-wiring, task-runner and lifecycle-wiring specs (and #144's phase-dispatch) to the new files (FR-004)
- [ ] T007 Refresh `GATES` in layout.spec.mjs from the merged specs; `npm run test:harness` green (SC-002)
- [ ] T008 Measure with `wc -c` and record the before, after, typical-run and tail bytes in auto-run.md and the PR body (FR-006, SC-001)
