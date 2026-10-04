# /speckit-auto run — 490-notion-ready

- **Description**: keep Ready to work current in MotorFix stories (new `/notion-ready`, run by `speckit-notion-sync` after every start and finish, checked by `/speckit-archive`, stated in AGENTS.md); later added by the owner mid-run: on every finish, comment on the Notion story when there is something worth recording.
- **Start commit**: e08eff3 (origin/main) in worktree `.claude/worktrees/notion-ready`; the owner's checkout had staged work, so the run moved to a worktree on the owner's instruction.
- **Branch**: `490-notion-ready` · **PR**: #42 (draft) · **Story**: ST-490

## Preflight

- `npm ci` (heavy.sh) · `npm run typecheck` green · `npm run lint` green · `npm test` green · `npm run test:harness` 36 files, 749 tests passed.
- Constitution read; no placeholders.

## 0. Size

- Level 1 (one-session): intent stated in full by the owner, one coherent unit, no design choice. Phases 2, 7, 9, 10, 12, 14, 16.
- `level.mjs suggest` returned no opinion (Jev lane unavailable).

## 2. Specify

- No Notion story existed; created ST-490 (Task / System / Medium / 2) under EP-1 Foundations so the branch number follows the story, as ST-474 did. The repo's next free number (475) belongs to another story.
- Autonomous answers (spec Clarifications): holds are judged by the skill and passed to a tested decision; only start and finish refresh readiness; "after the finish" means later in the log file.
- Hooks: `speckit-notion-sync start` (To do → Planning), empty start commit, draft PR #42 from the template, PR link on ST-490; design check: no screens.

## 7. Tasks

- 8 tasks, 3 test-first.

## 9. Tests (red first)

- `npx vitest run --config .claude/vitest.config.ts notion-ready` → 2 files failed, no tests ran (module and skill missing).

## 10. Implement

- `notion-ready.mjs` (decision + archive check), skill, sync §2d/§2e, archive step 5, AGENTS.md rule. `notion-ready` specs: 26 passed.
- SC-001: the decision on the 2026-10-04 Foundations data reproduces the 34 hand-ticked items, tick [] untick [].
- Full harness: 775 tests, 1–5 failures in `watch.adversary.spec.mjs`, a different test each run; the file passes alone (186/186). Flaky under load, not touched by this change — follow-up.
- Commit c7afec8 `feat(harness): …`, pushed. Notion Planning → Implementing, PR label `in development`.

## 12. Harden

- `artifact-lint`: 0 errors, 0 warnings (Jev unavailable). `diff-audit`: clean.
- No Stryker config covers `.claude/`; no mutation run (laptop rule: never locally).
