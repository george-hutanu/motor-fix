**Agent review: failure** — PR #147 at `011143c`, lap 3

Blocking: 2 (blocker 0, high 2) · medium 1 · low 1. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37452566426): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- No API operation changed.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | flow not run: Story 1, detect names the missing id, add <id> lists it, check and detect then exit 0, a second add changes nothing |  | .specify/.cache/qa-flows-147.mjs:13: const check = run('check'); |
| 2 | high | flow not run: Story 4, doctor.mjs reports a stale Notion list as a warn |  | .claude/scripts/doctor.mjs:321: return [...checkHooks(repo), ...checkFeatureState(repo), ...checkSkillsAndAgents(repo), ...checkNotionTools(repo), ...checkCommands(repo)]; |
| 3 | medium | add writes the agent files before it checks settings.json, so an invalid settings.json leaves the agents and the allowlist out of step |  | .claude/scripts/notion-agent-tools.mjs:143: const settings = readAllow(repo);   if (settings?.error) throw new Error(settings.error); |
| 4 | low | detect returns a `seen` list no caller reads (CLI and doctor use only missing and note); only a test asserts it |  | .claude/scripts/notion-agent-tools.mjs:228: return { seen: ids, missing: ids.filter((id) => !have.has(id)).sort(), note: `${files} transcript(s) read` }; |

### Reproduction
1. Open .specify/.cache/qa-flows-147.mjs → It runs only `check` and `add mcp__x__Bash` (refusal); it never runs `detect`, a successful `add <id>` on a copy of the agents, or the repeat `add` no-op from Story 1's acceptance
2. Open .specify/.cache/qa-flows-147.mjs → No step runs `node .claude/scripts/doctor.mjs` and checks the agents/notion-tools result (ok on the head, warn with an `add <id>` hint when a transcript carries an id the agents lack)
3. Seed both Notion agents and a settings.json that is not JSON → Run `node .claude/scripts/notion-agent-tools.mjs add <new id>`: it exits 2, but both agent files already carry the new id and `check` now fails → Read settings first and throw before any write; the adversary test only asserts the throw, not that the agents are untouched
4. grep for `.seen` outside the specs: none

Screenshots: 32, one per route × viewport × scheme × language.
