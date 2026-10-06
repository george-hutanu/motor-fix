# Tasks: The constitution and harness docs name biome.jsonc

**Input**: `specs/613-biome-docs/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [ ] T001 [US1] Test: `.claude/scripts/biome-config-name.spec.mjs` (new) — no live harness text names `biome.json` without the `c`; the constitution is read from after its Sync Impact Report comment (FR-001)

## Phase 2: Implementation

- [ ] T002 [US1] `.specify/memory/constitution.md` Principle IV names `biome.jsonc`; PATCH 1.8.1 → 1.8.2 with a Sync Impact Report entry and the version line (FR-001, FR-002)
- [ ] T003 [US1] `.specify/contexts/implement.md`, `.claude/agents/spec-reviewer.md`, `.claude/hooks/post-edit-check.sh` (comment) name `biome.jsonc` (FR-001)
- [ ] T004 Re-record the edited hook's fingerprint: `node .claude/scripts/doctor.mjs --bless-hooks` after reading the diff

## Phase 3: Proof

- [ ] T005 `npm run test:harness` green; `node .claude/scripts/doctor.mjs` clean (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `biome-config-name.spec.mjs` |
| FR-002 | `biome-config-name.spec.mjs` (version line 1.8.2, report entry) |
