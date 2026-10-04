# Auto run — 436-docs-only-ci

- Description: CI skips unnecessary jobs on documentation-only PRs; create the Notion task first.
- Start commit: e68eb58 (origin/main), branch `436-docs-only-ci`, own worktree.
- Notion: ST-436 https://app.notion.com/p/3ef607bff0d281aabbd3f7430ecaac0c

## Decisions

- Tree: only `.claude/.spec-drift-state.json` modified, written by the spec-drift gate itself (not user work); carried, not a Hard Stop.
- Story: none existed; created ST-436 under EP-1 Foundations, filed like ST-435 (Task, System, Medium, 2 points).
- Size: level 1. The story states done, out of scope and proof; no product call open. Phases: specify (written from the story), tasks, tests, implement, harden, review, retro evidence.
- Preflight full suite not run locally (laptop RAM rules: targeted checks only); main green at its last merge (#18), this PR's CI is the full-suite proof.
- Detector: a tested Node script, no third-party path-filter action (same pattern as pr-body-check.ts).
- Documentation = `docs/**` or `*.md` outside `.claude/`, `.specify/`, `.github/` (skills and the PR template are inputs to the harness tests and the template check).
- Renames: `git diff --no-renames` lists both sides, so code→md is not docs-only.
- Non-PR runs: the detector step is skipped, the output is empty, `!= 'true'` runs every job.
