# Feature Specification: The merge gate runs when started through a symlinked path

**Feature Branch**: `600-merge-gate-symlink`

**Created**: 2026-10-05

**Status**: Draft

**Input**: "`.claude/hooks/merge-gate.mjs` decides it is the entry point with `process.argv[1] === fileURLToPath(import.meta.url)`; started through a symlinked path that is false and the fail_closed gate exits 0 without checking. Fix: compare real paths in the entry check; same for the other hooks using that idiom; a spec that starts the gate through a symlink. Also: heavy.spec.mjs uses spawnSync('mkdir') — use mkdirSync."

Notion: ST-600 https://app.notion.com/p/3f0607bff0d281eb997efd4eb1225acd (Task, Medium, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Deferred from the QA review of PR #93 (lap 2, low). The task has no comments.

## Finding: six hooks skip their work when their path is a symlink

- Node resolves a module's `import.meta.url` to its real path, while `process.argv[1]` keeps the path the process was started with. A checkout reached through a symlink (macOS `/var/folders` → `/private/var/folders`, `/tmp` → `/private/tmp`, or a linked worktree) makes the two differ, so a hook's "am I the entry point" test is false and the hook exits 0 having checked nothing. The PR tester reproduced it on the merge gate: exit 0 through the symlinked path, exit 2 through the real one.
- Hooks with such a test (`.claude/hooks/`): `merge-gate.mjs` and `pr-lifecycle-gate.mjs` (`process.argv[1] === fileURLToPath(import.meta.url)`), and `config-protection.mjs`, `session-context.mjs`, `agent-model-router.mjs`, `session-watch-reminder.mjs` (`` import.meta.url === `file://${process.argv[1]}` ``, which also fails on a path that needs URL escaping). Three of them are fail-closed gates in `.claude/hooks/registry.json` (merge gate, PR lifecycle, config protection).
- `.claude/scripts/watch.mjs` and `.claude/scripts/notion-ready.mjs` already compare real paths, inline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A gate started through a symlink still decides (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the merge gate reached through a symlinked directory and a merge of a PR with no `agent-review` success, **When** it runs, **Then** it refuses with exit 2, exactly as through the real path.
2. **Given** any hook in `.claude/hooks/` that guards its entry point, **When** the harness specs run, **Then** it guards it with the shared real-path check, not a raw `process.argv[1]` comparison.

### User Story 2 - The heavy.sh spec makes folders without a subprocess (Priority: P3)

1. **Given** `.claude/scripts/heavy.spec.mjs`, **When** its pre-commit origin/main test sets up its repo, **Then** it creates the folders with `mkdirSync`, not by spawning `mkdir`.

### Edge Cases

- `process.argv[1]` missing (a module imported from a REPL or `node -e`): not the entry point, no throw.
- `process.argv[1]` naming a file that does not exist: not the entry point, no throw.
- A hook imported by another module (the merge gate imports the PR lifecycle gate): the imported one is not the entry point.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The harness MUST offer one entry-point check that compares the real path of `process.argv[1]` with the real path of the calling module, and answers false (never throws) when either cannot be resolved.
- **FR-002**: Every hook in `.claude/hooks/` that runs only as the entry point MUST use that check; no hook may compare `process.argv[1]` with its module URL directly.
- **FR-003**: The merge gate started through a symlinked path MUST refuse a merge it refuses through the real path (exit 2).
- **FR-004**: `.claude/scripts/heavy.spec.mjs` MUST create its test folders with `mkdirSync`.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: A spec starts the merge gate through a symlinked directory and sees exit 2 for a merge without an agent review.
- **SC-002**: Zero hooks in `.claude/hooks/` keep a raw `process.argv[1]` entry comparison.
- **SC-003**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.

## Assumptions

- Scope is the hooks, as the task says ("the other hooks that use the same idiom"). The ~20 scripts under `.claude/scripts/` with the `file://` idiom are CLIs a person or agent runs, not gates; they are a deferred follow-up, not this change (autonomous default; Principle I).
- The check lives in `.claude/scripts/lib/`, where the hooks already import shared helpers from (`hooks.mjs`, `feature.mjs`) (autonomous default).
- `watch.mjs` and `notion-ready.mjs` keep their inline copies; moving them onto the shared check is outside the task (autonomous default).
- The spec is a vitest spec, not an eval case: an eval case runs through `run-hook.mjs`, which starts the script by its registry path, so it cannot place a symlink in front of it (autonomous default).

## Spec Delta

### Adds

- Hooks recognise themselves as the entry point by real path, so a hook started through a symlinked path still runs (FR-001, FR-002, FR-003).

### Modifies

None.

### Removes

None.
