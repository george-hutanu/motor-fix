# Auto run — 474-pr-stage-label

- Description (user): "yes, with a new task in notion and speckit-auto to run the task" — "yes" approves the fix proposed earlier in the session for PR #33 carrying both `in review` and `QA`; expanded into the full description passed to every phase.
- Mode: `worktree` (the main checkout had 7 staged harness files on `stack-spartan-ui`, 216 commits behind `origin/main`); worktree `.claude/worktrees/pr-stage-label`, based on `origin/main` 418b111.
- Phase skills read from this worktree's `.claude/skills/`, not invoked through the Skill tool: the Skill tool loads them from the main checkout, whose copies predate PR #30 (no hand-off, "never push") — the same stale-rules failure this task fixes.
- Start commit: 418b111

## Preflight

- `node_modules` cloned (APFS copy-on-write) from `.claude/worktrees/skill-model-pins`: `package-lock.json` identical to this commit's.
- Through `scripts/heavy.sh`: `npm run typecheck` 12/12 green; `npm run lint` clean (281 files); `npm run test` 159/160 — `apps/web/src/app/addresses.adversary.spec.ts` › "marks the cockpit sample noindex…" exceeded its 5 s timeout (file took 15 s under load). Re-run alone: `Tests: 25 passed, 25 total` → a load timeout, not a red start.
- Constitution v1.6.0 read: version present, no placeholders. Principles I, V and VII carried.
- `spec-drift --status`: no active feature before this run.

## 0. Size

- Level 1 (one-session): the intent is fully set by the approved fix (what done means, what is out of scope); phases 2, 7, 9, 10, 12, 14, 16 plus hand-off. (evidence: the description names the files, the rule and the cases)

## 2. Specify

- Notion story created: ST-474, Task / System / Medium / 2 points, epic EP-1 Foundations. Branch `474-pr-stage-label` (story-numbered, as 431–467).
- Autonomous answers (spec Clarifications): the gate keeps the furthest fitting stage label (`.claude/scripts/notion-status.mjs:19`, the ladder); a PR with no story asks the same decision with the status its work is at (Principle V); the gate does not read Notion (`.claude/hooks/pr-lifecycle-gate.mjs:19`).
- Quality checklist: all items pass.
- Hooks: notion-sync start (To do → Planning); design-check → design.md (no screens); git-commit → yes, as the branch's first commit, which opens the draft PR.
