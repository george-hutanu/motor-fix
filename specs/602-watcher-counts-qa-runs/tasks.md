# Tasks: 602-watcher-counts-qa-runs

## Phase 1: Tests (red first)

- [X] T001 Add `actionsQaRuns` unit tests (in-flight statuses kept, `completed` and unnamed runs dropped, PR parsed) in `.claude/scripts/watch.spec.mjs` (FR-001)
- [X] T002 Add `collect` scenario tests: in-flight Actions run holds a quiet ready PR and keeps it out of the plan; completed run → `rerun-qa`; handed-off row stays `waiting`; Actions runs fill the QA cap; failing reader → no Actions runs, in `.claude/scripts/watch.spec.mjs` (FR-002, FR-003, FR-004)

## Phase 2: Implementation

- [X] T003 Add `actionsQaRuns` and the default `actionsRuns` reader, and count them in `collect`'s `qaRuns` and per-row `qaLive`, in `.claude/scripts/watch.mjs` (FR-001–FR-004)
- [X] T004 Update the watch description in `.claude/skills/speckit-watch/SKILL.md` where it says how QA runs are counted, if it does
