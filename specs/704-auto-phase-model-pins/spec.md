# Feature Specification: The phase model pins fire under /speckit-auto

**Feature Branch**: `704-auto-phase-model-pins`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 2 (feature)
**Notion story**: ST-697 — https://app.notion.com/p/3f0607bff0d2816f9b06f0ebbbff4c53 (Task, EP-1)
**Epic**: EP-1 Foundations

**Input**: User description: "ST-697 The phase model pins fire under /speckit-auto. Problem (measured by another session over 50 runs): the phase skills carry `model:` pins (added by ST-467, PR #33), but /speckit-auto runs the phases inline rather than through the Skill tool (speckit-specify invoked 7 times, plan and clarify 0), so the pins never fire, 95% of story-run turns are Opus, and story/tail agents are 58% of all cost. Build: make the cheap phases (specify, clarify, checklist, tasks, analyze; check each skill's pin) actually run on their pinned model, either by invoking them through the Skill tool, if a pin applies inside a subagent, or by dispatching each as its own short agent with `model` set. Which route works is unknown: prove it with one small trial first and record the evidence. Implementation, review fixes and the pr-tester stay on Opus (owner's rule). Files: the phase-dispatch lines of `.claude/skills/speckit-auto/SKILL.md` (phases 2–8 only), the phase skills' frontmatter, possibly `.claude/hooks/agent-model-router.mjs`. Acceptance: a measured trial transcript showing the phase turns on the pinned model; the cost of a story run before and after, measured, never estimated (state only numbers you measured, and say which were not measurable); spec-reviewer verdicts on that trial no worse; `npm run test:harness`, `harness-eval.mjs --check`, `doctor.mjs` pass. Overlap: PR #140 (ST-688) owns speckit-auto's Hand-off, The wait and The tail sections; another session's lever 4 owns the lines listing the open, ready and merge commands. Stay out of both."

## Background: what is already known

ST-467 (PR #33) gave every `speckit-*` skill a `model:` pin, guarded by the
mapping spec `.claude/skills/skill-models.spec.mjs`. Today the pins read:
specify `fable`, clarify `opus`, plan `fable`, checklist `sonnet`, tasks
`sonnet`, analyze `opus`, tests/implement/harden `opus`, auto and review none.
A pin only applies when the skill is the top of its own context, and
`/speckit-auto` runs phases 2–8 inline, so under a story run the pins never
fire: over 50 measured runs, `speckit-specify` was invoked 7 times, plan and
clarify 0; 95% of story-run turns were Opus; story and tail agents were 58% of
all cost (the dispatching session's measurement).

The route was settled by a trial the dispatching session ran before this
feature started, and this spec cites it rather than measuring again:

- A pinned skill invoked through the Skill tool inside a subagent does not
  change the model the API serves: the transcript turn after
  `Skill speckit-git-validate` (pin `haiku`) reported `claude-opus-5-5`, with a
  117,012-token cache read.
- An Agent call with `model: haiku` ran every one of its turns on
  `claude-haiku-4-5-20251001`, and a depth-2 agent could start a depth-3 one.

So the build is the second route: `/speckit-auto` dispatches each phase whose
pin differs from the run's own model as its own short agent with `model` set
to that pin. Specify and plan go out on `fable`, checklist and tasks on
`sonnet`. Clarify and analyze pin `opus`, the run's own model, so they stay
inline. Implementation, review fixes and the PR tester stay on Opus (the
owner's rule). The pins themselves are unchanged; the ST-467 mapping spec
keeps guarding them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A story run's cheap phases run on their pinned model (Priority: P1)

The owner dispatches a story through `/speckit-auto`. The specify, plan,
checklist and tasks phases each run as their own short agent on the model
their skill pins; the run's transcript shows every assistant turn of those
phases served by that model, not by Opus. The run's result is the same set of
artifacts as before (`spec.md`, `plan.md`, the checklist, `tasks.md`, the
hooks' branch, draft PR and Notion writes, the run log entries), produced by
the same skills with the same gate answers.

**Why this priority**: it is the whole problem. Without it the pins ST-467 added
are documentation, and the 95% Opus share stands.

**Independent Test**: run one story through `/speckit-auto` to its hand-off,
then read the run's transcript: group the assistant turns by phase and report
the model each turn was served on. Specify and plan turns say `fable`,
checklist and tasks turns say `sonnet`; clarify, analyze, tests, implement,
harden and review turns say Opus.

**Acceptance Scenarios**:

1. **Given** a `/speckit-auto` run on Opus at level 2, **When** phase 2 (specify) runs, **Then** it runs in a dispatched agent whose every turn is served by the specify skill's pinned model (`fable`), and the branch, spec, draft PR and Notion `start` writes exist afterwards exactly as they do today.
2. **Given** the same run, **When** phases 5, 6 and 7 run, **Then** plan's turns are served by `fable` and checklist's and tasks' by `sonnet`, and `plan.md`, the checklist driven to zero unchecked items and `tasks.md` exist afterwards.
3. **Given** the same run, **When** phases 4 and 8 run, **Then** they run inline on the run's own model, because their pin (`opus`) equals it.
4. **Given** the same run, **When** phases 9–14 run (tests, implement, converge, harden, ticket refresh, review and its fixes) and later the PR tester, **Then** every turn is Opus, as today.
5. **Given** a story run on a level that skips a phase (`/speckit-size` 0 or 1), **When** the run reaches that phase, **Then** it is skipped exactly as today; no agent is dispatched for a skipped phase.
6. **Given** a dispatched phase agent that cannot complete its phase (a skill error, a Hard Stop condition, a tool it lacks), **When** it returns, **Then** its reply's `STATUS:` line says `failure` or `blocked` with the reason, and the run treats it as it would treat the same condition inline (a Hard Stop where the phase's rules say so), never as a phase that passed.

---

### User Story 2 - The cost of a story run is measured before and after (Priority: P2)

The owner wants to know what the change saves, in numbers that were measured,
not estimated. The feature records, from transcripts, the cost of one story run
before the change and one after: the share of turns on each model, the token
counts the transcript carries per model, and which figures could not be
measured and why (for example, a price per token the transcript does not
carry).

**Why this priority**: the owner's acceptance names it, and a saving nobody
measured is a claim, not a result. It depends on Story 1 having run.

**Independent Test**: open the feature's run log; it has a "before" and an
"after" row for the same measures, each row naming the transcript it was read
from, and a line listing every measure that was not measurable.

**Acceptance Scenarios**:

1. **Given** the trial run of Story 1, **When** its transcript is read, **Then** the run log records, per model, the count of assistant turns and the input, output, cache-creation and cache-read token totals, and names the transcript file.
2. **Given** a story run from before this change, **When** the same measures are read from its transcript, **Then** the run log records them on a "before" row beside the "after" row, and names the run.
3. **Given** a measure that the transcript does not carry (a monetary cost, a wall-clock figure the harness does not log), **When** the run log is written, **Then** that measure is listed as not measurable with the reason, and no estimate stands in for it.
4. **Given** the baseline measure from the description (95% of story-run turns on Opus over 50 runs), **When** the after-run's share is computed, **Then** the run log states both numbers side by side.

---

### User Story 3 - Quality and the rest of the harness hold (Priority: P3)

The cheaper phases do not lower the bar. The spec-reviewer's verdict on the
trial is no worse than the verdicts on the last story runs; the harness's own
checks pass; the model pins and their mapping spec are untouched; and the
sections of `speckit-auto` that other open work owns are not edited.

**Why this priority**: a saving that costs review quality, or that collides
with PR #140 or the lever-4 session, is a regression dressed as one.

**Independent Test**: `npm run test:harness`,
`node .claude/scripts/harness-eval.mjs --check` and
`node .claude/scripts/doctor.mjs` are green on the branch; the diff of
`.claude/skills/speckit-auto/SKILL.md` touches only its phase 2–8 dispatch
lines and the lines needed to describe the dispatch (never the Hand-off, The
wait or The tail sections, nor the lines listing the open, ready and merge
commands); every `speckit-*` skill's `model:` line is unchanged.

**Acceptance Scenarios**:

1. **Given** the trial run, **When** its phase 14 spec-reviewer verdict is read, **Then** it is APPROVE with no CRITICAL or HIGH finding, which is no worse than the verdicts recorded for ST-467 and ST-673.
2. **Given** the branch, **When** the three harness checks run, **Then** each exits 0.
3. **Given** the branch's diff, **When** it is compared with `origin/main`, **Then** no `speckit-*` skill's `model:` line differs and the ST-467 mapping spec is green.
4. **Given** the branch's diff of `speckit-auto`'s skill file, **Then** the Hand-off, The wait and The tail sections and the open/ready/merge command lines are byte-identical to `origin/main`.

### Edge Cases

- The run's own model is not Opus: the dispatch list is fixed against Opus, the model `task-runner` pins (see Clarifications); a run started on another model still dispatches the same four phases.
- A pinned model the dispatch cannot start on: only an Agent tool error counts; the phase runs inline on the run's model and the run log records a pin miss; the run is not stopped. A model silently substituted is visible only in the transcript after the run, and is a trial finding (it fails SC-001), not something the run detects.
- The model router hook (`agent-model-router.mjs`) sees the phase dispatch: it routes only `code-reviewer` and `spec-reviewer`, and an explicit `model` already wins, so it leaves a phase agent alone; if any change there is needed it is only to keep that true.
- A phase agent runs the phase's spec-kit hooks (the branch creation, Notion sync, design check and commit hooks of `after_specify`, `before_plan`, `after_tasks`): it needs the tools those hooks use (git, `gh`, the Notion connector) and the same gate answers `/speckit-auto` gives inline; those hooks run on the phase agent's model, whatever their own skill pins say.
- The story agent is itself a dispatched agent (the orchestrating session dispatches `task-runner`): a phase agent is then a depth-3 agent, which the trial showed can be started.
- Phase 6 drives the checklist to zero unchecked items by editing `spec.md`/`plan.md`; done inside the phase agent, those edits are on disk when it returns, and the run commits them as today.
- Phase 7's `after_tasks` hook dispatches analyze; today the skill says to run it as phase 8 rather than twice. The same holds: the tasks agent does not run analyze, phase 8 does, inline.

## Clarifications

### Session 2026-10-05

- Q: Which run is the trial, given this feature's own phases ran before the skill changed? → A: This feature's own run. Its dispatcher ran phases 2, 5, 6 and 7 by the new rule by hand, ahead of the skill edit, so its transcript is a real story run under the dispatch. No second backlog story is started for the purpose (scope: nobody chose it). The run log names the transcripts. (autonomous default)
- Q: Which turns count, and is phase 14 bound to "all Opus"? → A: Every assistant turn of the story agent and of each subagent it started, grouped by agent. "Opus" in FR-002 means the story agent's own turns and the PR tester. The routed reviewers keep the router's choice and `mutation-runner` keeps its pin; neither belongs to this feature. (autonomous default)
- Q: Is the dispatch a rule evaluated at run time, or a fixed list? → A: A fixed list: specify and plan on `fable`, checklist and tasks on `sonnet`, against Opus, the model `task-runner` pins. A skill cannot read the model it is served on, and a rule for a run model nobody starts would be a knob (Principle I). (autonomous default)
- Q: What counts as "cannot start" for FR-009, and does a pin miss fail SC-001? → A: Only an Agent tool error. A silently substituted model is found in the transcript after the run, is a trial finding, and fails SC-001. (autonomous default)
- Q: How is a `partial` phase reply treated, and is a failed phase retried? → A: `partial` passes only when FILES names the phase's artifact and what failed is a Notion or mock write (AGENTS.md: such a failure never blocks the build). Anything else is a failure, and there is no retry, as inline. (autonomous default)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Under `/speckit-auto`, each of phases 2 (specify), 5 (plan), 6 (checklist) and 7 (tasks) MUST run as its own dispatched agent with its `model` set to the pin in that phase's skill frontmatter (a fixed list: those are the phase 2–8 skills whose pin differs from Opus).
- **FR-002**: A phase whose skill pin equals the run's model (clarify and analyze on an Opus run) MUST stay inline; phases 9–14, the review fixes and the PR tester MUST stay on Opus regardless of any pin.
- **FR-003**: A dispatched phase agent MUST produce the same artifacts, run the same spec-kit hooks and answer the same gates as the inline phase does today (the "Gate override" rules of `/speckit-auto` phases 2–8), and MUST open its reply with the four `STATUS:/PR:/NEXT:/FILES:` lines of AGENTS.md "Agent replies"; the run MUST treat a `failure` or `blocked` status as the inline phase's failure, never as a pass, and a `partial` one as a pass only when FILES names the phase's artifact and what failed is a Notion or mock write. A failed phase agent is not retried.
- **FR-004**: The dispatch MUST be proven by one measured trial: a story run through `/speckit-auto` whose transcript shows every assistant turn of the dispatched phases served by the pinned model, recorded in the feature's run log with the transcript's path and the per-phase model list.
- **FR-005**: The feature MUST record, in the run log, the cost of one story run before the change and one after, read from transcripts: per model, the count of assistant turns and the input, output, cache-creation and cache-read token totals; every measure that was not measurable MUST be named with its reason, and no estimate MAY stand in for a measurement.
- **FR-006**: The `model:` line of every `speckit-*` skill MUST be unchanged, and the ST-467 mapping spec MUST stay green.
- **FR-007**: Within `.claude/skills/speckit-auto/SKILL.md` the change MUST be confined to the phase 2–8 dispatch lines and the lines that describe the dispatch; the Hand-off, The wait and The tail sections and the lines listing the open, ready and merge commands MUST be identical to `origin/main`.
- **FR-008**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` MUST pass on the branch; a harness spec MUST fail if a phase 2–8 dispatch line names a model other than that phase skill's pin.
- **FR-009**: A phase agent the Agent tool cannot start on its pinned model (a tool error) MUST NOT stop the run: the phase runs inline on the run's model and the run log records the pin miss.

### Key Entities

- **Phase pin**: the `model:` value in a `speckit-<phase>` skill's frontmatter; the one source of which model a phase runs on (ST-467).
- **Phase agent**: the short agent `/speckit-auto` dispatches for one phase, carrying the phase's skill name, the feature directory, the run's gate answers and the pinned model; it returns the four-line reply and leaves its artifacts on disk.
- **Trial transcript**: the session transcript of the story run that proves the dispatch; its assistant turns carry the serving model and token usage the run log cites.
- **Run log**: `specs/<feature>/auto-run.md`, where the trial evidence, the before/after measures and the not-measurable list live.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-007, FR-008, FR-009
- **Modifies**: ST-467 FR-001..FR-005 gain the sentence "under `/speckit-auto`, a phase's pin is applied by dispatching the phase as its own agent with that model" (FR-006 here restates that the pins are unchanged)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the trial run's transcript, 100% of the assistant turns inside the dispatched specify and plan phases are served by `fable`, and 100% of those inside checklist and tasks by `sonnet`; 0 of them by Opus.
- **SC-002**: The trial run's share of Opus turns, measured from its transcript, is below the 95% baseline the dispatching session measured over 50 runs, and both numbers are written side by side in the run log; how far below is not a target, because no source supports one (see Assumptions).
- **SC-003**: The run log carries one "before" and one "after" row with the same per-model turn and token measures, each naming its transcript, plus a list of the measures that were not measurable and why; no row contains an estimate.
- **SC-004**: The trial's spec-reviewer verdict is APPROVE with 0 CRITICAL and 0 HIGH findings, no worse than the ST-467 and ST-673 verdicts (both APPROVE).
- **SC-005**: `npm run test:harness`, `harness-eval.mjs --check` and `doctor.mjs` exit 0 on the branch, and the ST-467 mapping spec passes with every `speckit-*` pin unchanged.
- **SC-006**: The branch's diff of `speckit-auto`'s skill file leaves the Hand-off, The wait and The tail sections and the open/ready/merge command lines byte-identical to `origin/main`.

## Assumptions

- (autonomous default) The route is the agent dispatch, not the Skill tool: the dispatching session's trial showed a Skill-tool pin inside a subagent served `claude-opus-5-5` (117,012-token cache read after `Skill speckit-git-validate`, pin `haiku`), while an Agent call with `model: haiku` ran every turn on `claude-haiku-4-5-20251001`. The spec cites that trial and does not re-run it; the feature's own trial (FR-004) proves the dispatch inside a real story run.
- (autonomous default) Phase 3 (Notion context) stays inline even though `speckit-context` pins `sonnet`: its reading already runs inside the `org-researcher` subagent, whose own frontmatter pin applies, so the orchestrating turns around it are few. The description names specify, clarify, checklist, tasks and analyze; plan is included because its pin (`fable`) differs from Opus and the dispatching session named it.
- (autonomous default) "The run's model" is Opus, the model `task-runner` pins (`.claude/agents/task-runner.md`); the skill states the fixed list (see Clarifications).
- (autonomous default) The before measurement is read from an existing story-run transcript from before this change (one of the 50 runs the dispatching session measured, or the ST-673 run), not from a run repeated for the purpose; the after measurement is this feature's own trial. Both are single runs, so the comparison is indicative, and SC-002 names only the 95% baseline it has a source for.
- (autonomous default) The transcript carries the serving model and token usage per assistant turn but no price, so monetary cost is expected to be among the not-measurable items; the run log says so rather than multiplying by a remembered price.
- (autonomous default) The dispatched phase agent is given the tools the phase's hooks need (git, `gh`, the Notion connector); which agent definition carries them is a plan decision, within the harness's existing agents where one fits (Principle I).
- (autonomous default) A pinned model that cannot be started on is handled by falling back inline and logging a pin miss (FR-009), after the harness's fail-open habit (`agent-model-router.mjs`, the Jev lane): a cost saving never blocks a build.
- (autonomous default) The spec-reviewer baseline for "no worse" is the last two story runs' verdicts, ST-467 and ST-673, both APPROVE; a BLOCK on the trial fails SC-004 even if fixed in a later lap.
- The 95%, 58%, 7 and 0 figures are the dispatching session's measurement over 50 runs and are cited, not re-measured.
