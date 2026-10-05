# Speed and cost plan for the delivery lifecycle

Measured on 2026-10-05 from one day of sessions: ~1,100 tool calls, 5.8 h of
tool time and 1,060 model turns. Hooks cost 50–100 ms each and are not the
bottleneck. The time went into waiting (CI, Docker, polling loops) and into
work done twice. 94% of turns ran on Opus, mostly re-reading 115–140k tokens
of context.

Rule for every item: no check is removed, only moved, deduplicated or made
cheaper. Anything that writes or judges business logic keeps its model.

## In this PR

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 1 | Merge gate also needs CI: refuses while any check fails or runs, or `CI OK` is missing | – | – | Raises it. "CI green" used to live only in skill text, and `main` has no branch protection |
| 2 | Autocompact at 20% of the window instead of 40% (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in `.claude/settings.json`) | – | Medium: sessions peaked at 170–220k tokens and never compacted at 40% | Same: `pre:compact:flush` and speckit-auto's compaction recovery keep the run state |
| 3 | Local compose uses `imresamu/postgis:17-3.5` (multi-arch, same PostGIS version) | High: no amd64 emulation, no `exec format error` | Fewer retry turns | Same database. CI keeps `postgis/postgis` |

## Next, once the owner approves editing the harness

These touch `.claude/` (agents, skills, the PR tester's script). The auto-mode
classifier stops an agent from editing its own harness without the owner's OK.

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 4 | PR tester leaves unit and e2e tests to CI (`run.mjs` tests off by default, `--tests` to opt in) | ~5–10 min of a heavy slot per lap | Less log text read | Same: CI runs both on the merge result, and #1 enforces it |
| 5 | QA starts when the PR goes ready, beside CI (AGENTS.md steps 5–6, speckit-auto hand-off, speckit-pr-test) | ~10 min per PR | – | Same: merge needs both |
| 6 | Wait for CI and task output in the background (`run_in_background` or Monitor), never `until …; sleep` in the foreground | Agent keeps working | Fewer idle 140k-token turns | – |
| 7 | Quiet `/speckit-watch`: a pass with an empty plan does nothing more | – | High | – |
| 8 | Pin `model: opus` on pr-tester. Run chores with no business logic (Dependabot, image bumps, Notion sync, agent-context refresh) on Sonnet | – | High | Judgement and implementation stay on Opus or Fable |
| 9 | Split a story's agent at the hand-off: a fresh agent for ready → CI → QA → merge | – | ~half the tail's context | Same |
| 10 | speckit-auto runs independent phases at once: Notion context beside specify and clarify; ticket refresh, agent context and retro evidence beside review | Medium | – | Same inputs |

## Next, outside `.claude/`

| # | Change | Speed | Cost | Quality |
|---|---|---|---|---|
| 11 | Share one Nx cache across worktrees (`NX_CACHE_DIRECTORY` in `scripts/heavy.sh` and `.husky/pre-commit`) | High: worktrees stop rebuilding from cold | – | A hit is the same output for the same inputs |
| 12 | Pre-commit runs `nx affected` (base `origin/main`) instead of `run-many`; speckit-auto preflight likewise | 1–2 min per commit | – | Same scope as PR CI. Release still runs everything |
| 13 | `session:start:watch-reminder` counts worktrees cheaply before running `watch.mjs` | 5 s per session start | – | – |
| 14 | Disable the MCP servers this repo does not use (Chrome DevTools, Claude in Chrome, iOS simulator, demo server) in `.claude/settings.local.json` | – | A few thousand tokens per turn | – |

## Not doing

- Checklist and analyze in parallel: analyze should read the finished checklist.
- Path-filtering CI's Docker builds: a filter that misses an input lets a broken image through to release.
- Moving the PR tester or implementation to a cheaper model.
