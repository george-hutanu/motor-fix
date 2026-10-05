# Feature Specification: Notion sync as a script, one call per lifecycle event

**Feature Branch**: `687-notion-sync-script`
**Created**: 2026-10-05
**Status**: In progress
**Level**: 1 (one-session)
**Notion story**: ST-687, https://app.notion.com/p/3f0607bff0d28174b6aefa86026809d6 (Task, Medium)
**Epic**: EP-1 Foundations

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A lifecycle event is one Bash call (Priority: P1)

Today an agent carries out every `speckit-notion-sync` event (start, implement,
pr, qa, blocked, unblock, finish, debt, the Ready to work refresh, the finish
comment, the timeline row, the epic status) by hand through the Notion
connector: a dozen tool calls, each re-reading prose. With a `NOTION_TOKEN`,
`node .claude/scripts/notion-sync.mjs <event>` does the whole event against
Notion's REST API, applies the PR labels, appends the same `notion-sync.md`
lines and prints one JSON line.

**Independent Test**: run each event against a stubbed `fetch` and a stubbed
`gh`, and compare the requests made and the lines logged with the expected ones.

**Acceptance Scenarios**:

1. **Given** ST-687 is To do and its epic To do, **When** `start` runs, **Then** the story becomes Planning, its timeline row Planning, the epic In progress, the PR's stage label `planning`, the Ready to work refresh runs, and one log line per write is appended.
2. **Given** the story is Implementing, **When** `qa` runs, **Then** the story and the row become QA and the PR carries `QA` and no other stage label.
3. **Given** the story is Implementing, **When** `blocked "CI red"` runs, **Then** the story and the row become Blocked, the prior status is kept in run-state, and the reason is posted on the story and the PR; `unblock` returns both to Implementing.
4. **Given** the story is QA and every other story of the epic is Done, **When** `finish --body-file <f>` runs, **Then** the story is Done, the row Merged, the epic Done, the comment posted and the ready refresh logged.
5. **Given** an open PR #139, **When** `pr 139` runs, **Then** the story's `PR` holds its URL and the log carries `· pr · ST-687 · PR #139 <url>`, the line `stop:pr-lifecycle` reads.
6. **Given** `deferred.md` with one pending bullet, **When** `debt` runs, **Then** one To do task is created from `debt-tasks.mjs` and the bullet carries its URL.

### User Story 2 - The script fails open (Priority: P1)

The build never waits on the tracker.

**Acceptance Scenarios**:

1. **Given** no `NOTION_TOKEN` in the environment or either `.env`, **When** any event runs, **Then** it writes nothing, prints `notion-sync: no NOTION_TOKEN, use the connector` and exits 3, and the skill falls back to the connector.
2. **Given** Notion answers 500, **When** an event runs, **Then** a `[NOTION-SYNC PENDING: …]` line is logged, the script exits 0, and the next run retries that line first.
3. **Given** Notion answers 429 with `Retry-After: 2`, **When** an event runs, **Then** the client waits 2 seconds and retries.

### User Story 3 - The connector path and the script agree (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the connector fallback, **When** it logs with `notion-sync.mjs log`, **Then** the line is byte-for-byte the one the script writes for the same event.
2. **Given** a token, **When** `check` runs, **Then** it reads the stories data source, the Plans page and one story page, writes nothing, and reports each.

### Edge Cases

- A story already at the target status writes nothing and logs `unchanged`; a Done story never moves; a story with no timeline row logs `no row`.
- A `PR` property already holding another PR keeps it and gets a `Follow-up PR` comment.
- A `finish` with neither `--body-file` nor `--no-comment` is a usage error: an absent comment is a decision, never a default.
- A worktree has no `.env`: the token is read from the main checkout's `.env`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `lib/notion.mjs` MUST call the Notion REST API with plain `fetch`, `Notion-Version: 2026-03-11`, the data-source endpoints, a request timeout, and a retry on 429 that waits `Retry-After` seconds; it MUST add no dependency.
- **FR-002**: The token MUST be read from `NOTION_TOKEN` in the environment, else the repo's `.env`, else the main checkout's `.env` (found through `git rev-parse --git-common-dir`).
- **FR-003**: `start`, `implement`, `qa`, `review`, `blocked`, `unblock` and `finish` MUST resolve the story by its ST number, ask `notion-status.mjs` for the decision, and write it to the story, its build-timeline row and the epic (In progress at `start`, Done at the `finish` that leaves no story of the epic open).
- **FR-004**: `pr <n>` MUST write the PR's URL onto an empty `PR` property, leave an equal one, comment `Follow-up PR: <url>` on a different one, add the `EP-<n>` label, and log `· pr · ST-<n> · PR #<n> <url>`.
- **FR-005**: Every status event MUST apply the decision's stage labels to the story's PR through `gh` and log `· labels · PR #<n> · <stage>`.
- **FR-006**: `start` and `finish` MUST run the Ready to work refresh through `notion-ready.mjs`: unticks are written, and ticks wait for the hold review (`ready --tick`), as the `notion-ready` skill's two passes do; the refresh MUST be logged as a `· ready ·` line.
- **FR-007**: `blocked <reason>` MUST post the reason on the story and on the PR; `finish` MUST post the body file as the story's comment, or log `nothing to record` with `--no-comment`.
- **FR-008**: `debt` MUST file every pending bullet of `deferred.md` as a task built by `debt-tasks.mjs` and mark the bullet with its URL.
- **FR-009**: Every event MUST print exactly one JSON line on stdout.
- **FR-010**: With no token, every event and `check` MUST write nothing, print `notion-sync: no NOTION_TOKEN, use the connector` and exit 3.
- **FR-011**: A Notion error MUST be logged as `[NOTION-SYNC PENDING: <event> <item> — <error>]` with exit 0, and the next run MUST retry each pending line first and mark it retried.
- **FR-012**: `log <event> <item> <text>` MUST append the line through the same formatter the events use.
- **FR-013**: `check` MUST only read: the stories data source, the Plans page and one story page.
- **FR-014**: The token MUST NOT appear in stdout, stderr or the log.
- **FR-015**: The `speckit-notion-sync` skill MUST lead with the script call per event, keep a complete connector fallback, and be shorter than 14,725 bytes.
- **FR-016**: `.env.example` MUST end with `NOTION_TOKEN=` and a comment naming what the integration must be shared with.

## Success Criteria *(mandatory)*

- **SC-001**: A status event is 1 Bash call instead of the connector's fetch, query, update and log calls.
- **SC-002**: The skill is shorter than 14,725 bytes.

## Assumptions

- `Notion-Version` 2026-03-11 is the latest version (developers.notion.com, Versioning, read 2026-10-05); the query is `POST /v1/data_sources/{id}/query`, a page parent `{type: data_source_id}`, a comment and a new page take `markdown`, and 429 carries `Retry-After` in seconds (Request limits). (autonomous default)
- The story is the one whose `ID` number is the feature number (`687-…` is ST-687), the convention every branch here follows; `--story ST-<n>` overrides it. (autonomous default)
- An epic's build timeline is the data source titled `… (EP-<n>) — build timeline`, found through `POST /v1/search`, as every timeline under Plans is named. (autonomous default)
- A hold needs judgement the script cannot make, so the refresh writes unticks itself and reports tick candidates for review; `ready --tick` writes the confirmed ones. (autonomous default)
- `plan` (a new epic's execution plan and timeline database) stays on the connector: it is rare and creates schema. (autonomous default)
- Exit 3 is the no-token code: 0 is done (a Notion error included, logged PENDING), 1 a failed `check`, 64 a usage error. (autonomous default)
- The live API path is unverified until `check` passes against the owner's token: the main checkout has no `.env` on 2026-10-05. (autonomous default)
- The worktree and branch were created by this run off origin/main 81f3537; `before_specify` was not run. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001-FR-016
