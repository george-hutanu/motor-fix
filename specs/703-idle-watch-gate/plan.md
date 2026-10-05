# Implementation Plan: Idle watch tick without a model turn

**Branch**: `703-idle-watch-gate` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

Add `--gate` and `--wait` to `.claude/scripts/watch.mjs`, both built on the
existing `collect()`; move the no-agent fix selection out of `applyFixes` into
one function both the fixer and the gate read, so their verdicts cannot drift.
Rewrite the watch skill's scheduling around one background `--wait`, update
the AGENTS.md bullet and the session-start reminder, and measure an idle tick
before and after from real transcripts.

## Technical Context

**Language/Version**: Node ESM scripts (`.mjs`), Node as in `package.json` engines; no new dependency.
**Testing**: vitest harness specs (`npm run test:harness`, `.claude/vitest.config.ts`): `watch.spec.mjs` fixtures (temporary git repos, injected `gh`, `alive`, `now`), `session-watch-reminder.spec.mjs`.
**Target**: the orchestrating Claude Code session on the main checkout.
**Constraints**: `watch.mjs` `main()` stays synchronous; the wait sleeps with `Atomics.wait` (injectable `sleep`) so tests run on a fake clock. Bash `run_in_background` ends a command at its `timeout` (max 7,200,000 ms); `Monitor` caps at 1,800,000 ms (both from the tool definitions in this session).
**Scale**: one wait per repository; one `gh pr list` per poll, every 15 minutes.

### Mechanism (measured)

Method: `scratchpad/ticks.mjs` reads `~/.claude/projects/-Users-georgehutanu-projects-motor-fix/*.jsonl`, groups assistant `message.usage` by the user turn that started it (deduplicated by message id), and reports calls, `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` and `output_tokens` per turn.

| Mechanism | Per idle 15 min | Wakes per idle 2 h |
| --- | --- | --- |
| Cron prompt `/speckit-watch` (today) | one full pass: 4–6 calls, cache write 49k–142k, cache read 430k–581k, output 1.8k–4.1k (scheduled turns, 06:45Z, 13:25Z, 18:56Z) | 8 |
| Cron prompt whose first step is the gate | still one model turn re-reading the session per tick | 8 |
| `Monitor` on a gate loop | none, but it expires at 30 min and re-arming is a turn | 4 |
| Scheduled task running the gate | a fresh session each run (cold context) | 8 |
| **Bash `run_in_background` on `watch.mjs --wait`** | **none** | **1** (the re-arm at 110 min) |

A background-task completion turn measured in this repo: 1 call, cache write 0.6k–1.8k, cache read 36k–190k, output 38–114. The chosen mechanism is re-measured on a real `--wait` run in this session (T-measure) and the PR body carries both.

## Constitution Check

- I No Bloated Code: two flags and three small functions in the existing script; no new file, dependency or config. The no-agent selection is moved, not copied. Pass.
- II Test Discipline: harness specs first (gate on a clean fixture and each stale kind, parity with `--fix --json`, wait on a fake clock, lock takeover, reminder silence). Pass.
- VII Lifecycle: draft PR #143, Notion ST-703 linked. Pass.

## Project Structure

```text
.claude/scripts/watch.mjs                     # dueFixes(), gateLines(), waitFor(), waitHolder(); --gate, --wait in main()
.claude/scripts/watch.spec.mjs                # new describe blocks
.claude/hooks/session-watch-reminder.mjs      # new line; silent when a wait is armed
.claude/hooks/session-watch-reminder.spec.mjs
.claude/hooks/registry.json                   # fingerprint via doctor --bless-hooks
.claude/skills/speckit-watch/SKILL.md         # scheduling, step 1, empty pass
AGENTS.md                                     # watch bullet
```

### Design

- `dueFixes(report)` returns the no-agent actions `applyFixes` would take, in its order (unlock dead holders, unlock/remove finished clean worktrees, carry reviews, unlock orphan locks, prune); `applyFixes` iterates it. The gate is `report.plan` plus `dueFixes(report)`: one line each, `<fix> <path>` (`#<pr>` when known).
- `--gate`: exit 0 and no output when both are empty, else exit 2 and the lines. Errors exit 1.
- `--wait [--every 15] [--for 110] [--stale …]`: take the record `<git common dir>/speckit-watch-wait.pid` (refused while `waitHolder` finds a live `watch.mjs --wait` there), then `sleep(every)` and gate while `elapsed + every <= for`; remove the record on every ending (`try/finally`).
- `waitHolder(repo, { commandOf })`: the pid in the record if `ps -o command=` for it contains `watch.mjs` and `--wait`, else null. The reminder imports it and stays silent when it returns a pid.
- Skill: arm with Bash `run_in_background: true`, `timeout: 7200000`, command `node .claude/scripts/watch.mjs --wait`; endings keyed on the printed line; delete an existing `/speckit-watch` cron job (CronList, CronDelete) once the wait is armed; one pass right away as today.

## Complexity Tracking

None.
