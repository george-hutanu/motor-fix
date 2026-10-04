# Implementation Plan: Test and review every ready PR like a QA engineer before it merges

**Branch**: `434-agent-pr-review` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

## Summary

A `pr-tester` subagent, started by `/speckit-pr-test <PR>`, drives deterministic helper scripts under `.claude/scripts/pr-test/`: a fresh worktree at the PR head, private services and apps on free ports, a Playwright sweep (one browser, sequential contexts) with axe, the API smoke calls, the affected tests and the end-to-end suite, then a report. The agent adds its own judgement (flows from the spec's acceptance scenarios, the diff against the spec and the constitution), then `post.mjs` posts the review, the `agent-review` commit status and the PR's "Agent review" section. Two gates make the status binding: a new PreToolUse `pre:bash:merge-gate` refuses a merge without `agent-review` success on the head commit, and `stop:pr-lifecycle` refuses to end a session on a green ready PR without it. `/speckit-auto`, `/speckit-review`, AGENTS.md and Constitution VII put the step between ready and merge, with the Notion story in QA during the loop. `scripts/heavy.sh` serialises every heavy command, including the pre-commit hook and the Jest runs of the edit and stop gates.

## Technical Context

**Language/Version**: Node 24 (`.nvmrc`), plain ESM `.mjs` for the harness (`.claude/hooks`, `.claude/scripts`), POSIX `sh` for `scripts/heavy.sh`.
**Primary Dependencies**: `@playwright/test` 1.63.0 (package.json), new devDependency `axe-core` 4.13.0 (MPL-2.0; no existing package injects axe), `gh` CLI, `docker compose` when installed, else Homebrew `initdb`/`pg_ctl` 17 and `redis-server`.
**Storage**: none of its own; the report is files under `--out` (default `<tmp>/mf-prtest/<pr>-<sha7>`), run-state carries the Notion prior status.
**Testing**: harness vitest (`npm run test:harness`, `.claude/vitest.config.ts`), harness evals (`node .claude/scripts/harness-eval.mjs --check`).
**Target Platform**: macOS 16 GB laptop shared by several sessions (lockf), Linux in CI (flock).
**Constraints**: at most 3 heavy commands machine-wide (`scripts/heavy.sh` slots, 20 % free memory, owner relaxation mid-run); never mutation tests locally; one Playwright browser; teardown on every exit path.

## Constitution Check

| Principle | Result |
| --- | --- |
| I No bloat | Pass. Six helper modules, each with one job; no framework, no new runtime dependency (axe-core is dev-only and nothing in the tree injects axe). The local-services fallback exists because this machine has no Docker (Complexity Tracking). |
| II Tests | Pass. Every helper and gate gets a colocated `*.spec.mjs` first; eval cases prove the gates block and pass. |
| III Given stack | Pass. Playwright is the given end-to-end tool. |
| IV One toolchain | Pass. Harness specs on vitest as before; Biome lints. |
| V Rules in one place | Pass. Severity and verdict rules live in `findings.mjs` only; Notion status rules in `notion-status.mjs` only. |
| VI PostgreSQL is the truth | Not touched. |
| VII Autonomous lifecycle | Amended: the tester runs between ready and merge (v1.5.0). |

## Design

- **Worktree**: `git fetch origin pull/<n>/head` then `git worktree add --detach <tmp>/mf-prtest-<n>-<sha7> <sha>`; teardown `git worktree remove --force` and `git worktree prune`.
- **Ports**: bind port 0 on 127.0.0.1, read the port, close; ask for all ports in one call so they are distinct.
- **Services**: `docker compose -p mf-prtest-<n>-<rand>` with `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT` (compose file reads them with the old fixed ports as defaults), `down -v` on teardown. Without Docker: a private PostgreSQL cluster (`initdb` into the run's temp dir, `pg_ctl start -o "-p <port> -k <dir>"`) and a private `redis-server --port <port> --save ''`; no object store, so a readiness failure naming only `storage` is a `medium` environment finding.
- **Apps**: in the worktree, `npm ci` (or an APFS clone of the runner's `node_modules` when the lockfiles are equal), `prisma migrate deploy`, `nx run api:build`, `nx run web:build` (production, `--parallel=1`), then `node dist/apps/api/main.js` and `node dist/apps/web/server/server.mjs` on their ports; the worker only when the diff touches `apps/worker` or `libs/domain`/`libs/contracts`.
- **Sweep**: Playwright and axe-core resolved from the runner's own checkout; one Chromium; for each route × viewport × scheme × language a new context (`viewport`, `isMobile`, `hasTouch`, `colorScheme`, `locale`, an init script setting `mf.lang`), the page loaded with `waitUntil: 'networkidle'`, axe run, overflow measured (`scrollWidth > innerWidth`), screenshot full page.
- **Findings and verdict**: `findings.mjs` holds the severity table, the web-touching rule, the verdict, the changed GET endpoints from two OpenAPI documents, and the Markdown report.
- **Posting**: `post.mjs` with an injected `gh` runner; review event first, COMMENT fallback on HTTP 422 ("own pull request"), status, then the description section (`## Agent review` up to the next `## `) or a comment.
- **Gates**: `merge-gate.mjs` (PreToolUse Bash) parses `gh pr merge [<n|branch|url>]` and `gh api … pulls/<n>/merge`; `pr-lifecycle-gate.mjs` checks the rollup for `agent-review`. Both read `SPECKIT_PR_STATE` (JSON) instead of `gh` when set, so eval cases need no network; hook processes take the environment of Claude Code, not of a Bash call, so an agent cannot set it for a real gate run.
- **Lock**: `scripts/heavy.sh` tries 3 slot lock files with `lockf -k -t 0` (macOS) or `flock -n` (Linux), polling every 5 s; a marker separates a busy slot (75) from the command's own exit code; `HEAVY_WAIT` gives up with 124; INT/TERM/HUP stop the command and exit 130/143/129; exports `HEAVY_HELD=1`, `NX_PARALLEL=2`, `NX_DAEMON=false`, `JEST_MAX_WORKERS=2` and the shared wrapper's Node heap cap; `jest.preset.cjs` reads `JEST_MAX_WORKERS`; the hooks pass `--maxWorkers=2` because the root multi-project Jest config ignores a per-project value.
- **Notion**: `notion-status.mjs <event> --current <Status>` prints the target story and timeline statuses and whether to write; `blocked` records the prior status in run-state (`notion_prior_status`), `unblock` returns to it.

## Project Structure

### Documentation (this feature)

```text
specs/434-agent-pr-review/
├── spec.md  plan.md  tasks.md  design.md  context.md  notion-sync.md  auto-run.md
├── checklists/requirements.md
└── pr-review/          # tester evidence: own PR and the PR #14 dry run
```

### Source Code (repository root)

```text
scripts/heavy.sh
.claude/scripts/heavy.spec.mjs
.claude/scripts/notion-status.mjs (+ .spec.mjs)
.claude/scripts/pr-test/{services,worktree,findings,sweep,post}.mjs (+ .spec.mjs each), run.mjs
.claude/hooks/merge-gate.mjs (+ .spec.mjs), pr-lifecycle-gate.mjs (+ spec), stop-test-gate.sh, post-edit-check.sh, registry.json
.claude/settings.json, .claude/evals/cases/{merge-gate,pr-lifecycle}.json
.claude/agents/pr-tester.md, .claude/skills/speckit-pr-test/SKILL.md
.claude/skills/{speckit-auto,speckit-review,speckit-notion-sync,speckit-archive}/SKILL.md
.husky/pre-commit, jest.preset.cjs, docker-compose.yml, package.json, package-lock.json
AGENTS.md, CLAUDE.local.md, .specify/memory/constitution.md
```

## Complexity Tracking

| Addition | Why | Simpler alternative rejected because |
| --- | --- | --- |
| Local services fallback (initdb, redis-server) | This laptop has no Docker; the owner's tester must still run here | Using the shared Homebrew PostgreSQL/Redis on 5432/6379 collides with other sessions and leaves data behind |
| `SPECKIT_PR_STATE` seam in two gates | Eval cases must prove block/pass without GitHub | Fixture repositories cannot fake a PR's status rollup |
| A separate merge gate | A Stop hook cannot stop a merge command | Prose in the skills is not enforcement (constitution, Enforcement) |
