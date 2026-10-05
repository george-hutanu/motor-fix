# Feature Specification: Lifecycle steps as one script call each: open, ready, merge

**Feature Branch**: `696-lifecycle-script`
**Created**: 2026-10-05
**Status**: Archived (2026-10-05)
**Level**: 1 (one-session)
**Notion story**: ST-696, https://app.notion.com/p/3f0607bff0d2812e96e9c2882339f2bd (Task, Medium)
**Epic**: EP-1 Foundations

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each lifecycle step is one Bash call (Priority: P1)

Today a story agent and its tail carry out the Constitution VII ceremony as many
small turns, re-deriving a fixed recipe each time: the start commit, the push,
the draft PR from the template with its labels, the Notion link, the body
check, ready, the QA labels, the records commit, the hand-off note, the merge,
the finish comment. `node .claude/scripts/lifecycle.mjs <open|ready|merge>` does
one step in one call and prints one short JSON line: what it did, or the first
thing that stopped it and the fix.

**Independent Test**: run each step with git, gh, the gates and the Notion CLI
stubbed, and compare the commands run, in order, with the expected ones.

**Acceptance Scenarios**:

1. **Given** a feature branch with no commit ahead of main and no PR, **When** `open --title "chore(harness): ST-696 …"` runs, **Then** it makes the empty `chore(harness): ST-696 start …` commit, pushes with upstream to the feature branch, opens a draft PR from `.github/pull_request_template.md` with the labels `planning`, the title's type label and `scope: harness`, then runs the Notion `start` and `pr <n>` events, and prints `{"step":"open","ok":true,"pr":<n>,…}`.
2. **Given** a branch that already has commits and an open PR, **When** `open` runs again, **Then** it makes no commit, opens no second PR, and runs only the push and the Notion events.
3. **Given** a finished feature and a filled body file, **When** `ready --body-file <f>` runs, **Then** it files any unfiled `deferred.md` bullets (the Notion `debt` event), commits and pushes the feature records (the feature's `specs/` folder and `.specify/capabilities/`), runs `scripts/pr-body-check.ts` on the body, `gh pr edit --body-file`, `gh pr ready`, the Notion `qa` event, commits and pushes the `qa` line, and writes `specs/<feature>/handoff.md` with the PR, branch, worktree, head sha, Notion story, open decisions and deferred items.
4. **Given** a ready PR whose head has `agent-review` success and every other check green, **When** `merge` runs, **Then** it runs `gh pr merge <n> --merge`, the Notion `finish` event with `specs/<feature>/finish-comment.md` (absolute path), posts one finish comment on the merged PR (that file, the merge sha and the new `notion-sync.md` lines), restores `notion-sync.md`, deletes `handoff.md`, and reports the Ready to work candidates left for the hold review.

### User Story 2 - A step stops at the first failure, with the fix (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a body that fails `pr-body-check.ts`, **When** `ready` runs, **Then** it stops before `gh pr edit`, prints the checker's findings, and the PR stays a draft.
2. **Given** a PR the merge gate would refuse (no `agent-review` success, a red, pending or missing check), **When** `merge` runs, **Then** it does not merge, prints the gate's own refusal, and runs nothing after it.
3. **Given** no `NOTION_TOKEN` (the Notion CLI exits 3), **When** any step reaches a Notion event, **Then** it stops there and prints the exact connector events left (`speckit-notion-sync <event>`) and the command that finishes the step once they are done (`--notion-done`).
4. **Given** any git or gh command the step runs fails, **When** it fails, **Then** the step stops at it and prints the command and its error.

### User Story 3 - The gates and the identity rules hold inside the script (Priority: P1)

**Acceptance Scenarios**:

1. **Given** any git or gh command a step runs, **When** it is about to run, **Then** the Bash gates registered in `.claude/settings.json` (`pre:bash:guard`, `pre:bash:commit-gate`, `pre:bash:merge-gate`) judge that exact command first, and a refusal stops the step with the gate's message.
2. **Given** the current branch is `main`, **When** any step runs, **Then** it pushes nothing and stops: work reaches main only through a merged PR.
3. **Given** any step, **When** it pushes, **Then** the push is `git push -u origin <feature branch>`, never forced and never to main.
4. **Given** `GH_TOKEN` is unset, **When** a step runs gh, **Then** gh runs with george-hutanu's token (`gh auth token -u george-hutanu`), never the active account.

### Edge Cases

- `merge` on a PR already merged skips the merge and finishes the rest, so a step cut short by a missing token resumes with `--notion-done`.
- `merge` with no `finish-comment.md` passes `--no-comment` to Notion and posts the finish log alone.
- `ready` with nothing new in the records makes no commit.
- `gh pr ready` on a PR already ready is not a failure.
- A test-only state variable of the merge gate (`SPECKIT_PR_STATE`, `SPECKIT_CARRY_STATE`) set in the caller's environment never reaches the gates the script runs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `lifecycle.mjs open --title <t>` MUST, in this order: make the empty start commit when the branch has no commit ahead of `origin/main`; push with upstream to the feature branch; when the branch has no open PR, open a draft from the PR template with `planning`, the title's type label (`breaking` when the title has `!`) and `scope: <scope>`; then run the Notion `start` and `pr <n>` events.
- **FR-002**: `lifecycle.mjs ready --body-file <f>` MUST, in this order: file the unfiled `deferred.md` bullets with the Notion `debt` event; commit and push the feature records when they changed; run `pr-body-check.ts` and stop on failure; `gh pr edit --body-file`; `gh pr ready`; the Notion `qa` event; commit and push the `qa` line; write `handoff.md`.
- **FR-003**: `lifecycle.mjs merge` MUST run the merge gate on `gh pr merge <n> --merge` and refuse exactly when it refuses; otherwise merge, then run the Notion `finish` event, post one finish comment on the merged PR, restore `notion-sync.md` and delete `handoff.md`.
- **FR-004**: Every step MUST print exactly one JSON line on stdout: `ok`, the step, what it did, and on a stop `stopped` (the command or check) and `fix`.
- **FR-005**: When the Notion CLI exits 3, the step MUST stop and list the connector events left and the `--notion-done` rerun that completes the step.
- **FR-006**: Every git and gh command MUST first pass the Bash gates registered in `.claude/settings.json`, judged on that command's text, with the merge gate's test-only state variables removed from their environment.
- **FR-007**: No step MAY push from `main`, push to `main`, or force-push.
- **FR-008**: gh MUST run as george-hutanu: the caller's `GH_TOKEN`, else `gh auth token -u george-hutanu`; when that fails or prints nothing, the step MUST stop before any git or gh call.
- **FR-009**: `speckit-auto/SKILL.md` (the lines listing the open, ready and merge commands) and `speckit-git-commit/SKILL.md` (the first-commit recipe) MUST name one `lifecycle.mjs` call per step instead of the recipe.

### Key Entities

- **Step result**: the one JSON line: `step`, `ok`, `did` (list), `pr`, and on a stop `stopped`, `fix`, `left` (connector events), `then` (the rerun).
- **Hand-off note**: `specs/<feature>/handoff.md`, git-ignored, read by the tail.

## Success Criteria *(mandatory)*

- **SC-001**: A story's open, ready and merge each take one model turn when the token is present (measured against today's transcripts in the PR body).
- **SC-002**: The skill text that spelled out these recipes shrinks; the lines and bytes removed are stated in the PR body.
- **SC-003**: Every stop point (body check, merge gate, no token, a failed command) has a spec that proves the step runs nothing after it.

## Assumptions

- The Notion events go through `.claude/scripts/notion-sync.mjs` from PR #139 (ST-687), called as its CLI stands; until it is on the branch, a missing script is treated like exit 3 (connector events left). (autonomous default)
- The gates run as processes through `run-hook.mjs <id>`, the same entry Claude Code uses, rather than by importing their functions: a hook only sees the `node lifecycle.mjs` command, so the script feeds each underlying command to the same registered gates, which keeps their profile, disable and fail-closed rules and means a refusal is exactly the gate's own. `merge-gate.mjs` is reused this way, never copied. (autonomous default)
- The type label comes from `typeLabel` in `pr-lifecycle-gate.mjs` (imported); the epic label is added by the Notion `pr` event, as today. (autonomous default)
- The feature records are the feature's `specs/<feature>/` folder (git ignores `handoff.md` and `finish-comment.md`) and `.specify/capabilities/`, committed as `chore(specs): ST-<n> feature records`; the `qa` line as `chore(specs): ST-<n> qa`. (autonomous default)
- `ready`'s Ready to work tick needs the hold review's judgement, so `merge` reports the candidates from `finish` and leaves the tick to the model. (autonomous default)
- No waiting and no QA dispatch: ST-688 owns those. (description)
- The merged PR's finish comment is built from `finish-comment.md`, the merge sha and the `notion-sync.md` lines `finish` wrote, in a temporary file, so the Notion retry keeps reading `finish-comment.md` unchanged. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009
