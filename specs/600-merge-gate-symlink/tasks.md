# Tasks: The merge gate runs when started through a symlinked path

**Input**: `specs/600-merge-gate-symlink/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] Test: `.claude/scripts/lib/entry.spec.mjs` (new) — `isEntryPoint(url)` is true for the module `process.argv[1]` names, by its real path and through a symlinked directory; false for another module, for a missing `process.argv[1]` and for one naming a file that does not exist, never throwing (FR-001)
- [X] T002 [US1] Test: `.claude/scripts/lib/entry.spec.mjs` — no hook in `.claude/hooks/` (specs aside) compares `process.argv[1]` with its module URL; every hook with an entry guard imports `isEntryPoint` (FR-002)
- [X] T003 [US1] Test: `.claude/hooks/merge-gate.spec.mjs` — the gate started through a symlinked `.claude` directory, with a stub `gh` reporting a PR with no `agent-review`, exits 2 on `gh pr merge 21 --merge`, as it does through the real path (FR-003)

## Phase 2: Implementation

- [X] T004 [US1] `.claude/scripts/lib/entry.mjs` (new): `isEntryPoint(moduleUrl)` comparing `realpathSync` of both, false on any error (FR-001)
- [X] T005 [US1] Entry guards in `.claude/hooks/merge-gate.mjs`, `pr-lifecycle-gate.mjs`, `config-protection.mjs`, `session-context.mjs`, `agent-model-router.mjs`, `session-watch-reminder.mjs` use `isEntryPoint(import.meta.url)`; unused `fileURLToPath` imports dropped (FR-002, FR-003)
- [X] T006 [US2] `.claude/scripts/heavy.spec.mjs`: the pre-commit origin/main test makes its folders with `mkdirSync(…, { recursive: true })` (FR-004)
- [X] T007 Re-record the edited hooks' fingerprints: `node .claude/scripts/doctor.mjs --bless-hooks` after reading the diff

## Phase 3: Proof

- [ ] T008 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` clean (SC-003)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `entry.spec.mjs` (real path, symlinked path, other module, no argv, missing file) |
| FR-002 | `entry.spec.mjs` (no raw `process.argv[1]` comparison in any hook) |
| FR-003 | `merge-gate.spec.mjs` (exit 2 through a symlinked directory) |
| FR-004 | `heavy.spec.mjs` (its own setup; no `spawnSync('mkdir'` left — checked by grep in T008) |
