# Implementation Plan: Measurable, self-correcting sizing

**Branch**: `678-measurable-sizing` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/678-measurable-sizing/spec.md`; `context.md` (ST-678, epic EP-1 Foundations); `design.md` (no screens).

## Summary

Make the process level observable and self-correcting inside the harness only.
Four slices, each usable alone, in this order:

1. **Ledger.** The Stop hook buckets each write's new tokens under the active
   feature's `(level, phase)`, folds the session's `subagents/*.jsonl`
   transcripts (once per `message.id`, by `agentType`) into the same record,
   and `telemetry.mjs --by-level` reports tokens per level, phase and feature.
2. **Tripwires.** `level.mjs check` evaluates four wires (FR count, open
   clarification, contract/schema/migration file, more than one Nx project) and
   raises a level 0/1 to 2, logging one line in `auto-run.md`; `/speckit-auto`
   runs it after specify, clarify and tasks and then runs the owed phases.
3. **Pre-ready check.** `lifecycle.mjs ready` runs `level.mjs check --ready`
   first: a promoted level 0/1 with `plan.md` missing stops the step (PR stays
   a draft); a level 2 whose diff is one non-contract file leaves a
   `too heavy` mark that the Stop hook folds into the session ledger.
4. **Sizing from Notion.** `level.mjs suggest ST-<n>|<story URL>` reads the
   story's properties and Build brief through the existing `lib/notion.mjs`
   client and applies three rules before any Jev or model call; any Notion
   failure prints one line and falls back to today's text path.

No new dependency, no new hook, no new ledger: the existing Stop hook stays the
only ledger writer; `level.mjs` gains two commands; `lifecycle.mjs ready` gains
one call. Research decisions and evidence: [research.md](./research.md).

## Technical Context

**Language/Version**: JavaScript ESM (`"type": "module"`, package.json:106) on Node 26.5.0 (`node -v` on the branch); no TypeScript or build step for `.claude/` (`.claude/vitest.config.ts` comment: "plain ESM with no build step").

**Primary Dependencies**: Node built-ins only (`node:fs`, `node:child_process`, `node:path`, `node:util`); Notion through the harness's own `fetch` client `.claude/scripts/lib/notion.mjs` (API version `2026-03-11`, notion.mjs:11); no SDK.

**Storage**: files — `.specify/feature.json` (level), `.specify/run-state.json` (phase), `.specify/telemetry/<session>.json` (ledgers, git-ignored by `.gitignore:13`), `specs/<feature>/auto-run.md` (promotion lines), a transient `.specify/telemetry/pending.json` hand-off from a script to the Stop hook.

**Testing**: vitest `^5.0.3` (package.json:77) through `npm run test:harness` (`vitest run --config .claude/vitest.config.ts`, package.json:99); specs beside their source (`level.spec.mjs`, `telemetry.spec.mjs`, `lifecycle.spec.mjs`); the Stop hook is exercised by spawning it with a payload, as `telemetry.spec.mjs` already does.

**Target Platform**: the developer machine and the GitHub runner that runs `Harness` in CI; macOS paths today (`~/.claude/projects/<project>/<session>/subagents/`), nothing OS-specific in the code.

**Project Type**: harness scripts and one Claude Code hook (`.claude/scripts/`, `.claude/hooks/`); skill text under `.claude/skills/`.

**Performance Goals**: the Stop hook keeps its incremental read (byte offsets per transcript, `session-telemetry.mjs:20-31`); one Stop reads only appended bytes of the session transcript and of each subagent transcript. `check` runs one `git diff --name-only` and reads `spec.md`.

**Constraints**: every Stop-hook failure path exits 0 (FR-004); counts and token totals only, never message text; `check` never lowers a level and never promotes above 2; a Notion failure never blocks (`suggest` exit 0, FR-013); editing `session-telemetry.mjs` fails `doctor.mjs` until `node .claude/scripts/doctor.mjs --bless-hooks` re-records its fingerprint (`doctor.mjs:57`), to be run after the hook edit is reviewed.

**Scale/Scope**: six source files edited (`level.mjs`, `lib/feature.mjs`, `lib/telemetry.mjs`, `telemetry.mjs`, `hooks/session-telemetry.mjs`, `lifecycle.mjs`), three specs extended, four skill texts touched (`speckit-size`, `speckit-auto` SKILL.md + `phases-plan.md` + `hand-off.md`, `speckit-review`). Nothing under `apps/` or `libs/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new module for the wires (they live
  in `level.mjs`, which already owns the level), no new ledger (the Stop hook
  stays the only writer; the `too heavy` mark reaches it through one transient
  file), no new hook, no SDK; thresholds are constants beside `LEVELS`, not
  environment knobs; `STORIES` is imported from `notion-sync.mjs`, not copied.
  The one abstraction added, a shared transcript fold used for both the session
  and subagent transcripts, replaces what would otherwise be two copies.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing vitest specs
  first (FR-015: a promote and a leave-alone test per wire, a level-3 test, the
  refusal, the mark, the buckets, the report, each `suggest` rule and the
  fallback). Harness specs run on vitest beside their source; Jest, PostgreSQL,
  Redis and Playwright do not apply (no product code). No FR or task id in source.
- [x] **III. The Given Stack**: untouched; harness only.
- [x] **IV. One Repository, One Toolchain**: harness files only, Biome
  formatting, root vitest config for `.claude/`.
- [x] **V. Rules Live in One Place**: the level vocabulary and thresholds stay
  in `lib/feature.mjs`; the phase names stay `run-state.mjs`'s; Notion access
  stays `lib/notion.mjs`; the stories data source id stays `notion-sync.mjs`'s.
- [x] **VI. PostgreSQL Is the Truth**: not applicable (no product data).
- [x] **Notion choices**: no Architecture page governs harness scripts; the
  ST-662 rule (a wrong level errs toward more process; no level decides whether
  tests run) is honoured: `check` only raises, and FR-010 leaves every gate
  untouched. No T1–T10 item is touched.

**Post-design re-check**: unchanged. `research.md` R1–R9 each keep the first
alternative that is smaller; no Complexity Tracking entry is needed.

## Project Structure

### Documentation (this feature)

```text
specs/678-measurable-sizing/
├── spec.md              # clarified
├── context.md           # Notion digest
├── design.md            # no screens
├── plan.md              # this file
├── research.md          # Phase 0: decisions R1–R9 with evidence
├── data-model.md        # Phase 1: ledger record, wire result, facts, pending mark
├── quickstart.md        # Phase 1: how to prove each slice works
└── tasks.md             # Phase 2 (/speckit-tasks)
```

No `contracts/`: the only interfaces are three CLI commands inside the harness
(`level.mjs check`, `level.mjs suggest ST-<n>`, `telemetry.mjs --by-level`),
whose shapes `data-model.md` and `quickstart.md` state; a separate contract
file would repeat them (Principle I).

### Source Code (repository root)

```text
.claude/
├── hooks/
│   └── session-telemetry.mjs        # + level/phase per write, subagents/ fold, pending mark fold → bless afterwards
├── scripts/
│   ├── level.mjs                    # + check [--ready] [--json]; suggest ST-<n>|<url>; suggestCommand() exported
│   ├── level.spec.mjs               # + tripwires, promotion log, suggest rules and fallback
│   ├── lifecycle.mjs                # ready(): calls level.mjs check --ready --json before the records commit
│   ├── lifecycle.spec.mjs           # + refusal (exit 2) and pass-through
│   ├── telemetry.mjs                # + --by-level report, byLevel()
│   ├── telemetry.spec.mjs           # + buckets, subagent fold, dedup, --by-level, unknown level, too heavy
│   └── lib/
│       ├── feature.mjs              # + FR_THRESHOLD, STORY_POINTS_THRESHOLD, CONTRACT_PATHS beside LEVELS
│       └── telemetry.mjs            # mergeTranscript(record, text, { bucket, agentType, transcript }); emptyRecord fields
├── skills/
│   ├── speckit-size/SKILL.md        # suggest ST-<n>: facts, rules, fallback
│   ├── speckit-auto/SKILL.md        # check after phases 2, 4, 7; promotion → run the owed phases
│   ├── speckit-auto/phases-plan.md  # the check call after specify, clarify, tasks
│   ├── speckit-auto/hand-off.md     # the ready refusal and what to do
│   └── speckit-review/SKILL.md      # ready may refuse: the owed phases
.specify/
└── telemetry/pending.json           # (new, transient, git-ignored) the too-heavy mark until the next Stop
```

**Structure Decision**: every change lands in a file that already owns the
concern. `level.mjs` owns the level (set, point, suggest) so it owns `check`;
`lib/feature.mjs` owns the level vocabulary so it owns the thresholds and paths
the wires read; `lib/telemetry.mjs` owns the fold and `session-telemetry.mjs`
the write; `lifecycle.mjs ready` owns the moment before a PR goes ready. Paths
confirmed by `ls .claude/scripts .claude/hooks .claude/skills/speckit-auto`.

## Design

### Slice 1 — the ledger

- `emptyRecord` gains `level`, `phase` (the last write's), `buckets`
  (`"<level>/<phase>"` → tokens and `subagent_tokens`), `subagents`
  (per transcript file: `agent_type`, `bytes_read`, `last_message_id`),
  `subagent_tokens` (per agent type), `too_heavy` (list). Shapes in
  `data-model.md`.
- `mergeTranscript(record, text, { bucket, agentType, transcript })` folds one
  transcript's new bytes: dedups by `message.id` against the transcript's
  `last_message_id` (streamed repeats are contiguous, R2), adds usage to
  `record.tokens`, to `record.buckets[bucket].tokens`, and, for a subagent, to
  `record.buckets[bucket].subagent_tokens` and `record.subagent_tokens[agentType]`.
  Tool, skill and agent counts are taken from the session transcript only.
- The hook computes the bucket once per Stop: level =
  `featureLevel(repo, activeFeature(repo)?.dir)`; phase = `run-state.json`'s
  `phase` when its `status` is not `done` and its `feature` is the active one,
  else `none` (R3). It then folds the session transcript from `bytes_read`,
  lists `dirname(transcript)/<session_id>/subagents/agent-*.jsonl` (R1), reads
  each `agent-<id>.meta.json` for `agentType` (`unknown` when missing or
  unreadable), folds each from its own offset, and finally moves any
  `.specify/telemetry/pending.json` marks into `record.too_heavy` and deletes
  the file (R6). Every step stays inside the existing try/exit-0.
- `telemetry.mjs --by-level`: `byLevel(records)` groups bucket totals by level,
  then by phase; per feature the highest level seen and its total; tokens not
  covered by buckets (old ledgers, or a ledger that straddles this merge) go to
  `unknown`; `too_heavy` marks are listed. Prints the same `k()` numbers the
  default report uses; exits 0 with "No telemetry yet" when there are no ledgers.

### Slice 2 — tripwires

- Constants in `lib/feature.mjs`: `FR_THRESHOLD = 5` (more than five FRs
  trips), `STORY_POINTS_THRESHOLD = 5`, `CONTRACT_PATHS` =
  `libs/contracts/`, `libs/data-access/`, `apps/api/openapi.json`,
  `schema.prisma`, `/migrations/` (spec Assumptions).
- `checkTripwires(repo)` in `level.mjs` returns `{ level, feature, wires,
  promoted, missing }`. Wires: `fr-count` (`^- \*\*FR-\d+\*\*` lines in
  `spec.md`), `clarification` (`[NEEDS CLARIFICATION`), `contract` (first
  changed path matching `CONTRACT_PATHS`), `projects` (names of the nearest
  `project.json` above each changed path; more than one trips). The changed
  paths are `git diff --name-only $(git merge-base origin/main HEAD)` (R4);
  when `merge-base` or the diff fails, both diff wires are `not checked`. With
  no feature directory (level 0) the spec wires are `not checked`.
- Promotion: when `level < 2` and any wire tripped, `setLevel(repo, 2)`
  (for the active feature; for a level 0 with no feature this records level 2
  for "next", which `/speckit-specify` inherits, R5) and, when a feature
  directory exists, append
  `- <ISO time> · level <old> → 2 · <wire>: <fact>` to its `auto-run.md`,
  creating the file. Levels 2 and 3 are never written. The same promotion
  cannot log twice because the second run sees level 2 (structural dedup).
- CLI: `node .claude/scripts/level.mjs check [--ready] [--json]` prints one
  line per wire (`tripped|clear|not checked`, fact) and the promotion if any;
  exit 0. With `--ready`: when the level was 0/1 and a wire tripped, lists the
  owed phases (SKILL.md's level-2-only phases) and the `LEVELS[2].artifacts`
  missing from the feature directory, and exits 2 while any is missing (a level
  0 has no directory: exit 2 with "run /speckit-specify first"); when the level
  is 2 and the diff outside `specs/` and `.specify/` is exactly one file not
  matching `CONTRACT_PATHS`, writes `{ too_heavy: [{ feature, level, file, at }] }`
  into `.specify/telemetry/pending.json` (appending to an existing list) and
  exits 0.
- `/speckit-auto` text: after phases 2, 4 and 7 run `node .claude/scripts/level.mjs check`;
  on `promoted` re-read the level and run the phases level 2 owes that have not
  run, in the run order (3, 4, 5, 6, 8 before 9; 11, 13, 15, 17 at their place).

### Slice 3 — pre-ready

- `lifecycle.mjs ready`: after `gh pr view`, `ctx.node([".claude/scripts/level.mjs", "check", "--ready", "--json"], [0, 2])`;
  code 2 → `throw new Stop("level check", <its stderr/stdout tail>)`, so the step
  returns `ok: false` and the PR stays a draft, before the records commit, the
  body publish and the Notion events. The `--notion-done` rerun runs the check
  again; it passes once `plan.md` exists.
- `lifecycle.spec.mjs` stubs the `node .claude/scripts/level.mjs check` call
  like the other `node` calls; the real check is tested in `level.spec.mjs`.

### Slice 4 — sizing from Notion

- `suggest` detects a story reference: `^ST-(\d+)$` or a Notion URL carrying a
  32-hex page id (the `storyPage` regex in `lifecycle.mjs:179`). It reads the
  token with `notionToken(repo, env)` (no token → fallback line), builds
  `notionClient({ token, fetchImpl, ...clientLimits(env) })`, queries
  `STORIES` by `ID` for an `ST-<n>` (as `notion-sync.mjs:149`) or `GET /pages/<id>`
  for a URL, then `GET /blocks/<page>/children` (paginated) for the body (R7).
- Facts: `Issue type`, `Labels`, `Design`, `Design boards`, `Story points`
  through `readProp`; a property is "set" when its plain value is a non-empty
  string, a non-empty array, a number, or a rollup whose `array` is non-empty.
  Build brief sections: the `heading_3` blocks after the heading whose text is
  `Build brief` up to the next `heading_1`/`heading_2`; a section is filled when
  at least one non-heading block with non-empty text follows it before the next
  heading. No `Build brief` heading → `brief: not found`, treated as empty.
- Rules (FR-012), in `sizeFromFacts(facts, classifier)`: text = title + brief
  text; `local = classifyLevel(text)`. Boards set, any empty or missing
  section, or points > `STORY_POINTS_THRESHOLD` → `max(local.level ?? 0, 2)`,
  by `notion`, confidence 0.8, reason naming the fact. Else `Issue type ===
  "Bug"` → `local.level >= 2 ? local : level 1` by `notion`, 0.8. Else
  `unsure` with the reason (`Story with no boards and a complete brief`) and
  today's path continues on the text (Jev, then the caller).
- Output: a `facts:` line (type, labels, design, boards, points, brief sections
  with ✓/✗), then exactly today's `level … suggested by …` or `unsure (…)`
  lines, so `--set` behaves as before. A `NotionError`, no token, or no page →
  one stdout line `notion not read (<short>): sizing from the text` and then
  the text path on the argument as given, byte-identical to `suggest "<text>"`.
- The inline suggest block moves into `export async function suggestCommand(argv, { repo, env, fetchImpl, out })`
  returning the exit code, so the spec can call it with a fake fetch and
  capture lines; the entry guard calls it.

### Skill text (FR-014)

`speckit-size`: the `suggest ST-<n>` form, what it reads, the three rules, the
fallback line. `speckit-auto/SKILL.md` and `phases-plan.md`: the check after
phases 2, 4, 7 and the owed-phases rule. `hand-off.md` and `speckit-review`:
`lifecycle.mjs ready` may stop with the owed phases; run them, then the rerun.
Lines about sizing and ready only.

### After the hook edit

`node .claude/scripts/doctor.mjs --bless-hooks` once the `session-telemetry.mjs`
diff is reviewed; then `node .claude/scripts/doctor.mjs`,
`node .claude/scripts/harness-eval.mjs --check` (no eval case covers the Stop
telemetry hook, `ls .claude/evals/cases`) and `npm run test:harness` must pass.

## Complexity Tracking

No violations to justify.
