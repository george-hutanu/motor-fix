# Auto run — 440-pr-title-edited

- Description: ST-440, tech debt from ST-435 (PR #18), code-reviewer MEDIUM: CI's `pull_request` trigger keeps its default types, so a corrected PR title is only re-checked on the next push. Fix it so a corrected title re-checks without re-running every job on a body edit.
- Start commit: 2aa27d2 (origin/main), branch 440-pr-title-edited, worktree .worktrees/440-pr-title-edited
- PR: #118 (draft, planning)

## Preflight
- Tree clean; `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` exit 0 ("Successfully ran target test for 11 projects").
- spec-drift --status: no active feature at the time (the feature pointer was written just after).

## 0. Size
- Level 1 (one-session): intent clear ("done" = a title fix re-runs only the title check; a body edit re-runs no CI job). Phases: 2, 7, 9, 10, 12, 14, 16.

## 1. Constitution
- v1.8.1, no placeholders. Principle I drives the choice: move one job, add no script.

## 2. Specify
- `speckit.git.feature` (before_specify): skipped, the branch already existed (created by the orchestrator from origin/main).
- Gate answers (autonomous defaults, in spec Assumptions): a separate workflow rather than `edited` on ci.yml (ci.yml's concurrency cancels the run in progress on every PR event); CI OK no longer needs the title check (merge-gate judges every check); no branch protection (404).
- after_specify: notion-sync start (Planning, PR #118 linked), design check (no screens), quality checklist passed on the first iteration.

## 7. Tasks
- tasks.md written in the level-1 form (no plan.md, as in specs/436-docs-only-ci). 5 tasks; analyze not run at level 1.

## 9. Tests
- scripts/pr-title-workflow.spec.ts before any implementation: "Tests: 13 failed, 1 passed, 14 total" (the passing one guards that ci.yml keeps its default trigger, which is already true).

## 10. Implement
- pr-title.yml added, the title job and its CI OK need removed from ci.yml, AGENTS.md updated. Spec: "Tests: 14 passed, 14 total".

## Harden

| Check | Before | After |
|-------|--------|-------|
| diff-audit errors | 0 | 0 |
| artifact-lint errors | 0 | 0 |
| mutation score | waived: no mutable source (workflow YAML and Markdown only) | — |
| tests (pr-title specs) | 14 | 58 |

- test-adversary added `scripts/pr-title-workflow.adversary.spec.ts` (44 tests); 1 failed: a refused title holding a line break printed a second `::` workflow command. Defect, fixed: the echoed title is escaped as a workflow command expects (`%`, CR, LF). Now green.
- Its Biome findings (sorted keys, `${` in plain strings) fixed without suppressions.
- Lint and typecheck green after the fixes. Inspections: IDE not running. Repair lap 1 of 5.

## Review

- spec-reviewer: APPROVE. LOW fixed: a ticket key in a generated test title replaced with a neutral subject.
- code-reviewer: APPROVE. MEDIUM fixed: the spec's helpers threw nothing on a missing file, key or step and could pass vacuously; they now throw, and the job's absence is asserted on the file. LOW deferred to `deferred.md`: two Conventional Commit rules (`pr-body-check.ts` and the workflow) disagree, pre-existing.

## Proof (T005, SC-001, SC-002)

- 2026-10-05, PR #118: title set to a non-Conventional one, PR title run 37299262204 failed; title restored, run 37299306793 passed. No push, and no CI run started beyond 37299000553 (from the last push). The PR template workflow also re-ran on each edit, as before.

## Retrospective evidence

- retro-evidence since 2aa27d2: Spec Delta platform +6; no new carryover from this feature; Jev lane unavailable.
- trace-matrix reports 0/6 tagged for this feature, as for every feature in the repo: the constitution keeps ids out of source, so the FR → test map is in `tasks.md`. The verdict stays the owner's (`/speckit-retro`).
- Agent context: nothing to change; AGENTS.md already updated as FR-006.
