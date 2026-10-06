---
description: "Tasks for ST-766 Make the cloud session setup and lifecycle scripts work without GraphQL"
---

# Tasks: Make the cloud session setup and lifecycle scripts work without GraphQL

**Input**: `specs/766-cloud-rest-fallback/` (spec.md, plan.md)
**Tests**: required and written first (Constitution II): vitest specs colocated with each file, gh reached only through an injected `run`, no network. One file: `npx vitest run --config .claude/vitest.config.ts <file>`.

## FR to test map

| FR | Spec case (task) | Code (task) |
| --- | --- | --- |
| FR-001 | T001 | T006 |
| FR-002 | T002 | T007 |
| FR-003 | T003 | T008 |
| FR-004 | T001 | T006 |
| FR-005 | T004, T005 | T009, T010 |

## Phase 1: Tests first

- [x] T001 [P] [US1] New `.claude/scripts/lib/gh-rest.spec.mjs`: laptop passthrough; `pr list --head --jq`; `pr view` by branch, number, URL and current branch with the GraphQL field shapes (state, mergeable, labels, author, commits, comments over pages, statusCheckRollup); no PR → gh's message, exit 1; `pr create` prints the URL and labels the PR; `pr edit` body/title/add/remove (absent label ignored); `pr ready` uses the ccr route; `pr comment`; `label create` with and without `--force` on 422; `pr checks` buckets, exit 8/1/0, "no checks reported", `--json name,bucket --jq`, `--watch` polling; untranslated commands pass through; `ghSync` throws with stderr; `jq` path vs binary. CLI `gh.mjs` passes stdout, stderr, code.
- [x] T002 [P] [US1] `.claude/scripts/lifecycle.spec.mjs`: with `CLAUDE_CODE_REMOTE=true`, `open`, `ready` and `handoff --restore` make only `gh api` calls and the gates still see `gh pr …`; without it, unchanged.
- [x] T003 [P] [US1] `.claude/hooks/pr-lifecycle-gate.spec.mjs` and `.claude/scripts/notion-sync.spec.mjs`: `readPr` returns `{pr}`, `{pr:null}` on no PR, `null` on another error, through an injected sync; in the cloud it reads REST; `defaultGh` goes through the REST layer and returns "" on failure.
- [x] T004 [P] [US2] `.claude/scripts/cloud-setup.spec.mjs`: uid-independent (stub `id`); a Node 24 under `/opt/nvm`-like root behind a Node 22 → no install, PATH line in `~/.bashrc` and `CLAUDE_ENV_FILE`, second run keeps one line; installer leaves Node 24 behind → found, exit 0.
- [x] T005 [P] [US2] `.claude/scripts/cloud-setup.spec.mjs`: pinned chromium missing → `npx playwright install chromium` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` empty; present → nothing.

## Phase 2: Implement

- [x] T006 [US1] `.claude/scripts/lib/gh-rest.mjs` and `.claude/scripts/gh.mjs`; T001 green.
- [x] T007 [US1] `.claude/scripts/lifecycle.mjs` `exec` routes gh through `ghRun` after its gates; T002 green.
- [x] T008 [US1] `.claude/hooks/pr-lifecycle-gate.mjs` `readPr` via `ghSync`; `.claude/scripts/notion-sync.mjs` `defaultGh` via `ghSync`; T003 green; read the gate's diff, `doctor.mjs --bless-hooks`.
- [x] T009 [US2] `scripts/cloud-setup.sh` Node 24 lookup and PATH persistence; T004 green.
- [x] T010 [US2] `scripts/cloud-setup.sh` chromium; T005 green; AGENTS.md "Cloud sessions".

## Phase 3: Polish

- [x] T011 `npm run test:harness`, `node .claude/scripts/doctor.mjs`, `node .claude/scripts/harness-eval.mjs --check`, `npx biome check` on the touched files; SC-003 live: `node .claude/scripts/gh.mjs pr view 766-cloud-rest-fallback --json number,isDraft`.

## Dependencies

T001–T005 before T006–T010; T006 before T007, T008; T009 before T010; T011 last. T001–T005 touch different files [P].
