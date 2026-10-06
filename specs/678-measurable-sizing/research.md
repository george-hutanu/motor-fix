# Research — 678-measurable-sizing

Every unknown in the plan's Technical Context, resolved from the repository or
the machine. No external library is involved, so no API doc was fetched; the
Notion API shape is the one `lib/notion.mjs` already uses (checked against
developers.notion.com on 2026-10-05, notion.mjs:2-4).

## R1 — Where a session's subagent transcripts are

- Decision: `join(dirname(payload.transcript_path), payload.session_id, "subagents")`,
  files `agent-<id>.jsonl` with a sibling `agent-<id>.meta.json` whose
  `agentType` names the agent.
- Rationale: the Stop payload already carries `transcript_path` and
  `session_id` (session-telemetry.mjs:38-39); the folder sits beside the
  session transcript under the same name.
- Alternatives: scanning `~/.claude/projects/` for the project — more I/O and
  a second way to find the project dir.
- Evidence: `~/.claude/projects/-Users-georgehutanu-projects-motor-fix/04ee46db-….jsonl`
  and `…/04ee46db-…/subagents/agent-a1f4b48460d0466b5.{jsonl,meta.json}`;
  the meta file reads `{"agentType":"general-purpose", …}`; transcript lines
  carry `type`, `message.usage`, `message.id` as the session's do.

## R2 — Counting a streamed message once

- Decision: keep `last_message_id` per transcript in the record and skip an
  `assistant` line whose `message.id` equals it; count the first occurrence's
  usage. Lines without an id are never deduplicated.
- Rationale: a streamed message's repeats are contiguous lines of one
  transcript, so one remembered id is enough and survives a Stop boundary
  (the partial-line rule, telemetry.mjs:37-39, keeps repeats on one side or
  the other but the id persists). Two agents never share an id (spec Edge
  Cases), so the memory is per file.
- Alternatives: a set of all ids per transcript — grows with the session for
  no gain; deduplicating only subagent transcripts — two code paths for one
  fold. The session transcript gets the same rule through the same function;
  the existing `telemetry.spec.mjs` fixtures carry no `message.id`, so their
  counts are unchanged.
- Evidence: story text ("a streamed message repeats one `message.id` over
  several transcript lines"); `lib/telemetry.mjs:37-73` (the fold to extend).

## R3 — Which level and phase a write is recorded under

- Decision: level = `featureLevel(repo, activeFeature(repo)?.dir)` from
  `lib/feature.mjs` (the hook already imports that file,
  session-telemetry.mjs:15); phase = `readState(repo).phase` from
  `run-state.mjs` when `status !== "done"` and the state's `feature` is the
  active feature's key, otherwise `none`.
- Rationale: `featureLevel` applies the same precedence every gate uses
  (env, then feature.json for that feature, then default; feature.mjs:98-114);
  `run-state.json` is where `/speckit-auto` writes the phase at each boundary
  (speckit-auto SKILL.md "Run state"); a finished or foreign run must not lend
  its phase to by-hand work.
- Alternatives: importing `resolveLevel` from `level.mjs` into the hook — a
  heavier import for the same number; a new "phase" marker — a second source.
- Evidence: `.specify/run-state.json` on this branch
  (`"status": "in-progress", "phase": "plan", "feature": "specs/678-measurable-sizing"`);
  `run-state.mjs:48-61` exports `statePath`, `readState`.

## R4 — The branch's diff against `origin/main`

- Decision: `git merge-base origin/main HEAD`, then
  `git diff --name-only <base>` (working tree against the merge base, so
  uncommitted implementation counts too). Either command failing marks both
  diff wires `not checked`.
- Rationale: `git diff origin/main` on a branch behind `main` would list
  `main`'s own changes; the merge base lists only what the branch did.
  `lifecycle.mjs:186` already relies on `origin/main` existing on a feature
  branch.
- Alternatives: `git diff origin/main...HEAD` — ignores uncommitted work that
  the ready step is about to commit (`lifecycle.mjs:238-239`).
- Evidence: `lifecycle.mjs:186`; spec FR-008 (a wire that cannot run neither
  promotes nor refuses).

## R5 — Recording a promotion

- Decision: `setLevel(repo, 2)` from `level.mjs`. For a feature on its branch
  this writes `level: 2, level_for: <feature>`; for a level 0 with no feature it
  writes `level_for: "next"` with a fresh `level_at`, which `/speckit-specify`
  hands to the directory it creates within the TTL. The `auto-run.md` line is
  `- <ISO time> · level <old> → 2 · <wire>: <fact>`, appended, file created if
  absent. Nothing is written for levels 2 and 3, so a rerun cannot log twice.
- Rationale: reuses the one writer of `feature.json` and its `level_for`
  semantics (level.mjs:92-106, feature.mjs:166-181); the spec's level-0 edge
  case asks exactly for "the next `/speckit-specify` inherits it".
- Alternatives: a `promotions` list in `feature.json` for dedup — unnecessary
  once promotion only happens below 2.
- Evidence: `level.mjs:92-106` (`setLevel`), `feature.mjs:166-181` (`pointTo`),
  spec Clarifications ("Where is a level 0 promotion recorded?").

## R6 — How the `too heavy` mark reaches the session ledger

- Decision: `level.mjs check --ready` writes the mark into
  `.specify/telemetry/pending.json` (a list under `too_heavy`); the Stop hook,
  which fires after the Bash call in the same session, moves the list into the
  session record's `too_heavy` and deletes the file. `--by-level` reads
  `too_heavy` from the records.
- Rationale: a script run from Bash does not know its session id, and the
  ledger must keep one writer (the hook) to avoid two processes rewriting the
  same JSON. The file is already git-ignored (`.gitignore:13`:
  `.specify/telemetry/*.json`) and is empty between Stops.
- Alternatives: writing into the most recently modified ledger — guesses the
  session and races the hook; a second ledger file read by `--by-level` — the
  spec's assumption rules it out ("no second ledger").
- Evidence: `session-telemetry.mjs:42-68` (the one writer), `.gitignore:13`.

## R7 — Reading a story and its Build brief from Notion

- Decision: `notionToken(repo, env)` and `notionClient` from `lib/notion.mjs`;
  `client.query(STORIES, { filter: { property: "ID", unique_id: { equals: n } } })`
  for `ST-<n>` (`STORIES` imported from `notion-sync.mjs:31`), `GET /pages/<id>`
  for a URL; `GET /blocks/<page>/children?page_size=100` followed through
  `next_cursor` for the body. Properties through `readProp`.
- Rationale: the same token lookup and no-token behaviour the lifecycle scripts
  have (notion.mjs:35-48), the same query `notion-sync.mjs:149` runs, and the
  same data source id, so the fallback path is the existing one.
- Alternatives: the Notion connector tools — not callable from a script; the
  official SDK — a dependency for three calls.
- Evidence: `notion.mjs:64-133` (`request`, `query`), `notion-sync.mjs:31,149`,
  `design.md` (Design and Design boards are rollups of the epic's boards; the
  brief's sections are `### Screens`, `### States and errors`,
  speckit-design-check SKILL.md:44).

## R8 — Which phases a promotion owes

- Decision: the phases level 2 runs and level 1 skips — 3 org context, 4
  clarify, 5 plan, 6 checklist, 8 analyze, 11 converge, 13 refresh, 15 agent
  context, 17 archive — read off the Size table; the proof that they ran is
  `LEVELS[2].artifacts` present in the feature directory, which adds `plan.md`
  to level 1's `spec.md` and `tasks.md`.
- Rationale: the spec's clarification fixed this; `LEVELS[n].artifacts`
  already exists (feature.mjs:40-45), so no record of phases run is added.
- Alternatives: a phases-run list in `run-state.json` — a second source that
  the by-hand path would never write.
- Evidence: speckit-auto SKILL.md Size table (level 1: 2, 7, 9, 10, 12, 14,
  16); `feature.mjs:42-43`; spec Clarifications.

## R9 — Where the thresholds and paths live

- Decision: `FR_THRESHOLD = 5`, `STORY_POINTS_THRESHOLD = 5` and
  `CONTRACT_PATHS` as exported constants beside `LEVELS` in
  `lib/feature.mjs`; no environment override.
- Rationale: the spec's assumption, and the file's own header: a second source
  for "how much process does this change get" is the drift the repository keeps
  finding (level.mjs:2-6).
- Alternatives: `SPECKIT_FR_THRESHOLD` — a knob with no number behind it yet;
  the ledger exists to produce that number first.
- Evidence: spec Assumptions; `feature.mjs:40-47`.

## Test harness pattern

Temporary repositories with `mkdtempSync`, `git init`, a local `origin` remote
(`git remote add origin <self>` + fetch, so `origin/main` resolves) and
`.specify/feature.json` written by hand, as `level.spec.mjs:14-50` and
`lifecycle.spec.mjs:19-33` do; the hook spawned with a JSON payload as
`telemetry.spec.mjs` does (`HOOK` at line 14). `suggest` is tested through
`suggestCommand(argv, { repo, env, fetchImpl, out })` with a `fetchImpl` that
answers the query, the page and the blocks calls, or throws.
