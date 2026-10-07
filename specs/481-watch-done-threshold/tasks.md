# Tasks - 481-watch-done-threshold

- [x] T001 Red: .claude/scripts/watch.spec.mjs covers FR-001 (`DEFAULT_THRESHOLDS.done` is 30; `parseStale(['done=5'])` sets it), FR-002 (merged clean unheld row quiet 5 min: done, no fix, reason with quiet and threshold; quiet 120 min: `remove-worktree`; `done=0` removes at once), FR-003 (collect: merged worktree with a live-session `claude agent` lock and activity 5 min ago is held live, not removed), FR-004 (`--gate` silent for a just-merged clean worktree); existing removal fixtures made quiet past the threshold.
- [ ] T002 Green: watch.mjs `DEFAULT_THRESHOLDS.done = 30` and the quiet check in `fixOf`'s done branch.
- [ ] T003 Verify: `npm run test:harness`, `node .claude/scripts/doctor.mjs`, `node .claude/scripts/harness-eval.mjs --check`.
