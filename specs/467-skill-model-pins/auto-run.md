# Auto run — 467-skill-model-pins

- Description (user): "create a notion task and start working on this task." — "this task" is the per-phase model split proposed earlier in the session; expanded into the full mapping and passed to every phase.
- Mode: `worktree` (the main checkout had 7 staged harness files on `stack-spartan-ui`); worktree `.claude/worktrees/skill-model-pins`, based on `origin/main` 1d23288.
- Start commit: 1d23288

## Preflight

- `npm ci` in the worktree; `npm run typecheck` 12/12 green, `npm run lint` clean (266 files), `npm test` 10 projects green.
- Constitution v1.5.0 read: version present, no placeholders. Principle I and VII carried.
- `spec-drift --status`: no active feature before this run.

## 0. Size

- Level 1 (one-session): the intent is fully set by the owner's mapping; phases 2, 7, 9, 10, 12, 14, 16 plus hand-off. (evidence: the description names every skill and its model)

## 2. Specify

- Notion story created: ST-467, Task / System / Medium / 2 points, epic EP-1 Foundations. Branch `467-skill-model-pins` (story-numbered, as 431–436).
- Autonomous answers (spec Clarifications): model lives in skill frontmatter (`.claude/agents/code-reviewer.md:5`); `speckit-pr-test`, newer than the list, stays unpinned like `speckit-review`; no AGENTS.md / CLAUDE.local.md line (Principle V).
- Quality checklist: all items pass.
- Hooks: notion-sync start (To do → In progress); design-check → design.md (no screens); git-commit → yes.
