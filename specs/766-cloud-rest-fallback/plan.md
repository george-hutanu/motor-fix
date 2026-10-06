# Implementation Plan: Make the cloud session setup and lifecycle scripts work without GraphQL

**Branch**: `766-cloud-rest-fallback` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/766-cloud-rest-fallback/spec.md`

## Summary

One small REST layer, `.claude/scripts/lib/gh-rest.mjs`, answers the gh
commands the lifecycle scripts run (`pr list|view|create|edit|ready|comment|checks`,
`label create`) through `gh api` when `CLAUDE_CODE_REMOTE=true`, in gh's own
output shape; every other command, and every command on the laptop, runs as
plain gh. `lifecycle.mjs` (after its gates), `pr-lifecycle-gate.mjs` and
`notion-sync.mjs` call it; `.claude/scripts/gh.mjs` is its CLI for agents
(`pr checks --watch` included). `scripts/cloud-setup.sh` finds an installed
Node 24 before installing one, puts it first on PATH and persists that line,
and installs the chromium revision the installed `playwright-core` pins.

## Technical Context

**Language/Version**: JavaScript, plain ESM, Node >= 24; POSIX sh/bash for `cloud-setup.sh`
**Primary Dependencies**: none new. `node:child_process` (`spawnSync`, `execFileSync`), gh 2.89 (`gh api --paginate --slurp`, `{owner}/{repo}` placeholders, verified in this session), `jq` only for a `--jq` beyond a plain path
**Storage**: N/A
**Testing**: vitest (`npm run test:harness`), colocated `*.spec.mjs`; every gh call injected through a `run` stub, no network; `cloud-setup.spec.mjs` drives the script with stub binaries on PATH
**Target Platform**: Claude Code cloud VM (Ubuntu, root, `/opt/node22` first on PATH) and the owner's laptop (unchanged)
**Project Type**: harness scripts outside the Nx projects
**Constraints**: laptop path byte-for-byte unchanged (same `gh` argv and options); `pr-lifecycle-gate.mjs` is a registered hook (read the diff, then `doctor.mjs --bless-hooks`); `harness-eval.mjs --check` must not drop; out of scope: `dispatch.mjs`, `merge-gate.mjs`, `agent-review`, CI workflows
**Scale/Scope**: 1 new lib + 1 CLI, 3 scripts wired, 1 shell script, AGENTS.md

## Constitution Check

- [x] **I. No Bloat**: one module, only the commands the scripts call; no dependency; no option nobody passes. The CLI is the one consumer agents need for `pr checks` / `pr view` in the cloud.
- [x] **II. Test Discipline**: failing vitest cases first, cloud case beside its laptop twin; no internal ids in source.
- [x] **III / IV**: stack untouched; Biome on the touched files.
- [x] **V. Rules Live in One Place**: the GraphQL→REST mapping lives in `gh-rest.mjs` only; the three callers import it.
- [x] **VI**: N/A.
- [x] **VII**: the lifecycle itself is followed (draft #160, Notion ST-766).

## Project Structure

```text
specs/766-cloud-rest-fallback/   spec, context, design, plan, checklists/, tasks, notion-sync, auto-run
.claude/scripts/lib/gh-rest.mjs        new: isCloud, ghRun (sync, {code,stdout,stderr}), ghSync (execFileSync semantics)
.claude/scripts/lib/gh-rest.spec.mjs   new
.claude/scripts/gh.mjs                 new CLI: node .claude/scripts/gh.mjs <gh args>
.claude/scripts/lifecycle.mjs          exec(): gate the original gh command, then ghRun
.claude/scripts/lifecycle.spec.mjs     cloud cases
.claude/hooks/pr-lifecycle-gate.mjs    readPr(branch, cwd, sync = ghSync) exported; readState uses it
.claude/hooks/pr-lifecycle-gate.spec.mjs  cloud case
.claude/scripts/notion-sync.mjs        defaultGh through ghSync
scripts/cloud-setup.sh                 Node 24 lookup + PATH line; chromium
.claude/scripts/cloud-setup.spec.mjs   new cases; uid-independent
AGENTS.md                              "Cloud sessions"
```

## Design notes

- **Detection**: `env.CLAUDE_CODE_REMOTE === "true"`; anything else calls `run("gh", args)` unchanged.
- **REST call**: `run("gh", ["api", "-X", M, "repos/{owner}/{repo}/<path>", ("--input", "-")], { input })`; lists use `--paginate --slurp` and are flattened. A non-zero exit becomes gh's exit 1 with gh's stderr.
- **PR selector**: a number, a `/pull/<n>` URL, or a branch (`pulls?head={owner}:<branch>&state=all`, an open one first); none → the current branch (`git rev-parse --abbrev-ref HEAD`). No PR → `no pull requests found for branch "<b>"`, exit 1.
- **Fields** (GraphQL names): number, title, body, url, state (`OPEN`/`CLOSED`/`MERGED`), isDraft, headRefName, headRefOid, baseRefName, author `{login}`, labels `[{name}]`, mergeable (`MERGEABLE`/`CONFLICTING`/`UNKNOWN`), mergeCommit `{oid}`, comments (`issues/<n>/comments`, every page: `{author:{login}, body, createdAt}`), commits (`pulls/<n>/commits`: `{oid, authors:[{login,email,name}]}`), statusCheckRollup (head `check-runs` as `CheckRun {name,status,conclusion}` upper-cased, plus `status` as `StatusContext {context,state}`). Only the asked fields are fetched and printed.
- **`--jq`/`-q`**: a plain path (`.a`, `.[0].b`) evaluated in JS, printed raw like gh; anything else piped to `jq -r`.
- **Writes**: create `POST pulls` (+ `POST issues/<n>/labels`), prints the html_url; edit `PATCH pulls/<n>` (title/body), `POST`/`DELETE` labels (404 on delete ignored); ready `POST pulls/<n>/ccr/ready_for_review`; comment `POST issues/<n>/comments`; `label create` `POST labels`, on 422 `--force` → `PATCH labels/<name>`, else exit 1.
- **Checks**: gh's buckets (pass, fail, pending, skipping, cancel), `--json name,bucket,state,link,workflow` plus `--jq`; exit 8 pending, 1 failed or nothing reported, 0 otherwise; `--watch` polls every 10 s (injected `sleep`) until nothing is pending. Without `--json`, tab-separated `name\tbucket\tlink` lines like gh's non-tty output.
- **Lifecycle**: `exec` gates `gh …` as today, then `ghRun(args, { run: io.run with env, env })`.
- **Gate**: `readPr` returns `{ pr }`, `{ pr: null }` on "no pull requests found", or `null` (fail open) on any other error; `withCommitters` keeps its `gh api` passthrough.
- **cloud-setup.sh**: before installing, look for `node` 24 in `$NVM_DIR`, `~/.nvm`, `/opt/nvm` (`versions/node/v24*/bin`) and `/usr/local/bin`, `/usr/bin`; after any install look again; put the found directory first; write `export PATH="<dir>:$PATH" # cloud-setup: node 24` as the first line of `~/.bashrc` (replacing an older marked line; first, because a non-interactive guard would otherwise skip it) and to `$CLAUDE_ENV_FILE` when set. After `npm ci`, read chromium's `revision` from `node_modules/playwright-core/browsers.json`; when `chromium-<r>` or `chromium_headless_shell-<r>` is missing under `${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}`, run `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= npx playwright install chromium`.

## Complexity Tracking

None.
