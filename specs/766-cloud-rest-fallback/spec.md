# Feature Specification: Make the cloud session setup and lifecycle scripts work without GraphQL

**Feature Branch**: `766-cloud-rest-fallback`

**Created**: 2026-10-06

**Status**: Archived (2026-10-06)

**Input**: "Make the cloud session setup and lifecycle scripts work without GraphQL. Measured in a cloud session: GitHub GraphQL → 403, so `gh pr view/checks/edit/ready/create` fail; REST works (`gh api repos/george-hutanu/motor-fix/...`; ready via `POST /pulls/<n>/ccr/ready_for_review`). `scripts/cloud-setup.sh` installs Node 24 but `/opt/node22` is first on PATH so it exits 1; Playwright needed a chromium other than `/opt/pw-browsers`'. Out of scope: how PR QA is started, how or by whom `agent-review` is set, merge-gate.mjs, any CI workflow."

Notion: ST-766 https://app.notion.com/p/3f1607bff0d281819edfcc527eee0d1d (Task, Medium, EP-1 Foundations).

## Finding, verified in this session

- `gh pr list --limit 1` answers `HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API …`; `gh api 'repos/{owner}/{repo}/pulls?head={owner}:<branch>&state=open'` answers.
- `.claude/scripts/lifecycle.mjs` runs `gh pr list|create|view|edit|ready|comment` and `gh label create` (`:199-322`); every one but `gh label create` and `gh pr comment` goes through GraphQL, so `open`, `ready` and `handoff --restore` stop in the cloud.
- `.claude/hooks/pr-lifecycle-gate.mjs:276` reads `gh pr view <branch> --json …statusCheckRollup…`; the 403 is not "no pull requests found", so `readState` returns null and the gate lets every stop through in the cloud.
- `.claude/scripts/notion-sync.mjs:88` swallows gh errors and returns "", so `pr view` (PR number, URL) and `pr edit` (labels) silently do nothing in the cloud.
- `scripts/cloud-setup.sh`: `/etc/profile.d/nodejs.sh` puts `/opt/node22/bin` first on PATH and Node 24 is already at `/opt/nvm/versions/node/v24.21.0`, but the script looks only in `${NVM_DIR:-$HOME/.nvm}` (unset → `~/.nvm`, absent), installs with `n` or NodeSource into a directory behind `/opt/node22/bin`, and exits 1. `@playwright/test` 1.63.0 wants chromium revision 1243; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` holds 1194 only and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set.
- `.claude/scripts/cloud-setup.spec.mjs` "never lets sudo ask for a password" fails when the tests run as root (the cloud VM): `as_root` then calls the command directly and the stub `sudo` is never reached.

## Clarifications

### Session 2026-10-06

- Q: Does `gh pr merge` get a REST path in the cloud? → A: No. Merging is out of scope by the owner's instruction (merge-gate.mjs judges `gh pr merge`); it stays plain gh (autonomous default).
- Q: `pr view --json comments` reads how many comments? → A: Every page (`--paginate`), so `handoff --restore` no longer stops at 100 (ST-749 deferred item) (autonomous default).
- Q: `pr checks --watch` polls how often? → A: Every 10 s, gh's default `--interval` (autonomous default).
- Q: `~/.bashrc` missing? → A: Created with the one marked line (autonomous default).
- Q: `PLAYWRIGHT_BROWSERS_PATH` unset? → A: Playwright's own default, `~/.cache/ms-playwright` (autonomous default).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The lifecycle runs in a cloud session (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `CLAUDE_CODE_REMOTE=true`, **When** `lifecycle.mjs open` runs on a branch with no PR, **Then** the draft is opened, labelled and found through `gh api` REST calls only, and the gates are still asked about the original `gh …` command.
2. **Given** `CLAUDE_CODE_REMOTE=true`, **When** `lifecycle.mjs ready` runs, **Then** the body is published (`PATCH /pulls/<n>`), the PR is marked ready (`POST /pulls/<n>/ccr/ready_for_review`) and the hand-off note is posted (`POST /issues/<n>/comments`), with no GraphQL call.
3. **Given** `CLAUDE_CODE_REMOTE=true` and no `handoff.md`, **When** `lifecycle.mjs handoff --restore --pr <n>` runs, **Then** the note is restored from the newest marked comment read through `GET /issues/<n>/comments`.
4. **Given** `CLAUDE_CODE_REMOTE=true`, **When** the `stop:pr-lifecycle` gate reads the branch's PR, **Then** it reads number, state, draft, labels, title, author, commits, mergeability and the head's check runs and statuses through REST, and decides exactly as it does on gh's GraphQL answer.
5. **Given** `CLAUDE_CODE_REMOTE=true`, **When** `notion-sync.mjs` needs the PR number or URL or sets the stage labels, **Then** it does so through REST.
6. **Given** `CLAUDE_CODE_REMOTE=true`, **When** an agent runs `node .claude/scripts/gh.mjs pr checks <n> [--watch] [--json name,bucket --jq …]`, **Then** it gets gh's buckets and exit codes from the head's check runs and statuses.
7. **Given** `CLAUDE_CODE_REMOTE` unset or anything but `true`, **When** any of the above runs, **Then** gh is called exactly as before.

### User Story 2 - The cloud setup script finishes on the cloud image (Priority: P1)

**Acceptance Scenarios**:

1. **Given** Node 22 first on PATH and a Node 24 already installed under an nvm directory (`$NVM_DIR`, `~/.nvm` or `/opt/nvm`), **When** `scripts/cloud-setup.sh` runs, **Then** it installs no Node, puts that Node 24's `bin` first on PATH, and exits 0.
2. **Given** an installer that puts Node 24 behind another Node on PATH, **When** the script runs, **Then** it finds the installed Node 24 and puts it first instead of exiting 1.
3. **Given** a Node 24 directory put first, **When** the script ends, **Then** `~/.bashrc` carries exactly one marked `export PATH=<dir>:$PATH` line (rewritten, never duplicated, on a second run), and `CLAUDE_ENV_FILE`, when set, gets the same line.
4. **Given** `node_modules/playwright-core/browsers.json` names chromium revision R and `$PLAYWRIGHT_BROWSERS_PATH` (default `~/.cache/ms-playwright`) has no `chromium-R` or `chromium_headless_shell-R`, **When** the script runs, **Then** it runs `npx playwright install chromium` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` cleared; when both are there it installs nothing.

### Edge Cases

- A gh command the REST layer does not translate (`gh pr merge`, `gh run …`, `gh api …`, `gh workflow …`) runs as plain gh in the cloud too: merging and starting QA are out of scope and stay where they are.
- `gh pr view <branch>` with no PR for the branch: exit 1 and gh's own `no pull requests found for branch "<branch>"`, so the gate still tells "no PR" from "read failed".
- `gh label create <name> --force` on an existing label: updated, exit 0; without `--force`: exit 1.
- `--remove-label` of a label the PR does not carry: not an error (gh ignores it too).
- A `--jq` expression beyond a plain path (`.a.b`, `.[0].c`): handed to the `jq` binary; with no `jq` on PATH, exit 1 naming it.
- `gh pr checks` with nothing reported yet: gh's "no checks reported" and exit 1.
- The cloud-setup spec must not depend on the uid it runs as.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: With `CLAUDE_CODE_REMOTE=true`, `gh pr list|view|create|edit|ready|comment|checks` and `gh label create`, as the lifecycle scripts call them, MUST be answered through `gh api` REST calls with gh's output shape (`--json` fields, `--jq`/`-q`, the URL that `pr create` prints, gh's exit codes); any other gh command MUST run unchanged. Without it, gh MUST be called exactly as before.
- **FR-002**: `lifecycle.mjs` MUST route its gh calls through FR-001 while still putting the original `gh …` command to the Bash gates first.
- **FR-003**: `pr-lifecycle-gate.mjs` and `notion-sync.mjs` MUST read and write the PR through FR-001.
- **FR-004**: `node .claude/scripts/gh.mjs <gh args>` MUST run one gh command through FR-001 (stdout, stderr and exit code passed through), and `pr checks --watch` MUST poll until no check is pending.
- **FR-005**: `scripts/cloud-setup.sh` MUST put a Node 24 first on PATH and persist it for the session (one marked line in `~/.bashrc`, and in `CLAUDE_ENV_FILE` when set), reusing an installed Node 24 before installing one, and MUST install the chromium revision the installed `playwright-core` pins when it is missing; AGENTS.md "Cloud sessions" MUST say so and name `gh.mjs`.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: The vitest cases for FR-001–FR-005, each cloud case beside its local twin, fail before the change and pass after it.
- **SC-002**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.
- **SC-003**: In this cloud session, `node .claude/scripts/gh.mjs pr view <branch> --json number,isDraft` answers for this feature's own PR.

## Assumptions

- Cloud detection is `CLAUDE_CODE_REMOTE=true` only, as every other cloud difference in the scripts (AGENTS.md "Cloud sessions") (autonomous default).
- The REST layer translates only the gh calls the lifecycle scripts and the documented CI reads make; it is not a general gh replacement (Principle I) (autonomous default).
- `statusCheckRollup` from REST is the head commit's check runs (`GET /commits/<sha>/check-runs`) plus its combined status (`GET /commits/<sha>/status`), mapped to GraphQL's `CheckRun` and `StatusContext` shapes; check runs older than the latest per name are not de-duplicated, as GraphQL does not either (autonomous default).
- `gh pr merge` stays plain gh in the cloud: merging is out of scope by the owner's instruction, so the tail merges from the laptop (autonomous default).
- The marked PATH line goes to `~/.bashrc` because the cloud shell sources it after `/etc/profile.d/nodejs.sh` (verified: `/root/.bashrc` sets `NVM_DIR=/opt/nvm`) (autonomous default).

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-005
