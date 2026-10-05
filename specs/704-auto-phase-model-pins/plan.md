# Implementation Plan: The phase model pins fire under /speckit-auto

**Branch**: `704-auto-phase-model-pins` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/704-auto-phase-model-pins/spec.md`

## Summary

Under `/speckit-auto`, phases 2 (specify), 5 (plan), 6 (checklist) and 7
(tasks) are dispatched as their own short agent — `subagent_type: task-runner`,
`model` = the phase skill's frontmatter pin, `run_in_background: false` — with
a prompt naming the worktree, the feature, the skill to invoke, that phase's
gate overrides and the AGENTS.md reply envelope. Clarify and analyze stay
inline (pin `opus` = the run's model). The change is prose in
`.claude/skills/speckit-auto/SKILL.md` (the `## Phases` lead-in and the phase
2–8 subsections), one clause in `task-runner.md`, and one vitest spec that
fails when a dispatch line's model differs from the skill's pin or when
clarify/analyze are dispatched. The pins, the mapping spec and the model
router are untouched. Before and after cost is read from transcripts with
`jq` into `auto-run.md`; money is listed as not measurable.

## Technical Context

**Language/Version**: Node ≥ 24 (`package.json:83`, `engines.node`), v26.5.0 on this machine; the harness is plain ESM `.mjs` with no build step (`.claude/vitest.config.ts`, "plain ESM with no build step").

**Primary Dependencies**: the Agent tool (`model` overrides the definition's frontmatter; `run_in_background`), the `task-runner` agent definition (`.claude/agents/task-runner.md:5`, `model: opus`), the phase skills' pins (`speckit-specify/SKILL.md:11` fable, `speckit-plan/SKILL.md:11` fable, `speckit-checklist/SKILL.md:11` sonnet, `speckit-tasks/SKILL.md:11` sonnet, `speckit-clarify/SKILL.md:11` opus, `speckit-analyze/SKILL.md:11` opus). No new package.

**Storage**: files only — `.claude/skills/speckit-auto/SKILL.md`, `specs/704-auto-phase-model-pins/auto-run.md`; transcripts read from `~/.claude/projects/<project>/<session>.jsonl` and `<session>/subagents/agent-*.jsonl` + `.meta.json` (research R7).

**Testing**: vitest 5.0.3 (`package-lock.json:28305`) via `npm run test:harness` = `vitest run --config .claude/vitest.config.ts` (`package.json:99`), include `**/*.spec.mjs` rooted at `.claude/`; plus `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` (spec FR-008). No Jest, no app code.

**Target Platform**: Claude Code sessions on this machine (the orchestrating session and its `task-runner` story agents, depth 1; phase agents at depth 2, or 3 when the story is itself dispatched).

**Project Type**: harness (skill prose + vitest spec); no app, lib or API.

**Performance Goals**: SC-001: 100% of the dispatched phases' assistant turns on the pinned model; SC-002: the run's Opus-turn share below the 95% baseline (cited, not re-measured).

**Constraints**: FR-007: `## Hand-off`, `## The tail` and the `gh pr create`/`gh pr ready`/`gh pr merge` lines byte-identical to `origin/main` (PR #140 merged there; this branch is behind it — research R5); FR-006: no `model:` line changes; the agent-replies spec (`.claude/agents/agent-replies.spec.mjs:44,72-79`) needs the envelope verbatim and an `at most N lines` cap ≤ 25 in `speckit-auto`'s text; a `.claude/**/*.md` change is not docs-only (`scripts/docs-only.ts:15`), so full CI runs on the PR.

**Scale/Scope**: 4 dispatched phases, 2 inline; 1 skill file, 1 agent file (one clause), 1 new spec (~60 lines), 1 run-log section with 2 measurement rows.

**Notion context**: `context.md` is an `[UNAVAILABLE: notion]` stub (the org-researcher reached no Notion tool); it adds no Constraints. `design.md`: no screens.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.1, `.specify/memory/constitution.md:452`) — evaluated in order, Principle I first:

- [x] **I. No Bloat (NON-NEGOTIABLE)**: the change is prose in one skill, one clause in one agent definition, and one spec that reads pins from the frontmatter instead of a second table. No new agent definition (`task-runner` already carries the right tools, research R1), no dispatch table file, no router change (R2), no price table (R7), no retry loop (spec FR-003). The phase-agent paragraph is written once under `## Phases` and each subsection carries one dispatch line.
- [x] **II. Test Discipline**: the harness keeps vitest specs beside the files they cover (`.claude/vitest.config.ts`); the new spec sits next to `SKILL.md` and is written red first in phase 9 (it fails on today's text, which has no dispatch lines). No `apps/`/`libs/` code, so no Jest, PostgreSQL, Redis or Playwright applies.
- [x] **III. The Given Stack**: not touched.
- [x] **IV. One Repository, One Toolchain**: one spec in the existing harness vitest project; Biome formats it (`post-edit-check.sh`).
- [x] **V. Rules Live in One Place**: the model of a phase has one source, the skill's `model:` line; the skill text names it and the spec checks the text against it. N/A to API shapes.
- [x] **VI. PostgreSQL Is the Truth**: N/A, no state store.
- [x] **Notion choices**: none relied on (context unavailable); no T1–T10 item touched.

Post-design re-check: unchanged, no Complexity Tracking entry.

## Project Structure

### Documentation (this feature)

```text
specs/704-auto-phase-model-pins/
├── plan.md              # this file
├── research.md          # R1–R7, every decision with an Evidence line
├── data-model.md        # the four entities of the spec and their fields
├── quickstart.md        # the checks that prove it, and the measurement commands
├── auto-run.md          # the run log: trial evidence, before/after rows (FR-004, FR-005)
└── tasks.md             # /speckit-tasks output (not created here)
```

No `contracts/`: the feature exposes no API, CLI or UI; its one interface is
the dispatch prompt, specified under "Design" below and read by the spec.

### Source Code (repository root)

```text
.claude/
├── agents/
│   ├── task-runner.md                 # one clause: a phase of a story run is a third kind of task it runs
│   ├── task-runner.spec.mjs           # unchanged; still passes (no frontmatter change)
│   └── agent-replies.spec.mjs         # unchanged; already checks speckit-auto's envelope and cap
├── hooks/
│   └── agent-model-router.mjs         # unchanged (R2)
└── skills/
    ├── skill-models.spec.mjs          # unchanged; guards the pins (FR-006)
    └── speckit-auto/
        ├── SKILL.md                   # ## Phases lead-in + ### 2, 4, 5, 6, 7, 8 subsections
        └── phase-dispatch.spec.mjs    # (new) dispatch model = pin; clarify/analyze inline
```

**Structure Decision**: everything lives where the harness already keeps it:
skill prose in `.claude/skills/speckit-auto/`, the agent definition in
`.claude/agents/`, and the spec colocated with the file it reads, collected by
`.claude/vitest.config.ts` (`**/*.spec.mjs`). Confirmed by `ls .claude/skills/speckit-auto/`
(today only `SKILL.md`) and the three existing specs that already read this
file (`agent-replies.spec.mjs`, `task-runner.spec.mjs`, `tail-handoff-wiring.spec.mjs`).

## Design

### The skill text (`.claude/skills/speckit-auto/SKILL.md`)

1. **`## Phases` lead-in** (after line 119, before the two-group paragraph):
   one paragraph, "Phase agents". A phase whose skill pin differs from the
   run's model (Opus, the `task-runner` pin) runs as its own agent:
   `subagent_type: task-runner` (its definition's `model: opus` is overridden
   by the call's explicit `model`), `model` = that skill's `model:` line,
   `run_in_background: false` (the next phase reads its artifact). The prompt
   names: the worktree (absolute path; start every Bash with `cd <worktree> &&`),
   the feature directory, the branch and draft PR, the skill to invoke with
   its `args`, that phase's gate overrides copied from its subsection, and the
   reply envelope (the four lines, verbatim) with "at most 10 lines". The
   agent's artifacts stay on disk; the run reads its `STATUS:` line:
   `success` → continue; `failure`/`blocked` → the phase failed, handled as the
   inline phase's failure (a Hard Stop where its rules say so), never as a
   pass; `partial` → a pass only when `FILES` names the phase's artifact and
   what failed is a Notion or mock write. No retry. If the Agent tool itself
   errors on the call (cannot start on that model), run the phase inline on
   the run's model and log a pin miss in `auto-run.md`. The hooks of a phase
   (`before_specify`, `after_specify`, `before_plan`, `after_tasks`, …) run
   inside the agent on its model, with the same yes answers.
2. **Table** (lines 131–150): unchanged columns; the dispatched rows' Gate
   override cell gains nothing — the dispatch lines live in the subsections,
   where the spec reads them.
3. **Subsections**, one dispatch line each, in a fixed form the spec parses:
   - `### 2. Specify`: "Phase agent: `subagent_type: task-runner`, `model: fable` (the skill's pin), `run_in_background: false`." The gate-override paragraph stays and is what the prompt carries. Note that the agent runs the `before_specify` branch hook and the `after_specify` Notion `start`, design check and commit hooks.
   - `### 4. Clarify`: one sentence, "Runs inline: its pin (`opus`) is the run's model." No `model:` token.
   - `### 5. Plan`: dispatch line with `model: fable`; the `before_plan` design check and the after-plan commit run inside the agent.
   - `### 6. Checklist`: dispatch line with `model: sonnet`; the drive-to-zero rule stays and goes into the prompt; the agent's spec/plan edits are on disk when it returns.
   - `### 7. Tasks`: dispatch line with `model: sonnet`; the prompt says not to run `speckit.analyze` from `after_tasks` (phase 8 does, inline), as the subsection already says.
   - `### 8. Analyze`: one sentence, "Runs inline: its pin (`opus`) is the run's model."
   - Phase 3 keeps its text (its reading already runs in `org-researcher`).
4. **Run log**: the per-phase entry gains the agent's model and its `STATUS:`
   line (one line each), so FR-004's per-phase model list is in `auto-run.md`. The instruction sits in the `## Phases` lead-in paragraph (above
   `## Commit Protocol`), so FR-007's frozen region and the verification diff
   below are unaffected.
5. **Untouched**: everything from `## Commit Protocol` down, in particular
   `## Hand-off`, `## The tail` and lines 557–558 and 637 (FR-007); the
   "Parallel runs" paragraph (lines 98–109, owned by the orchestration text).

### `task-runner.md`

One clause in its first paragraph (lines 8–11): the prompt may also name "one
phase of a story run (speckit-auto, Phase agents)". Frontmatter unchanged, so
`task-runner.spec.mjs` stays green.

### The spec (`phase-dispatch.spec.mjs`)

Reads `SKILL.md`, slices `### N.` subsections (same slicer style as
`tail-handoff-wiring.spec.mjs:14-19`), reads a skill's pin with the frontmatter
regex of `skill-models.spec.mjs:65-72`. Three tests:

1. phases 2, 5, 6, 7: exactly one `` `model: <x>` `` token in the subsection,
   and `<x>` equals the pin of `speckit-specify|plan|checklist|tasks`; the
   same line names `subagent_type: task-runner` and `run_in_background: false`.
2. phases 3, 4, 8: no `` `model:` `` token; 4 and 8 contain `inline`.
3. phases 9–13 (tests, implement, converge, harden, ticket refresh): no
   `` `model:` `` token (they stay on the run's model). Phase 14 (review) is
   out of this test: its reviewers are routed by the hook and mutation-runner
   keeps its own pin, so its text may name models; spec FR-002 covers it as
   "stays Opus" and the trial transcript (SC-001) shows it.

Red first: on today's text test 1 fails (no token), tests 2 and 3 pass; that
is the failing count phase 9 quotes.

### Measurement (`auto-run.md`, FR-005)

For each run: per model, assistant turns and the four token totals, over the
story agent's transcript and every subagent transcript it started, grouped by
agent (`.meta.json` `description`/`agentType`), `<synthetic>` turns dropped:

```bash
P=~/.claude/projects/-Users-georgehutanu-projects-motor-fix
jq -s '[.[]|select(.type=="assistant" and .message.model!="<synthetic>")]
  |group_by(.message.model)|map({model:.[0].message.model,turns:length,
  input:(map(.message.usage.input_tokens)|add),output:(map(.message.usage.output_tokens)|add),
  cache_creation:(map(.message.usage.cache_creation_input_tokens)|add),
  cache_read:(map(.message.usage.cache_read_input_tokens)|add)})' <transcripts…>
```

- After: session `565e5c5f-3244-431a-b602-206141d9b9d0`, story agent
  `subagents/agent-a7bb69b0abfa95090.jsonl` and the depth-2/3 agents whose
  meta `description` starts `ST-697` (phase 2 `agent-a001294d4b9e51176`,
  phase 5 `agent-ac0a7434ee0bfdd46`, phases 6–7 and later ones as they land).
- Before: ST-673's story agent, a depth-1 subagent of session
  `2b506914-0798-46cf-8306-143d93248a6a`, located by the
  `specs/673-story-tail-agents` path in its transcript, plus its subagents
  (the reviewers' meta files name "ST-673").
- Not measurable, stated as such: money (no price in a transcript, and the
  harness refuses a price table — `.claude/scripts/lib/telemetry.mjs:11`);
  the 95%/50-run baseline is cited from the dispatching session, not re-read.
- SC-002: the after run's Opus share = Opus turns / all non-synthetic turns,
  written beside 95%.

### Order of work (for `/speckit-tasks`)

1. `git merge --no-edit origin/main` on the branch and push (R5), before any edit.
2. Phase 9: write `phase-dispatch.spec.mjs`, run `npm run test:harness`, quote the red count.
3. Phase 10: edit `SKILL.md` (lead-in paragraph, six subsections, run-log line), the `task-runner.md` clause; green `npm run test:harness`, `harness-eval.mjs --check`, `doctor.mjs`.
4. Verify FR-007: `diff <(git show origin/main:.claude/skills/speckit-auto/SKILL.md | sed -n '/^## Commit Protocol/,$p') <(sed -n '/^## Commit Protocol/,$p' .claude/skills/speckit-auto/SKILL.md)` is empty; `git diff origin/main --stat -- '.claude/skills/*/SKILL.md'` lists only `speckit-auto`.
5. Measurement into `auto-run.md` (after the phase 6–7 agents have run, so the after row is complete up to the hand-off).

## Complexity Tracking

No violations; nothing to justify.
