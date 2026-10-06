# Feature Specification: Cloud sessions run QA and merge on their own

**Feature Branch**: `767-cloud-qa-merge`

**Created**: 2026-10-06

**Status**: Archived (2026-10-06)

**Input**: "Claude Code cloud sessions (CLAUDE_CODE_REMOTE=true) must run the whole task lifecycle with no laptop and no owner commands. Measured in a cloud session: workflow_dispatch 403; writing commit statuses refused by the proxy; GraphQL 403, so gh pr view/checks/edit/ready/create fail; pushing, PR reviews and comments, labels, POST ready_for_review and PUT /pulls/<n>/merge work."

Notion: ST-767 https://app.notion.com/p/3f1607bff0d281619f86e58899289770 (Task, Medium, EP-1 Foundations).

## Finding, verified against the code

- `.github/workflows/pr-qa.yml:16` triggers on `workflow_dispatch` only, and `.claude/scripts/pr-test/dispatch.mjs` starts it with `gh workflow run`: a 403 in the cloud, so no QA run ever starts there.
- `agent-review` is set only by `.claude/scripts/pr-test/post.mjs` (and `carry.mjs`) from the session, through `POST /statuses`, which the cloud proxy refuses: the merge gate never sees a verdict.
- `dispatch.mjs` reads the PR with `gh pr view` (GraphQL), and so do `.claude/hooks/merge-gate.mjs` (`readPr`) and `lifecycle.mjs merge` (`gh pr view`, `gh pr merge`, `gh pr comment`): every one fails in the cloud, and the gate then refuses every merge.
- `merge-gate.mjs` `mergeTarget` already recognises `gh api … repos/<o>/<r>/pulls/<n>/merge` (eval case `merge-gate-refuses-the-rest-merge-call`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A cloud story is tested and merged with no laptop (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a non-draft PR from a branch of this repository, **When** it is marked ready, pushed to or reopened, **Then** the PR QA workflow runs on its head commit by itself; a draft PR or a fork's PR starts no run, and a newer run for the same PR cancels the older one.
2. **Given** a PR QA run on head `<sha>`, **When** it starts, **Then** `<sha>` gets `agent-review` pending; **When** it ends with the run passing and no blocking findings, **Then** `agent-review` success; **When** any step failed, **Then** `agent-review` failure; a cancelled run writes no final state.
3. **Given** `CLAUDE_CODE_REMOTE=true`, **When** `dispatch.mjs <n> --no-wait` runs, **Then** it reads the PR over REST, dispatches nothing, finds the newest `pull_request` run of `pr-qa.yml` for the head SHA over REST, and prints the same `QA run:` hand-off line; `--run <id>` reads that run as before.
4. **Given** `CLAUDE_CODE_REMOTE=true`, **When** the PR tester posts its verdict (`post.mjs`), **Then** it posts the review and the Agent review section but writes no `agent-review` status.
5. **Given** `CLAUDE_CODE_REMOTE=true`, **When** `lifecycle.mjs merge --pr <n>` runs, **Then** it reads the PR, merges with `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=merge`, reads the merge commit and posts the finish comment, all over REST; the merge gate judges that command exactly as it judges `gh pr merge`, reading the PR, its commits, check runs and statuses over REST.

### Edge Cases

- `CLAUDE_CODE_REMOTE` unset or anything but `true`: `dispatch.mjs`, `post.mjs`, `lifecycle.mjs merge` and the merge gate behave exactly as before (each spec runs the local twin).
- No `pull_request` run for the head yet: `dispatch.mjs` polls as it does for a dispatched run, then exits 2 with no hand-off line.
- `lifecycle.mjs merge` in the cloud without `--pr`: stops and names `--pr` (the branch's PR cannot be found without GraphQL).
- A check re-run, or a PR QA run cancelled by a newer one on the same head: the gate judges the newest run of each workflow's job, as with the GraphQL rollup.
- A REST read the gate cannot finish: refused, as any unreadable PR is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.github/workflows/pr-qa.yml` MUST also run on `pull_request` (`ready_for_review`, `synchronize`, `reopened`) for non-draft PRs whose head is in this repository, with one concurrency group per PR that cancels older runs; `workflow_dispatch` stays.
- **FR-002**: The workflow MUST set `agent-review` on the tested head with its own `GITHUB_TOKEN` (`statuses: write`): pending at start, success only when the run passed with no blocking findings, failure otherwise.
- **FR-003**: With `CLAUDE_CODE_REMOTE=true`, `dispatch.mjs` MUST NOT call `workflow_dispatch`; it MUST read the PR over REST and find the `pull_request` run for the head SHA over REST.
- **FR-004**: With `CLAUDE_CODE_REMOTE=true`, `post.mjs` MUST NOT write the `agent-review` status: only the workflow sets it.
- **FR-005**: With `CLAUDE_CODE_REMOTE=true`, `lifecycle.mjs merge` MUST merge with `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge -f merge_method=merge` and read and comment over REST, and `merge-gate.mjs` MUST read the PR over REST and apply the unchanged rule (agent-review success and every other check green); harness-eval cases MUST cover the cloud merge command.
- **FR-006**: AGENTS.md "Cloud sessions" MUST say QA starts by itself on ready or push and sets `agent-review`, and the merge goes over REST.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: The vitest cases for FR-001–FR-006, each with its local twin where there is one, fail before the change and pass after it.
- **SC-002**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.

## Assumptions

- The workflow sets `agent-review` on both triggers (the description says "the PR QA workflow sets", without a trigger). On the laptop the PR tester's own verdict, posted after the run, is the newer status and still wins. (autonomous default)
- On `pull_request` the tester scripts come from the base branch (`main`), as a dispatched run's do by default (`dispatch.mjs --ref main`); the PR's own `pr-qa.yml` decides the trigger. (autonomous default)
- The cloud merge path uses `{owner}/{repo}`, which gh fills in from the remote (as `carry.mjs` does), rather than the literal `george-hutanu/motor-fix`; the gate's pattern reads both. (autonomous default)
- The laptop keeps dispatching; its dispatched run and the `pull_request` run share the PR's concurrency group, so the newer one cancels the other. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006
- **Modifies**: none
- **Removes**: none

The capability had no requirement for a cloud session's QA run and merge: QA started only by `workflow_dispatch`, and the merge gate read the PR over GraphQL.
