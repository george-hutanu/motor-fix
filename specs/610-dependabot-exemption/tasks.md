# Tasks: Tighten the Dependabot merge exemption

**Input**: `specs/610-dependabot-exemption/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [ ] T001 [US1] Test: `.claude/hooks/pr-lifecycle-gate.spec.mjs` — `isDependabot` refuses a foreign committer, an unverified signature and missing committer data; `attachCommitters` matches REST rows to commits by sha; `committerArgs`/`parseCommitters` read the REST list (FR-001, FR-002)
- [ ] T002 [US1] Test: `.claude/hooks/merge-gate.spec.mjs` — a Dependabot PR with a foreign or unverified committer needs the agent review; the green one still merges (FR-001)
- [ ] T003 [US2] Test: `.claude/hooks/merge-gate.spec.mjs` — a red exempt Dependabot PR gets its own wording; a reviewed PR keeps the old one (FR-003)
- [ ] T004 Eval cases in `.claude/evals/cases/merge-gate.json`: committer data on the Dependabot cases, a new case refusing a Dependabot-authored commit committed by someone else, the red case matching the new wording

## Phase 2: Implementation

- [ ] T005 [US1] `.claude/hooks/pr-lifecycle-gate.mjs`: committer check in `isDependabot`; export `committerArgs`, `parseCommitters`, `attachCommitters`; `readState` reads the committers for a Dependabot PR (FR-001, FR-002)
- [ ] T006 [US1] `.claude/hooks/merge-gate.mjs`: `readPr` reads the committers for a Dependabot PR (FR-002)
- [ ] T007 [US2] `.claude/hooks/merge-gate.mjs`: the exempt path's own red refusal (FR-003)
- [ ] T008 Re-record the edited hooks' fingerprints: read the diff, `node .claude/scripts/doctor.mjs --bless-hooks`, then `doctor.mjs` clean

## Phase 3: Proof

- [ ] T009 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `pr-lifecycle-gate.spec.mjs` (isDependabot committer cases), `merge-gate.spec.mjs`, eval `merge-gate-refuses-a-dependabot-pr-committed-by-someone-else` |
| FR-002 | `pr-lifecycle-gate.spec.mjs` (committerArgs, parseCommitters, attachCommitters) |
| FR-003 | `merge-gate.spec.mjs` (red Dependabot wording), eval `merge-gate-refuses-a-red-dependabot-pr` |
