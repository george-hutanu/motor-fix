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
- test-adversary: 59 tests, 6 failing — dedupe of repeated IDs (twice), unstable order for digitless IDs, `decide` accepting a non-array, raw stack traces on bad JSON and a missing file. All fixed; adversary spec kept (86 notion-ready tests green).
- code-reviewer (c7afec8): BLOCK on 1 HIGH — a bullet-form `- [NOTION-SYNC PENDING: ready …]` line was not read, so a Notion outage would have blocked archive. Fixed with a test. MEDIUM vacuous `/comment/i` assertion tightened; LOW archive recipe now follows the check's reason.
- Autonomous decision (reviewer's MEDIUM "decision"): holds are read in a second pass, only for items the first `decide` finds ready — bounded by the ready count, and complete, since a hold can only stop a ready item. Evidence: the quota note in `.claude/skills/notion-ready/SKILL.md` §1 and Principle I.
- Commit 57f56c0 `refactor(harness): …`, pushed.

## 14. Review

- spec-reviewer: APPROVE. MEDIUM: the no-finish message named no command (fixed). MEDIUM: padded adversary spec (seven duplicate or out-of-spec cases removed). LOW: title typo (fixed); run log uncommitted (committed here).
- code-reviewer re-review: APPROVE; all four prior findings resolved. New MEDIUM: an id-less item would tick page `null` (now refused, tested). MEDIUM: two more duplicate cases (removed).
- notion-ready specs: 78 passed.

## 16. Retrospective evidence

- Gathered for the final report, unjudged.
