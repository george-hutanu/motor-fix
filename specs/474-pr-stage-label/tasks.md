# Tasks: Keep exactly one stage label on every open PR

**Input**: `specs/474-pr-stage-label/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [P] [US1] Test: `.claude/scripts/notion-status.spec.mjs` — the decision returns `stage` and `labels` for every event: each forward event adds its stage label and removes the other three and `blocked`; a repeated QA on a QA story still returns them (the PR #33 catch-up); blocked keeps the stage left and adds `blocked`, unblock keeps it and removes `blocked`; a Blocked story with no record only adds `blocked`; finish and a Done story remove every stage label and `blocked` (FR-001, FR-002, FR-003, FR-004)
- [X] T002 [P] [US2] Test: `.claude/hooks/pr-lifecycle-gate.spec.mjs` — refuses a ready PR with `in review` and `QA` keeping `QA`; a draft with `planning` and `in development` keeping `in development`; a draft with `in review` (remove it, add `in development`); a ready PR with `planning` or `in development` alone (remove it, add `in review`); passes one fitting stage label (FR-006, FR-007)
- [X] T003 [P] [US2] Eval cases in `.claude/evals/cases/pr-lifecycle.json`: a ready PR with `in review` and `QA` (the PR #33 state), a draft with `in review` (FR-008)

## Phase 2: Implementation

- [X] T004 [US1] `.claude/scripts/notion-status.mjs`: the stage label of each status and the `gh pr edit` label arguments, added to every decision (FR-001, FR-002, FR-003, FR-004)
- [X] T005 [US2] `.claude/hooks/pr-lifecycle-gate.mjs`: one stage-label check — more than one, or one that does not fit the draft state — naming the `gh pr edit` that leaves one fitting label (FR-006, FR-007)
- [X] T006 [US1] `.claude/skills/speckit-notion-sync/SKILL.md`: state the one-stage-label rule and apply the decision's `labels` on every event in place of the per-event table; `speckit-auto` hand-off, `speckit-pr-test` step 1 and AGENTS.md lifecycle step 4 point at it instead of quoting a move (FR-005)

## Phase 3: Proof

- [X] T007 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check` green with the new cases; `node .claude/scripts/doctor.mjs` green after `--bless-hooks` for the edited gate (SC-001, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002, FR-003, FR-004 | `.claude/scripts/notion-status.spec.mjs` |
| FR-005 | review of the skill and AGENTS.md diff (prose) |
| FR-006, FR-007 | `.claude/hooks/pr-lifecycle-gate.spec.mjs` |
| FR-008 | `.claude/evals/cases/pr-lifecycle.json` through `harness-eval.mjs` |
