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
| 6 | speckit-auto runs independent phases at once: Notion context beside clarify's challenger; ticket refresh, agent context and retro evidence beside review | Medium | – | Same inputs |
| 7 | Autocompact at 20% of the window instead of 40% | – | Medium: sessions peaked at 170–220k and never compacted | Same: `pre:compact:flush` and speckit-auto's recovery keep the run state |
| 8 | Pre-commit runs `nx affected` typecheck and test from the merge base with `origin/main`, plus lint; speckit-auto preflight goes through Nx and the cache. Affected integration specs run against the worktree's own PostgreSQL and Redis, started and migrated by the hook (~15 s cold, ~3 s warm); `JEST_SUITE` is refused | 1–2 min per commit | – | Same scope as PR CI; `release.yml` still runs everything |
| 9 | Local compose uses `imresamu/postgis:17-3.5` (multi-arch, same PostGIS) | High: no amd64 emulation, no `exec format error` | Fewer retry turns | Same database; CI keeps `postgis/postgis` |

## Left for later

- Split a story's agent at the hand-off (a fresh agent for ready → CI → QA →
  merge): roughly halves the context of the expensive tail. It changes how
  speckit-auto ends its turn, so it gets its own PR.
- A deferred-only commit (`deferred.md` URLs after `speckit-notion-sync debt`)
  forces one more full tester lap. A docs-only head could reuse the previous
  verdict; that is a merge-gate rule change, so its own PR.

## Not doing

- A shared Nx cache: Nx 23 already shares one per user across worktrees
  (`~/.nx/<workspace hash>`), and setting `NX_CACHE_DIRECTORY` would turn that
  sharing off. Found by the PR tester, lap 1.
- Checklist and analyze in parallel: analyze should read the finished checklist.
- Path-filtering CI's Docker builds: a filter that misses an input lets a
  broken image through to release.
- Moving the PR tester or implementation to a cheaper model.
- Speeding up `session:start:watch-reminder` (5 s once per session start): not
  worth a gate change.
- Trimming unused MCP servers: deferred tools cost only their names.
