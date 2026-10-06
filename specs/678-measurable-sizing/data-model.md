# Data model — 678-measurable-sizing

Files and in-memory shapes only; no database. `tokens` everywhere means
`{ input, output, cache_read, cache_creation }` (integers, as today's
`emptyRecord().tokens`).

## Session ledger — `.specify/telemetry/<session_id>.json`

Today's record (`lib/telemetry.mjs:12-24`) plus:

| Field | Type | Meaning |
| --- | --- | --- |
| `level` | `0..3 \| null` | level of the last write (`featureLevel` of the active feature) |
| `phase` | string | phase of the last write (`run-state.json` phase, or `none`) |
| `buckets` | `{ "<level>/<phase>": { tokens, subagent_tokens } }` | tokens folded in while that pair was current; `subagent_tokens` is the part of `tokens` that came from subagent transcripts |
| `subagents` | `{ "<file name>": { agent_type, bytes_read, last_message_id } }` | one entry per `agent-<id>.jsonl`, the read offset and the id last counted |
| `subagent_tokens` | `{ "<agent_type>": tokens }` | totals per agent type (`unknown` when the meta file is missing) |
| `last_message_id` | `string \| null` | the session transcript's id last counted |
| `too_heavy` | `[{ feature, level, file, at }]` | marks moved in from `pending.json` |

Invariants: `tokens` (the session total) = sum of `buckets[*].tokens` for a
ledger created after this change (SC-001); `subagent_tokens` summed over types
= sum of `buckets[*].subagent_tokens`; a bucket key for a level 0 change is
`0/none` (no feature, no run). Old ledgers lack every new field; readers treat a
missing `buckets` as "unknown level".

## Pending mark — `.specify/telemetry/pending.json` (transient)

`{ "too_heavy": [{ feature, level, file, at }] }`, written by
`level.mjs check --ready`, consumed and deleted by the next Stop. Git-ignored.

## Tripwire result (in memory; `check --json`)

```json
{
  "feature": "specs/678-measurable-sizing" | null,
  "level": 1, "promoted": { "from": 1, "to": 2 } | null,
  "wires": [
    { "name": "fr-count",      "state": "tripped|clear|not checked", "fact": "7 functional requirements" },
    { "name": "clarification", "state": "…", "fact": "[NEEDS CLARIFICATION: …]" },
    { "name": "contract",      "state": "…", "fact": "libs/contracts/src/x.ts" },
    { "name": "projects",      "state": "…", "fact": "api, web" }
  ],
  "owed": ["context", "clarify", "plan", "checklist", "analyze", "converge", "refresh", "agent-context", "archive"],
  "missing": ["plan.md"],
  "too_heavy": { "feature": "…", "file": "apps/web/src/x.ts" } | null
}
```

`owed` and `missing` are present only with `--ready` after a promotion;
`too_heavy` only with `--ready` at level 2. Exit 2 iff `missing` is non-empty.

## Promotion line — `specs/<feature>/auto-run.md`

`- <ISO time> · level <old> → 2 · <wire>: <fact>`, one per promotion, appended.

## Notion sizing facts (in memory; printed by `suggest`)

| Fact | Source | Decides |
| --- | --- | --- |
| `type` | `Issue type` (select) | Bug rule |
| `labels` | `Labels` (multi-select names) | nothing |
| `design` | `Design` (rollup) | nothing |
| `boards` | `Design boards` (rollup): set when its array is non-empty | ≥ 2 |
| `points` | `Story points` (number) when present | ≥ 2 when > 5 |
| `brief` | `heading_3` sections under the `Build brief` heading: `{ name, filled }`; `not found` when the heading is absent | ≥ 2 when any is not filled |
| `title`, `text` | page title; brief text | input to `classifyLevel` |

Verdict: `{ level, confidence: 0.8, by: "notion", reason }` or
`{ unsure: true, reason }`; a rule never lowers the classifier's answer.

## Constants — `lib/feature.mjs`

`FR_THRESHOLD = 5` (trips above), `STORY_POINTS_THRESHOLD = 5` (trips above),
`CONTRACT_PATHS = [/^libs\/contracts\//, /^libs\/data-access\//, /^apps\/api\/openapi\.json$/, /schema\.prisma$/, /\/migrations\//]`.
