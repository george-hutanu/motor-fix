# Tasks: The merge gate fails closed when verifying a carried review runs long

**Input**: `specs/659-merge-gate-carry-deadline/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [x] T001 [US1] Test: `.claude/hooks/merge-gate.spec.mjs` — the gate run as a process with a carried verdict whose state read is slower than a short deadline exits 2 naming the deadline; a PR read that fails exits 2 (FR-001, FR-002)
- [x] T002 [US1] Test: `.claude/hooks/merge-gate.spec.mjs` — `DEADLINE_MS` < the registry `timeout_ms` of `pre:bash:merge-gate` < its `timeout` in `.claude/settings.json` × 1000; the deadline override only shortens (FR-003)
- [x] T003 [US1] Test: `.claude/hooks/run-hook.spec.mjs` — a fail-closed entry whose script outlives its `timeout_ms` is refused with exit 2 (FR-004)
- [x] T004 [US2] Test: `.claude/scripts/pr-test/carry.spec.mjs` — `readCarryState` starts every statuses read before any resolves; the gate's reader reads head's statuses once (FR-005)
- [x] T005 [US1] Eval: `.claude/evals/cases/merge-gate.json` — `merge-gate-refuses-a-carry-it-cannot-verify-in-time` (SC-001)

## Phase 2: Implementation

- [x] T006 [US2] `.claude/scripts/pr-test/carry.mjs`: `readCarryState` and `findCarry` async; statuses after the compare read with `Promise.all` (FR-005)
- [x] T007 [US1] `.claude/hooks/merge-gate.mjs`: async gh reads under one deadline with an abort; prefetch the carry state; refuse on timeout and on a failed PR read; memoise statuses per sha (FR-001, FR-002, FR-005)
- [x] T008 [US1] `.claude/hooks/run-hook.mjs`: honour an entry's `timeout_ms`; a fail-closed gate that timed out or died on a signal refuses (FR-004)
- [x] T009 [US1] `.claude/hooks/registry.json` `timeout_ms: 45000` on `pre:bash:merge-gate`; `.claude/settings.json` `timeout: 60` on its command (FR-003)
- [x] T010 Re-record the edited hooks' fingerprints: read the diff, `node .claude/scripts/doctor.mjs --bless-hooks`, then `doctor.mjs` clean

## Phase 3: Proof

- [x] T011 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` (SC-003)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `merge-gate.spec.mjs` (slow carry past a short deadline → exit 2); eval `merge-gate-refuses-a-carry-it-cannot-verify-in-time` |
| FR-002 | `merge-gate.spec.mjs` (failed PR read → exit 2) |
| FR-003 | `merge-gate.spec.mjs` (deadline < wrapper limit < hook timeout; override only shortens) |
| FR-004 | `run-hook.spec.mjs` (slow fail-closed gate → exit 2) |
| FR-005 | `carry.spec.mjs` (concurrent statuses reads); `merge-gate.spec.mjs` (head statuses read once) |
