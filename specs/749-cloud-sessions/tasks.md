# Tasks: Run the speckit workflow in Claude Code cloud sessions

**Input**: `specs/749-cloud-sessions/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [x] T001 [US1] Test: `.claude/scripts/github-identity.spec.mjs` — in cloud the hook leaves `CLAUDE_ENV_FILE` alone, prints no "no login" line, still prints the identity line and the check's drift; locally it writes the export and warns (FR-001)
- [x] T002 [US1] Test: `.claude/scripts/identity.spec.mjs` — cloud `apply` writes the author and no credential keys; cloud `check` passes without pinning and still fails a wrong author or foreign hooks path; local `check` still fails unpinned credentials (FR-001)
- [x] T003 [US1] Test: `.claude/scripts/lifecycle.spec.mjs` — `ready` posts the note as a marked comment; `handoff` re-posts it and stops with no note; `handoff --restore` writes the newest marked comment, ignores a mid-text marker, leaves an existing file, stops with none (FR-002, FR-003)
- [x] T004 [US1] Test: `.claude/scripts/heavy.spec.mjs` — 2 slots by default in cloud, `HEAVY_SLOTS` overrides it, 4 locally (FR-004)
- [x] T005 [US1] Test: `.claude/scripts/cloud-setup.spec.mjs` — stub `node`/`npm`/`docker`/`nvm`/`n`: installs Node 24 through nvm, else n; `npm ci` only when `node_modules` is stale; starts a stopped daemon; pulls postgres and redis; a second run installs nothing (FR-005)
- [x] T006 [US1] Test: `.claude/scripts/tail-handoff-wiring.spec.mjs` — hand-off posts the note, the tail and the watcher's `tail` fix restore it, AGENTS.md has the Cloud sessions section (FR-002, FR-003, FR-005)

## Phase 2: Implementation

- [ ] T007 [US1] `.claude/hooks/github-identity.sh` and `.husky/identity.sh`: the cloud branches (FR-001)
- [ ] T008 [US1] `.claude/scripts/lifecycle.mjs`: post the note at `ready`; the `handoff` step with `--restore` (FR-002, FR-003)
- [ ] T009 [US1] `scripts/heavy.sh`: cloud default of 2 slots (FR-004)
- [ ] T010 [US1] `scripts/cloud-setup.sh` (FR-005)
- [ ] T011 [US1] Docs: `hand-off.md`, `tail.md`, speckit-watch `tail` fix, speckit-review's Workflow fallback, AGENTS.md "Cloud sessions" (FR-002, FR-003, FR-005)
- [ ] T012 Re-record the edited hook's fingerprint: read the diff, `node .claude/scripts/doctor.mjs --bless-hooks`, then `doctor.mjs` clean

## Phase 3: Proof

- [ ] T013 `npm run test:harness` green; `node .claude/scripts/harness-eval.mjs --check`; `node .claude/scripts/doctor.mjs` (SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `github-identity.spec.mjs`, `identity.spec.mjs` (cloud cases and their local twins) |
| FR-002 | `lifecycle.spec.mjs` (ready and handoff post the marked note), `tail-handoff-wiring.spec.mjs` |
| FR-003 | `lifecycle.spec.mjs` (handoff --restore), `tail-handoff-wiring.spec.mjs` |
| FR-004 | `heavy.spec.mjs` (cloud default and override) |
| FR-005 | `cloud-setup.spec.mjs`, `tail-handoff-wiring.spec.mjs` (AGENTS.md section) |
