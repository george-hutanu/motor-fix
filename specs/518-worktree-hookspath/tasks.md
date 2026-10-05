# Tasks: Worktree commits run the worktree's own hooks

**Input**: `specs/518-worktree-hookspath/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [US1] [US2] Test: `.claude/scripts/identity.spec.mjs` — scratch main checkout + linked worktree: `apply` repoints a pinned worktree; `check` fails a pinned one naming the path and the fix; `check` passes main and the worktree on their own hooks; `apply` leaves the pin while the worktree has no `.husky/_` (FR-001, FR-002, FR-003)

## Phase 2: Implementation

- [X] T002 `.husky/identity.sh`: `hooks_elsewhere`; `apply` unsets the worktree-scope pin when it resolves elsewhere and `.husky/_/h` exists; `check` reports it (FR-001, FR-002)
- [X] T003 `AGENTS.md` identity section: one line on the hooks pin

## Phase 3: Proof

- [X] T004 `npm run test:harness` green; `node .claude/scripts/doctor.mjs` clean (identity.sh is not a registered gate script, so no bless)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `identity.spec.mjs` (repoints; leaves the pin without `.husky/_`) |
| FR-002 | `identity.spec.mjs` (check fails pinned, passes own hooks) |
| FR-003 | `identity.spec.mjs` (main checkout's config unchanged: check passes it; only `--worktree` scope is unset) |
