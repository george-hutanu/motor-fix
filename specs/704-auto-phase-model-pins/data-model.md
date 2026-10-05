# Data model — 704-auto-phase-model-pins

No database, no DTO. The four entities of the spec are text records.

## Phase pin

- Source: the `model:` line of `.claude/skills/speckit-<phase>/SKILL.md` frontmatter (one per skill; `skill-models.spec.mjs` guards the values).
- Values today: specify `fable`, plan `fable`, checklist `sonnet`, tasks `sonnet`, clarify `opus`, analyze `opus`, context `sonnet`.
- Rule: unchanged by this feature (FR-006).

## Phase agent

- One Agent call per dispatched phase (2, 5, 6, 7).
- Fields: `subagent_type` = `task-runner`; `model` = the phase pin; `run_in_background` = `false`; `description` = `ST-<n> phase <N> <phase> (<model>)` (what the transcript's `.meta.json` records); `prompt` = worktree, feature directory, branch and PR, skill + args, the phase's gate overrides, the reply envelope and its cap.
- Output: artifacts on disk; a reply whose first four lines are `STATUS:`, `PR:`, `NEXT:`, `FILES:`.
- States, read from `STATUS:` → `success` (phase passed) · `partial` (passed only when `FILES` names the phase's artifact and the failed part is a Notion or mock write) · `failure` | `blocked` (the inline phase's failure handling; no retry). Agent tool error before any turn → inline fallback + pin miss logged (FR-009).

## Trial transcript

- Location: `~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl` with `agent-<id>.meta.json` (`agentType`, `description`, `model`, `spawnDepth`).
- Per assistant line: `.message.model` (e.g. `claude-fable-5-1`; `<synthetic>` lines carry no usage and are excluded), `.message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`.
- After: session `565e5c5f-3244-431a-b602-206141d9b9d0`. Before: ST-673's story agent under session `2b506914-0798-46cf-8306-143d93248a6a`.

## Run log

- `specs/704-auto-phase-model-pins/auto-run.md`.
- Per dispatched phase: the model and the `STATUS:` line (FR-004).
- Measurement: one `before` and one `after` row per model with turns and the four token totals, each naming its transcripts; one list of not-measurable items with reasons (money: no price in a transcript, `.claude/scripts/lib/telemetry.mjs:11`); the Opus share beside the 95% baseline (SC-002).
