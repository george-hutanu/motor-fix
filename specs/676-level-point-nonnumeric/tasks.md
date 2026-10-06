# Tasks: `level.mjs point` never crashes on a level that is not a number

**Input**: `specs/676-level-point-nonnumeric/spec.md` (level 1: no plan.md)

- [ ] T001 [US1] Test: `.claude/scripts/level.spec.mjs`. `point` with level `"abc"`, `true`, `""` or `7` exits 0 with the default line; `"1"` prints level 1 (FR-001, FR-002)
- [ ] T002 [US1] `.claude/scripts/level.mjs` `point` branch: guard with `parseLevel` (FR-001, FR-002)
- [ ] T003 `npm run test:harness` green (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001, FR-002 | `level.spec.mjs` point with a non-numeric level |
