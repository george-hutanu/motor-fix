# Feature Specification: Run the speckit workflow in Claude Code cloud sessions

**Feature Branch**: `749-cloud-sessions`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "The full speckit workflow works in Claude Code cloud sessions (claude.ai/code) without changing local behaviour. Cloud facts: `CLAUDE_CODE_REMOTE=true` is set; Ubuntu x86_64, Node 22 on PATH; GitHub goes through a proxy, `GH_TOKEN`/`GITHUB_TOKEN` hold the placeholder `proxy-injected` and must not be overwritten; the clone has no gitignored files (.env, handoff.md, run-state.json, feature.json); a paused session resumes on a fresh VM; Docker, PostgreSQL 16, Redis, gh, jq, python3 preinstalled; 4 vCPU / 16 GB."

Notion: ST-749 https://app.notion.com/p/3f1607bff0d2815bacc9f8387e053a8c (Task, Medium, no epic: MotorFix epics has no harness or tooling epic).

## Finding, verified against the code

- `.claude/hooks/github-identity.sh:22` appends `export GH_TOKEN="$(gh auth token … --user george-hutanu || echo george-hutanu-is-not-logged-in-to-gh)"` to `CLAUDE_ENV_FILE`. In the cloud gh has no keyring login, so every later command would run with the sentinel instead of the proxy's `proxy-injected`, and `:33` warns "gh has no login" on every session.
- `.husky/identity.sh apply` (`npm ci`'s `prepare`) replaces `credential.https://github.com.helper` with one that asks gh's keyring for george-hutanu's token: through the proxy that helper hands git nothing, so pushes break. `check` (`.husky/pre-commit`) then reports the credentials as not pinned and refuses every commit.
- `.claude/scripts/lifecycle.mjs:258` writes `specs/<feature>/handoff.md`, which git ignores; the tail and `/speckit-watch` read only that file, so a session resumed on a fresh VM has no note.
- `scripts/heavy.sh:35` defaults to 4 slots, sized for the owner's 16 GB laptop with other sessions sharing the slots machine-wide; a 4 vCPU cloud VM runs one session.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A story runs end to end in a cloud session (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `CLAUDE_CODE_REMOTE=true` and `GH_TOKEN=proxy-injected`, **When** the SessionStart hook runs, **Then** nothing is written to `CLAUDE_ENV_FILE`, no "gh has no login" line is printed, and the identity line and the author check still run.
2. **Given** a cloud checkout, **When** `sh .husky/identity.sh apply` runs, **Then** `user.name` and `user.email` are george-hutanu's and no `credential.https://github.com.*` key is written; **and When** `check` runs, **Then** it passes without credential pinning and still fails a wrong author, committer or foreign `core.hooksPath`.
3. **Given** a story agent that reaches ready, **When** `lifecycle.mjs ready` writes `handoff.md`, **Then** the same text is posted as a PR comment whose first line is `<!-- speckit-handoff -->`; **and When** the note's `QA run:` line is added or rewritten, **Then** `lifecycle.mjs handoff` posts it again.
4. **Given** a tail on a fresh VM with no `handoff.md`, **When** it runs `lifecycle.mjs handoff --restore --pr <n>`, **Then** the note is written from the newest marked comment; with the file present nothing is fetched or changed.
5. **Given** `CLAUDE_CODE_REMOTE=true` and no `HEAVY_SLOTS`, **When** `scripts/heavy.sh` runs, **Then** at most 2 heavy commands run at once; `HEAVY_SLOTS` still overrides it.

### Edge Cases

- `CLAUDE_CODE_REMOTE` unset, empty or anything but `true`: every script behaves exactly as before (each spec runs the local case beside the cloud one).
- No marked comment on the PR and no file: `handoff --restore` stops naming the fix (the tail then treats the PR as having no recorded run, as `tail.md` step 3 already does).
- `handoff` (post) with no `handoff.md`: stops, never posts an empty note.
- A comment body that only quotes the marker mid-text is not a note: only a comment whose first line is the marker counts.
- `cloud-setup.sh` run twice: the second run installs nothing it already has.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: With `CLAUDE_CODE_REMOTE=true`, `github-identity.sh` MUST NOT write `CLAUDE_ENV_FILE` or warn about a missing gh login, and MUST still print the identity line and run `identity.sh check`; `identity.sh apply` MUST set only `user.name` and `user.email`, and `check` MUST skip only the credential-pinning check. Without it both behave as before.
- **FR-002**: Whenever the hand-off note is written (`lifecycle.mjs ready`) or changed (`lifecycle.mjs handoff`), its text MUST be posted as a PR comment whose first line is `<!-- speckit-handoff -->`.
- **FR-003**: `lifecycle.mjs handoff --restore [--pr <n>]` MUST write a missing `handoff.md` from the newest PR comment whose first line is the marker, and change nothing when the file exists; the tail and `/speckit-watch`'s `tail` fix MUST run it before reading the note.
- **FR-004**: `scripts/heavy.sh` MUST default `HEAVY_SLOTS` to 2 when `CLAUDE_CODE_REMOTE=true`, and keep 4 otherwise; an explicit `HEAVY_SLOTS` wins in both.
- **FR-005**: `scripts/cloud-setup.sh` MUST bring a cloud VM to a working checkout idempotently (Node 24 through nvm, else `n`, else NodeSource; `npm ci` only when `node_modules` is older than `package-lock.json`; the Docker daemon up; `docker compose pull postgres redis`), and AGENTS.md MUST carry a "Cloud sessions" section: the setup script, the environment variables by name, the network level, single-repo sessions only, one story per session and no `watch.mjs`, the Workflow and Artifact fallbacks, and the connector-prefix note.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: The vitest cases for FR-001–FR-005, each with its local twin, fail before the change and pass after it.
- **SC-002**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.

## Assumptions

- No harness epic exists in MotorFix epics (searched 2026-10-06), so ST-749 has none, as the task said (autonomous default).
- The note is posted again rather than edited in place (autonomous default): "newest marked comment wins" needs no comment id kept anywhere, and a fresh VM has nowhere to keep one.
- `cloud-setup.sh` cannot be run against a real cloud VM from here; its spec drives it with stub `node`, `npm`, `docker`, `nvm` and `n` on `PATH`, and the AGENTS.md section says it is unverified until the first cloud run (autonomous default).
- Workflow and Artifact tools: `/speckit-review` and `/speckit-design-check` are checked for a fallback when they are missing; a missing one gets one line.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-005
