# Tasks: The PR lifecycle gate finds a zero-padded feature folder

**Input**: `specs/725-lifecycle-gate-feature-dir/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [x] T001 [US1] Test: `.claude/hooks/pr-lifecycle-gate.spec.mjs` — `featureDir` resolves the pointer, `specs/<branch>`, a zero-padded folder with the same slug, and refuses another slug (FR-001)
- [x] T002 [US1] Test: `.claude/hooks/pr-lifecycle-gate.spec.mjs` — `prLinked` finds the PR in `specs/083-x/notion-sync.md` for branch `83-x`, with and without `.specify/feature.json` (FR-002)
- [x] T003 [US1] Test: `.claude/hooks/pr-lifecycle-gate.spec.mjs` — `handedOff` finds `specs/083-x/handoff.md` for branch `83-x` without a pointer (FR-003)

## Phase 2: Implementation

- [x] T004 [US1] `.claude/hooks/pr-lifecycle-gate.mjs`: export `featureDir(cwd, branch)`; `prLinked` (exported) and `handedOff` read through it (FR-001–FR-003)
- [x] T005 Re-record the edited hook's fingerprint: read the diff, `node .claude/scripts/doctor.mjs --bless-hooks`, then `doctor.mjs` clean

## Phase 3: Proof

- [x] T006 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `pr-lifecycle-gate.spec.mjs` (featureDir cases) |
| FR-002 | `pr-lifecycle-gate.spec.mjs` (prLinked with and without the pointer) |
| FR-003 | `pr-lifecycle-gate.spec.mjs` (handedOff on a zero-padded folder) |
