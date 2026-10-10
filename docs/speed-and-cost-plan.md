# Speed and cost plan for the delivery lifecycle

Measured on 2026-10-05 from one day of sessions: ~1,100 tool calls, 5.8 h of
tool time and 1,060 model turns. Hooks cost 50–100 ms each and are not the
bottleneck. The time went into waiting (CI, Docker, polling loops) and into
work done twice. 94% of turns ran on Opus, mostly re-reading 115–140k tokens
of context, and no session ever reached the autocompact point.

Rule for every item: no check is removed, only moved, deduplicated or made
cheaper. Anything that writes or judges business logic keeps its model.

## Done in this PR

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 1 | Merge gate also needs CI: refuses while the latest run of any check fails or runs, or `CI OK` is missing (`merge-gate.mjs`, spec, evals) | – | – | Raises it. "CI green" lived only in skill text, and `main` has no branch protection |
| 2 | QA starts when the PR goes ready, beside CI (Constitution VII v1.7.0, AGENTS.md steps 5–6, speckit-auto hand-off, speckit-pr-test, `watch.mjs` dispatching `rerun-qa` while CI runs) | ~10 min per PR | – | Same: the merge needs both, and #1 enforces it |
| 3 | PR tester leaves unit and e2e suites to CI (`run.mjs` runs them only with `--tests`) | ~5–10 min of a heavy slot per lap | Less log read | Same: CI runs both on the merge result |
| 4 | Wait for CI in the background (`run_in_background`), never a foreground `sleep` loop | Agent keeps working | Fewer idle turns | – |
| 5 | `pr-tester` pinned to `model: opus`; speckit-watch dispatches `merge` fixes on Sonnet; an empty watch pass ends after one line | – | High | Implementation and every verdict stay on Opus or Fable |
| 6 | speckit-auto runs independent phases at once: story context beside clarify's challenger; ticket refresh, agent context and retro evidence beside review | Medium | – | Same inputs |
| 7 | Autocompact at 20% of the window instead of 40% | – | Medium: sessions peaked at 170–220k and never compacted | Same: `pre:compact:flush` and speckit-auto's recovery keep the run state |
| 8 | Pre-commit runs `nx affected` typecheck and test from the merge base with `origin/main`, plus lint; speckit-auto preflight goes through Nx and the cache. Affected integration specs run against the worktree's own PostgreSQL and Redis, started and migrated by the hook (~15 s cold, ~3 s warm); `JEST_SUITE` is refused | 1–2 min per commit | – | Same scope as PR CI; `release.yml` still runs everything |
| 9 | Local compose uses `imresamu/postgis:17-3.5` (multi-arch, same PostGIS) | High: no amd64 emulation, no `exec format error` | Fewer retry turns | Same database; CI keeps `postgis/postgis` |

## Done since: agent replies and reads

Measured from session transcripts: 97% of token cost is context (cache read
58%, cache write 39%), output 3%; the median turn carries 106k tokens (p90
169k). Task agents are 69% of spend, the PR tester 17%.

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 10 | One reply envelope (`STATUS`, `PR`, `NEXT`, `FILES`) for every agent and dispatched task agent, 25 lines at most, long reports in a named file (AGENTS.md "Agent replies", `agent-replies.spec.mjs`) | – | Every reply is re-read on each later turn of its caller | Same: `VERDICT:` lines and tables kept for their parsers |
| 11 | Reads only what decides the next step: CI waits print the non-passing checks, failing jobs `--log-failed \| tail -n 80`, test runs their summary and failures | – | Less log in context | Same: every check still runs |
| 12 | The ready refresh and its read-only tracker reads on Sonnet; watch dispatches that only move state on Sonnet | – | Medium | Implementation, reviewers and the PR tester keep their models |
| 15 | A head that differs from the last tested commit by documentation only (`scripts/docs-only.ts`) carries its `agent-review` success instead of a new tester lap (`pr-test/carry.mjs`, speckit-pr-test step 2, `watch.mjs` fix `carry-review`); the merge gate re-checks the named commit's success, its ancestry and the docs-only diff before it merges (spec, evals) | One tester lap per story (the `deferred.md` URLs commit) | One Opus lap | Same: a carry never crosses a code change or a failing verdict, and the gate verifies it rather than trusting it |

## Done since: the tail hand-off

A story's agent reaches about a million input-token-equivalents by ready, and
92 full-context cache rewrites (40% of cache writes) were mostly CI waits and
QA laps re-read after a >5 min idle gap (74% of them, median 9 min).

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 13 | Split a story's agent at the hand-off: `/speckit-auto` ends at ready with `specs/<feature>/handoff.md` and `NEXT: tail #<n>`; a fresh tail agent (Opus) runs CI, QA laps, the merge and the finish; `/speckit-watch` has a `tail` fix for a handed-off PR nobody holds | Same | The tail re-reads a note, not the story's whole context, on every wait and lap | Same: every step and check of Constitution VII kept, the tail on the same model |
| 14 | Finish logs in the story's own PR: records committed before ready, post-merge lines in a comment on the merged PR (`tracker/ready.mjs check -` reads it) | One PR fewer per story | No `docs(specs)` PR, its CI and its QA lap per story | Same: the archive check still refuses a feature without the refresh |

## Done since: CI under the free plan's runner cap

Measured on 2026-10-06 over the last 40 CI runs: GitHub's free plan allows 20
concurrent jobs per account, and every long evening wait (up to 30 min for a
runner) began while 18–27 of our own jobs were running. Other Node versions or
runner labels do not help: CI runs only Node 24 (`.nvmrc`), and every label
counts toward the same cap. Baseline run 37454922580: 14 jobs, 7 workspace
installs, CI OK at 675 s, of which E2E 629 s on one Playwright worker.

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 16 | `ci.yml` from 14 jobs to 7 runners (Checks, Unit and integration tests, E2E tests, Docker build web and api, Changes, CI OK) with 3 installs; E2E on 4 Playwright workers; `release.yml` runs one release check at a time and its `images` job writes the Docker layer cache PRs read | Run 37492214599: CI OK at 389 s (from 675 s), E2E 305 s (from 629 s), 3 installs | Half the runners per push, so fewer evening waits | Same checks, each still named in the log; a test that passes only on a retry now fails PR CI |

## Left for later

- Nothing open: the tail hand-off and the docs-only carry are both done.

## Not doing

- A shared Nx cache: Nx 23 already shares one per user across worktrees
  (`~/.nx/<workspace hash>`), and setting `NX_CACHE_DIRECTORY` would turn that
  sharing off. Found by the PR tester, lap 1.
- Checklist and analyze in parallel: analyze should read the finished checklist.
- Running E2E only after the merge: nothing else runs it before `main`, and a
  red `main` blocks every release.
- Path-filtering CI's Docker builds: a filter that misses an input lets a
  broken image through to release.
- Moving the PR tester or implementation to a cheaper model.
- Speeding up `session:start:watch-reminder` (5 s once per session start): not
  worth a gate change.
- Trimming unused MCP servers: deferred tools cost only their names.
