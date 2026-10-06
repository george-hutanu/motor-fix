# Quickstart — 678-measurable-sizing

How to prove each slice works. Shapes are in [data-model.md](./data-model.md);
decisions in [research.md](./research.md). All commands from the worktree root.

## Prerequisites

`npm ci` done once (vitest `^5.0.3`); `git fetch origin` so `origin/main`
resolves; `NOTION_TOKEN` in the environment or `.env` only for slice 4's
live path (the tests inject a fetch and need none).

## The whole suite

```bash
npm run test:harness > /tmp/harness.log 2>&1; echo "exit $?"; tail -n 20 /tmp/harness.log
node .claude/scripts/doctor.mjs --bless-hooks   # once, after the session-telemetry.mjs diff is reviewed
node .claude/scripts/doctor.mjs
node .claude/scripts/harness-eval.mjs --check
```

Expected: exit 0 each; `doctor` reports every gate matching its fingerprint.

## Slice 1 — the ledger

1. In a session on a feature branch, end a turn (the Stop hook fires), then
   read `.specify/telemetry/<session>.json`: `level`, `phase`, one
   `buckets["<level>/<phase>"]` entry, and `subagents` with one entry per
   `agent-*.jsonl` the session dispatched, `agent_type` set.
2. `node .claude/scripts/telemetry.mjs --by-level`: per level the totals with
   the subagent share beside them, per phase under it, per feature its level
   and total; old ledgers under `unknown level`; `too heavy` features listed.
   Exit 0 with no ledgers.

Spec: `telemetry.spec.mjs` — a session transcript plus a `subagents/` folder
with one streamed transcript (three lines, one `message.id`) and its meta file;
the hook spawned twice (second time after a level change) shows two buckets and
the message counted once.

## Slice 2 — tripwires

```bash
node .claude/scripts/level.mjs check            # one line per wire, promotion if any
node .claude/scripts/level.mjs check --json
```

Spec: `level.spec.mjs` — a temporary repo at level 1 with a local `origin`;
for each wire one case with the fact (level becomes 2, `auto-run.md` gains the
line) and one without (level stays 1, no file); a level 3 repo trips nothing
and stays 3; a repo without `origin/main` reports the diff wires `not checked`.

## Slice 3 — pre-ready

```bash
node .claude/scripts/level.mjs check --ready --json; echo "exit $?"
```

Exit 2 with `missing: ["plan.md"]` for a promoted level 1 whose directory has
no `plan.md`; exit 0 once it exists. At level 2 with a one-file non-contract
diff: exit 0 and `.specify/telemetry/pending.json` holds the mark, which the
next Stop moves into the ledger. `lifecycle.mjs ready` stops with
`stopped: "level check"` on exit 2 and the PR stays a draft
(`lifecycle.spec.mjs`, stubbed `node` call).

## Slice 4 — sizing from Notion

```bash
node .claude/scripts/level.mjs suggest ST-678
node .claude/scripts/level.mjs suggest https://app.notion.com/p/<32-hex>
NOTION_TOKEN= node .claude/scripts/level.mjs suggest ST-678   # fallback line, then today's path
```

Expected: a `facts:` line, then `level … suggested by notion …` or
`unsure (…)` followed by today's output; with Notion unreadable, one
`notion not read (…)` line and output byte-identical to
`suggest "ST-678"`. Spec: `level.spec.mjs` calls `suggestCommand` with a
`fetchImpl` returning each shaped page (Bug without boards and a complete
brief → 1, no Jev call; boards → ≥ 2; empty section → ≥ 2; points 8 → ≥ 2;
Story, no boards, complete brief → unsure) and one that throws.
