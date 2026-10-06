# auto-run: 602-watcher-counts-qa-runs

Input: ST-602 "Make the watcher count PR QA runs on GitHub Actions". Start commit: origin/main b27b5e6b. Worktree .worktrees/602-watcher-counts-qa-runs.

## 0. Size
- level.mjs suggest ST-602: level 2 (boards rollup 1, no brief). Kept at 2.

## Preflight
- typecheck, lint, unit and harness green; integration specs need DATABASE_URL (not set in this worktree), not a code failure.
- Phases run inline in this session (orchestrator: token economy), not as phase agents: logged pin miss for 2, 5, 6, 7.

## 2. Specify
- spec.md written from the story; 4 clarifications answered (autonomous default, evidence pr-qa.yml:56, watch.mjs:192-205).
