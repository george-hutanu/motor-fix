# Feature Specification: Worktree commits run the worktree's own hooks

**Feature Branch**: `chore-worktree-hookspath`

**Created**: 2026-10-05

**Status**: Draft

**Input**: "Find what pins a worktree's core.hooksPath to the main checkout (`.git/worktrees/<name>/config.worktree` holding `core.hooksPath = <main>/.husky/_`), fix it at the source if the writer is in the repo, and add a check that reports a worktree whose core.hooksPath points outside its own checkout."

Notion: ST-615 https://app.notion.com/p/3f0607bff0d2816aaf35dc0f8d6c4c03 (Task, Epic EP-1).

## Finding: the writer is outside the repo

Nothing in the repository writes `--worktree core.hooksPath`: no script, hook, skill or package script does (`git grep -n hooksPath` finds only one-shot `-c core.hooksPath=/dev/null` in test helpers; husky itself writes the relative `.husky/_` to the shared `.git/config`). The worktrees carrying the absolute pin are exactly the ones the Claude desktop app created under `.claude/worktrees/`, and their `config.worktree` holds that line beside `core.untrackedCache = true`, the pair the app writes when it makes a worktree. A worktree made by `git worktree add` (this one) has no `config.worktree` at all. The likely reason for the pin: `.husky/_` is gitignored and absent until `npm install` runs, so the app points a fresh worktree at the main checkout's hooks so it has some.

The effect: husky's `.husky/_/h` runs `$(dirname "$(dirname "$0")")/pre-commit`, i.e. the **main checkout's** `.husky/pre-commit`, with the worktree as working directory. A branch that changes its pre-commit is not tested by its own commits, and a main checkout behind `origin/main` runs an older hook (how integration specs reached the shared `localhost:5432` during ST-599).

The source cannot be fixed in this repository, so the repository repairs and reports it where it already pins per-checkout state: `.husky/identity.sh`, which `npm install` runs (`apply`, via `prepare`), every commit runs (`check`, via `.husky/pre-commit`), and every agent session runs (`check`, via the SessionStart identity hook).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A worktree's install repoints its hooks (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a worktree whose `config.worktree` pins `core.hooksPath` to another checkout and which has its own `.husky/_`, **When** `npm install` (or `sh .husky/identity.sh apply`) runs, **Then** the pin is removed, so the shared relative `.husky/_` applies, and the run says so.
2. **Given** the worktree has no `.husky/_` of its own yet, **When** `apply` runs, **Then** the pin is left, so the worktree is never left without hooks.

### User Story 2 - A pinned worktree is reported (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a checkout whose effective hooks directory resolves outside its own `.husky/_`, **When** `sh .husky/identity.sh check` runs (every commit, every session start), **Then** it fails naming the hooks path and the fix `sh .husky/identity.sh apply`.
2. **Given** the main checkout or a worktree on its own `.husky/_`, **When** `check` runs, **Then** it passes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `identity.sh apply` MUST remove a worktree-scope `core.hooksPath` that resolves outside the checkout's own `.husky/_`, only when that `.husky/_` exists.
- **FR-002**: `identity.sh check` MUST fail when the effective `core.hooksPath` resolves outside the checkout's own `.husky/_`, naming the path and the fix.
- **FR-003**: Neither MUST touch any other worktree's configuration.

## Success Criteria *(mandatory)*

- **SC-001**: After `npm install` in a desktop-app worktree, `git config core.hooksPath` reads `.husky/_`.
- **SC-002**: A commit or session in a still-pinned worktree reports the pin instead of silently running another checkout's hooks.

## Assumptions

- Other worktrees on this machine that still carry the pin are reported to the owner, not edited (task constraint); each fixes itself on its next `npm install` or `identity.sh apply` once this is on `main`.
- Level 1 (one-session): no plan.md.

## Spec Delta

### Adds

- `.husky/identity.sh` keeps each checkout on its own hooks: `apply` drops a worktree pin to another checkout's `.husky/_`, `check` reports one (FR-001, FR-002).
