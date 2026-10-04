---
name: "speckit-auto"
description: "Run the entire spec-driven cycle end-to-end and autonomously: constitution check, specify, org context, clarify, plan, checklist, tasks, analyze, tests, implement, converge, spec review, agent-context refresh — resolving every interactive gate itself and committing each implementation slice."
argument-hint: "Describe the feature to build end-to-end"
compatibility: "Requires spec-kit project structure with .specify/, the gates in .claude/hooks, and a clean working tree"
metadata:
  author: "blastradius (ported from speckit-demo)"
  source: "project-local — autonomous pipeline"
user-invocable: true
disable-model-invocation: false
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). The text
the user typed after `/speckit-auto` **is** the feature description — pass it
through to every phase that takes a description. Do not ask the user to repeat
it; if it is empty, that is the one preflight failure that stops the run.

## Goal

Take a feature description from nothing to reviewed, tested, committed
implementation in a single turn, running every Spec Kit phase in order without
returning to the user between phases.

This command does not reimplement the phases. Each phase is the existing skill,
invoked through the Skill tool with the same description as `args`. This file
adds two things the individual skills do not have: the run order, and an
autonomous answer for every gate that would otherwise wait for a human.

## Autonomy Contract

This is the whole point of the command — read it before phase 1.

1. **Never wait for the user.** Every gate inside a phase skill that says
   "STOP and ask", "wait for user response", or "present one question at a
   time" is answered by you, in-line, using that skill's own stated
   recommendation. You do not emit the question and stop; you record the
   question, its answer, and the reason in the run log (see below).
2. **The recommendation is the answer.** Where a phase computes a
   `**Recommended:** Option X` or `**Suggested:** <answer>`, that is the
   answer. Where it computes none, pick the option that best fits the
   constitution (`.specify/memory/constitution.md`, Principle I first) and
   this repo's real code — `package.json`, `nx.json`, `biome.json`,
   `jest.config.ts`, the touched workspace — and say which evidence decided
   it.
3. **Assumptions are written down, not held in memory.** Every autonomous
   answer lands in the artifact the phase owns (spec Clarifications /
   Assumptions, plan Technical Context, tasks notes) *and* as one line in the
   run log `specs/<feature>/auto-run.md`.
4. **Hook prompts are yes.** `.specify/extensions.yml` runs with
   `auto_execute_hooks: true` and its git hooks ask things like "Commit
   specification changes?". In this command the answer is always yes — subject
   to the Commit Protocol below, which is where you will find that most
   artifact phases have nothing to commit at all.
5. **A blocked tool call is an instruction, not a question.** The gates in
   `.claude/hooks/` (`red-first-gate.mjs`, `bash-guard.mjs`,
   `pre-commit-check.sh`) and `.husky/pre-commit` block by design. Do what the
   block says — run `/speckit-tests`, drop the forbidden command, fix the
   failing test — and continue. Never surface a hook block to the user as a
   decision, and never weaken a test, `.skip` it, rename a file, or downgrade
   a commit type to slip past a gate.
6. **Finish the run.** No phase ends with "next I'll…". The turn ends with the
   final report of a completed pipeline, or with one of the Hard Stops.

## Preflight

Run these before phase 1, in one batch:

- `git status --porcelain` — the tree MUST be clean. Uncommitted work is a hard
  stop: a run that spans phases cannot tell your changes from its own, and
  this repo is frequently mid-WIP on a ticket branch. **Unless** the user's
  invocation says `worktree`: then call `EnterWorktree` with the feature's
  short name first and run the whole pipeline there. The user's checkout stays
  untouched, a dirty tree stops being Hard Stop 2, and `ExitWorktree` at the
  end leaves the branch for them to inspect. This is the recommended way to
  run auto on a machine that is also being used.
- `git rev-parse --abbrev-ref HEAD` and `git rev-parse HEAD` — record the
  starting branch and commit.
- Read `.specify/memory/constitution.md` (v1.2.1 — its Enforcement section
  lists the gates that will fire at you).
- `npm run typecheck && npm run lint && npx jest` — the repo MUST start
  green. A red start is a hard stop; the run has no way to tell a pre-existing
  failure from one it caused. This is the one time the full suite runs; after
  this, verification is scoped to what changed.
- `node .claude/scripts/spec-drift.mjs --status` — know the drift baseline
  before you start moving code.

Then create the run log `specs/<feature>/auto-run.md` as soon as the feature
directory exists (phase 2 creates it), with the description, the start commit,
and one section per phase to append to.

## Phases

Run in this order. Each phase: invoke the skill, apply the gate override,
verify, commit if there is anything committable, append to the run log,
continue.

| # | Phase | Skill | Gate override |
|---|-------|-------|---------------|
| 0 | Size | `speckit-size` | Choose a level; record it before anything else |
| 1 | Constitution | *(read only)* | Verify, do not rewrite — see below |
| 2 | Specify | `speckit-specify` | Self-answer the clarification table |
| 3 | Org context | `speckit-context` | Overwrite freely; a dead lane is not a stop |
| 4 | Clarify | `speckit-clarify` | Self-answer all ≤5 questions |
| 5 | Plan | `speckit-plan` | none (no interactive gate) |
| 6 | Checklist | `speckit-checklist` | Drive to 0 unchecked items |
| 7 | Tasks | `speckit-tasks` | none |
| 8 | Analyze | `speckit-analyze` | Apply remediation without asking |
| 9 | Tests | `speckit-tests` | Prove red before implementing |
| 10 | Implement | `speckit-implement` | Skip the checklist STOP gate |
| 11 | Converge | `speckit-converge` | Loop back into 9–10 for new work |
| 12 | Harden | `speckit-harden` | Fix every ERROR; never suppress one |
| 13 | Ticket refresh | `speckit-context --since` | An empty refresh is a pass |
| 14 | Review | `spec-reviewer` subagent | CRITICAL/HIGH block completion |
| 15 | Agent context | `speckit-agent-context-update` | The file may shrink, never grow — see below |
| 16 | Retrospective evidence | *(scripts, read-only)* | Gather it; the verdict stays the user's — see below |
| 17 | Archive | `speckit-archive` | Merge the Spec Delta into the capability specs |

### 0. Size — decide how much of this to run

Run `/speckit-size` first and record the level. It decides which of the phases
below actually run:

| Level | Phases |
|---|---|
| 0 trivial | none of this — change, verify, commit. Say so and stop. |
| 1 one-session | 2, 7, 9, 10, 12, 14, 16 — no org context, plan, checklist or analyze |
| 2 feature | all of them (the default) |
| 3 project | all of them, per feature, against the shared brief |

A level chooses phases, never gates. Phase 9 runs at every level above 0: the
red-first hook reads the spec and the tasks, not the level, and a run that skips
tests because it called itself small is the failure this whole harness exists to
prevent.

### Run state — write it, do not narrate it

At every phase boundary:

```bash
node .claude/scripts/run-state.mjs set --status in-progress --phase <name> --feature <dir>
```

On a Hard Stop, record the machine-readable reason instead of only writing prose
into the run log — an orchestrator reads `.specify/run-state.json`, not the
transcript:

```bash
node .claude/scripts/run-state.mjs set --status blocked --blocking <condition>
```

Conditions: `dirty-tree`, `red-suite`, `unclear-intent`, `no-subagents`,
`repair-loop-exceeded`, `verification-failed`, `destructive-action`,
`product-call`.

Every fix/re-verify lap in phases 12 and 14 is counted:

```bash
node .claude/scripts/run-state.mjs repair   # exits 1 at the cap, with the run blocked
```

When it exits 1, **stop**. Five laps without convergence is not one lap away
from converging; report what the findings are and which decision is unresolved.

### 1. Constitution — verify, never rewrite

Do **not** invoke `/speckit-constitution`: it rewrites the constitution and
propagates into templates and installed skill files, which is not a decision
an autonomous run gets to make. Instead read
`.specify/memory/constitution.md`, confirm it has a version and no unfilled
`[PLACEHOLDER]` tokens, and carry its principles — Principle I (No
Bloated Code) first — into every later phase.

Only if the file is missing or still a bare template: invoke
`speckit-constitution` with the repo's existing conventions as input, then
continue. Note it in the run log as a material autonomous action.

### 2. Specify

Invoke `speckit-specify` with the description. Its `before_specify` hook runs
`speckit.git.feature`, which creates the branch — let it, and branches here use
the generated `NNN-slug` form, and `.specify/feature.json` ties the branch to
the feature for the gates. If the description names a Notion story, feature or
epic, put its URL in the spec so phase 3 can anchor on it.

Gate override: the skill's clarification-question table is its interactive
gate. Answer every question yourself from the description, the constitution,
and the repo. Each answer becomes a line under the spec's **Assumptions**
marked `(autonomous default)`. A number in Success Criteria that no source
supports is an assumption, not a metric — write it as one.

### 3. Notion context

Invoke `speckit-context`. It anchors on the Notion story, feature or epic the
spec links (or on terms from the spec) and gathers what the owner's Notion
space already says — the story and its comments, the feature page, the epic and
its sibling stories, the architecture pages, the open decisions — into
`specs/<feature>/context.md`. Notion is its only source, there is no recency
window, and when sources disagree the latest one wins. The reading runs inside
its `org-researcher` subagent, so the pages never enter this run's context and
the agent structurally cannot write to Notion.

Gate overrides:

- The overwrite prompt is answered **overwrite**: phase 2 just created this
  feature directory, so any `context.md` there is from this run.
- A Notion connector that is not connected or errors twice is logged
  `[UNAVAILABLE: notion — …]` and the run continues without a digest. A dead
  connector is a gap in the report, never a Hard Stop, and never evidence that
  nothing exists.
- If the feature has no Notion anchor and no usable search terms, the skill stops.
  In this command that is a complete phase with an empty digest, not a Hard
  Stop — log it and continue to phase 4.

The output is an input, not a decision: carry its **Contradictions** and
**Proposed Clarifications** into phase 4 as clarification material, and its
**Constraints** into phase 5's Technical Context. The story remains the only
source of scope — any other Notion finding never becomes a requirement here,
and this phase never edits `spec.md`.

### 4. Clarify

Invoke `speckit-clarify`. It first runs the `spec-challenger` subagent — which
matters most here, where this context wrote the spec it is about to question.
Its loop then presents one question at a time and waits;
here, you answer each one with its own `**Recommended:**` / `**Suggested:**`
value and move to the next, up to the skill's maximum of 5. Apply each answer
to the spec as a targeted edit (never regenerate the spec), and log all five
question/answer pairs together in the run log.

If the skill reports there is nothing material left to clarify, that is a
complete phase, not a failure.

### 5. Plan

Invoke `speckit-plan`. Technical Context values come from `package.json`, the
lockfile, `tsconfig*.json`, `nx.json`, `jest.config.ts`, and the touched
workspace's own config — read them and cite them; never a version from memory.
Parse the setup script's JSON for `FEATURE_SPEC`, `IMPL_PLAN`, `FEATURE_DIR`,
`BRANCH` (spec-kit ≥1.0.5 renamed `SPECS_DIR` to `FEATURE_DIR`).

Watch the import-extension rule while planning file layout: `apps/server`,
`apps/scanner` and `libs/*` use `nodenext` and need the literal `.js`
extension on relative imports; `apps/client` and `apps/docs` must not have it
(AGENTS.md). Getting this wrong fails at build time, not typecheck time.

### 6. Checklist

Invoke `speckit-checklist` for the requirements checklist. Then drive it to
zero unchecked items: for each unchecked item, either fix the underlying
spec/plan gap and check it, or — when the item does not apply to this feature —
strike it with a one-line justification. This is what lets phase 10 pass its own
checklist gate on the merits instead of overriding it.

### 7. Tasks

Invoke `speckit-tasks`. Its `after_tasks` hook dispatches `speckit.analyze`
(non-optional) — that is phase 8; run it there rather than twice.

### 8. Analyze

Invoke `speckit-analyze`, which now runs `artifact-lint.mjs` as its first step.
Treat a linter ERROR exactly as a CRITICAL analyze finding: it is mechanical,
so it is never a false positive to argue with. Gate override: the skill asks whether to suggest
remediation edits — the answer is yes, and in this command you also **apply**
them to `spec.md` / `plan.md` / `tasks.md` (artifacts only; no code in this
phase). Re-run analyze after applying. Loop limit: 2 re-runs; if CRITICAL
findings survive both, that is a Hard Stop.

### 9. Tests (red-first gate)

Invoke `speckit-tests`. Every spec FR must get at least one test in a
colocated `*.spec.ts` next to the code it covers (API tests against real PostgreSQL and
Redis, end-to-end flows in the app's `*-e2e` Playwright project — constitution II),
No internal identifier goes into the source — not in a title, not in a comment:
no FR id, feature number, task id or Jira key (project rule,
`.claude/skills/speckit-tests/SKILL.md`). The FR → test mapping belongs to the
completion report and `tasks.md`, where those ids resolve. Comments are held to
the same bar as code: one only where it says something the code cannot. Then
prove red: run the new spec files with
`npx jest <files>` and quote the failing count in the run log. Tests that
pass before any implementation exist are not red-first — fix the test, do not
proceed.

Expect `post-edit-check.sh` to report failures while you write these. That is
the gate working, not a problem to fix.

**Do not commit here.** See the Commit Protocol.

### 10. Implement

Invoke `speckit-implement`. Gate overrides:

- Step 2's checklist gate ("Some checklists have unchecked items… (yes/no)")
  is answered `yes` automatically. After phase 6 it should be moot; if items
  remain, proceed and list them in the final report.
- Run every phase of `tasks.md` to completion in this turn. Batch the
  independent tool calls of `[P]` tasks in one response.
- Principle I is a gate on your own output here: no speculative abstraction,
  no single-implementation interface layer, no new dependency where existing
  code suffices. Anything that looks like bloat goes to Complexity Tracking in
  the plan or gets cut.
- A pre-existing bug or unrequested improvement found along the way goes to
  Follow-ups, not into the change.

### 11. Converge

Invoke `speckit-converge`. If it appends new tasks: re-enter phase 9 for any
new FR that has no tagged test, then phase 10 for the new tasks. Loop limit: 2
converge cycles. If cycle 2 still appends unbuilt work, stop the loop, finish
the report, and list what remains — do not spin.

### 12. Harden

Invoke `speckit-harden`. It runs the mechanical audits (`artifact-lint.mjs`,
`diff-audit.mjs`), then three subagents: `test-adversary` (tests from outside
the author's model), one `mutation-runner` per touched package (in parallel),
and `code-reviewer` (the durability read) — then fixes what they find.

Gate overrides:

- **Every ERROR is fixed, not explained away.** The audits are mechanical, so
  there is nothing to argue with.
- **A suppression is never the fix** — not a `biome-ignore`, not a `.skip`, not
  a Stryker disable added to reach the floor. Hard Stop 5 applies if the same
  finding survives three attempts.
- Mutation runs are slow; run them only for packages this branch touched. If a
  run exceeds the patience of the session, record the score you have and say
  the step was partial — never report a floor you did not measure.
- Fixes here are refactors, deletions and added tests. A finding that needs a
  behavior change is Hard Stop 7, not an edit.

Commit the result as its own slice: `refactor(<scope>): …` or
`test(<scope>): …`, never `feat` — no behavior changed here.

### 13. Ticket refresh

Invoke `speckit-context --since`. A run takes hours and the organisation does
not pause for it: a comment that narrows the ask, a flag, a linked ticket that
now owns half the work. This phase re-runs the lanes against the digest's own
`Gathered` date and appends a `## Refresh` section to `context.md`.

Gate overrides:

- **An empty refresh is a complete phase**, not a failure — say "no new
  evidence" in the report and move on.
- **New evidence is reported, never built.** A scope-narrowing comment goes in
  the final report and, if it contradicts what was delivered, into `spec.md` as
  a recorded conflict. Expanding the run to satisfy a comment found here is a
  scope change only the user can make (Hard Stop 7).
- A dead lane is logged `[UNAVAILABLE: …]`, exactly as in phase 3.

### 14. Review

First invoke `speckit-notion-sync review`. The run never merges, so In review is
where it leaves the story; `finish` runs when the branch merges to `main`.
Before phase 14, `specs/<feature>/design.md` must exist. The `after_specify` and
`before_implement` hooks write it, and a run without one is a Hard Stop.

If the user's invocation said `verified` or `use a workflow`, invoke
`speckit-review` instead of the two agents directly: every finding is
adversarially checked by independent refuters before you act on it. It drives
the Workflow tool, and those words in the user's own message are the opt-in
that tool requires — a skill cannot grant it on the user's behalf. Otherwise:

Invoke the `spec-reviewer` and `code-reviewer` subagents **in one message**
(Agent tool, `subagent_type: spec-reviewer` and `code-reviewer`), each with the
feature directory and the diff range `<start-commit>..HEAD`. They answer
different questions — conformance to the spec, and durability of the code —
and run in parallel. Merge both tables. Fix every CRITICAL and HIGH finding,
then re-run whichever reviewer raised them, once. CRITICAL/HIGH findings that survive the re-review block completion —
report them as a Hard Stop. MEDIUM/LOW findings go in the report unfixed.

### 15. Agent context

Invoke `speckit-agent-context-update` to refresh the managed
`<!-- SPECKIT START/END -->` block. Note that `AGENTS.md` is a tracked,
shared file and `CLAUDE.md` only points at it — if the update would write
spec-kit content into a tracked file, keep it in `CLAUDE.local.md` instead and
say so in the report. `specs/`, `.specify/` and `.claude/` are git-excluded
here on purpose; do not "fix" that by committing them.

### 16. Retrospective evidence — gather it, do not grade yourself

Two read-only commands, with the same `<start-commit>` the Final Report quotes:

```
node .claude/scripts/retro-evidence.mjs --since <start-commit> --jev
node .claude/scripts/instincts.mjs triggered --since <start-commit>
```

Attach both outputs to the Final Report under **Retrospective evidence
(unjudged)**. Write nothing: not `specs/<feature>/retrospective.md`, not
`.specify/memory/instincts/`. No verdict is recorded and no instinct is
reinforced by this run.

This phase deliberately does **not** invoke `/speckit-retro`. A retrospective
is a judgement on the work by someone who did not do it; this run made every
autonomous decision in the feature, so grading them from the same context is
the failure phase 14 spends two independent subagents avoiding. The verdict
also carries open action items into the NEXT feature, so a self-flattering one
damages work that has not started. Same reasoning bars `/speckit-learn`: an
instinct recorded without a human agreeing to it is indistinguishable from a
hallucination that got persisted, which is why `triggered` only proposes.

`--since` is not optional. `specs/` is git-excluded here, so a feature's
commits are not derivable from its directory and the evidence report will say
so rather than inventing a range.

`--jev` is what adds the **suggested** verdict, with a stated confidence.
Unlike `artifact-lint` and `diff-audit` this script has no `--check` form, so
the lane stays opt-in here rather than defaulting on with nothing to turn it
off again. Report it as suggested, with the number, and stop there. If the
lane was unavailable, say that — an absent suggestion is not an endorsement.

## Commit Protocol

One Conventional Commit per implementation slice, single line, no body, no
trailers (`.claude/hooks/commit-msg-policy.js` enforces it). Never push —
pushing is the user's call in this repo.

The artifact phases produce **no commits**, and this is not an oversight:
`specs/`, `.specify/` and `.claude/` are all listed in `.git/info/exclude`, so
`spec.md`, `plan.md`, `tasks.md` and the run log are local-only files with
nothing to stage. If a git-extension hook offers to commit them, let it run and
expect it to find nothing; do not `git add -f` an excluded path to make a
commit happen.

| Phase | Commit |
|-------|--------|
| 2–8 | none — artifacts are git-excluded |
| 9 | none — see below |
| 10 | `feat(<scope>): <slice>` per implementation slice, staging the code and its tests together |
| 11 | further `feat(<scope>):` slices for the converged work |
| 12 | `refactor(<scope>): …` / `test(<scope>): …` for the hardening pass — never `feat` |
| 15 | `docs: …` only if a *tracked* file genuinely changed |
| 16 | no commit — the phase is read-only; it writes no artifact at all |
| 17 | no commit — `.specify/capabilities/` is untracked here too |

Three gates shape this and are not negotiable:

- **A red suite cannot be committed.** `.husky/pre-commit` runs
  `typecheck && lint && test` on every real commit, so the failing tests from
  phase 9 have no commit of their own. Hold them in the working tree and commit
  them *with* the implementation slice that turns them green.
- **Behavior commits must move the spec.** `.claude/scripts/spec-drift.mjs`
  blocks a `feat`/`fix`/`perf` commit that stages `apps/**` or `libs/**` code
  while the active feature's `spec.md` + `tasks.md` hash is unchanged since the
  last gated commit. Flipping the `[X]` markers of the tasks a slice completes
  satisfies this honestly. If a slice changed behavior the spec does not
  describe, update `spec.md` before committing — do not relabel the commit
  `refactor` to dodge the gate.
- **Traceability is reported, not tagged in code.** The pre-commit traceability
  check is retired (`.claude/hooks/pre-commit-check.sh`) because source carries
  no FR markers any more. `node .claude/scripts/trace-matrix.mjs` still runs on
  demand and will show a feature uncovered; that is expected, not a gap to
  close by putting ids back into comments. The FR → test mapping goes in the
  final report and in `tasks.md`.

## Notifying

A run takes hours and the user has walked away. Call `PushNotification`
(`status: "proactive"`, one line under 200 characters, lead with what they
would act on) exactly twice at most: at the final report — `"<feature>: N
commits, review APPROVE, ready to push"` — and at any Hard Stop — `"<feature>
stopped at phase N: <reason>"`. Never for phase progress; the tool skips the
notification when they are watching, and a needless one costs attention that
accumulates.

## Hard Stops

Stop the run, report what is done and what is not, and hand back. This list is
exhaustive — nothing else interrupts the pipeline:

1. Empty feature description.
2. Dirty working tree, or red `typecheck`/`lint`/tests at preflight.
3. CRITICAL analyze findings surviving 2 remediation rounds (phase 8).
4. CRITICAL/HIGH `spec-reviewer` findings surviving the re-review (phase 14).
5. The same test failing after 3 distinct fix attempts in phase 10.
6. A destructive or outward-facing action the pipeline did not plan: pushing,
   deleting files outside the feature, wiping `.work/`, or anything
   `bash-guard.mjs` blocks that is genuinely required. Report it; do not work
   around it.
7. A scope change only the user can decide — the description contradicts the
   constitution (Principle I most often), or requires a product call no
   artifact in the repo answers.

On any hard stop the run log and every commit already made stay in place, so
the run is resumable by invoking the remaining phase skills directly.

## Final Report

One report, at the end, standing on its own:

- Branch, feature directory, commit range (`<start>..HEAD`), commit count.
- Phases run, with each one's outcome in a line.
- Autonomous decisions: every gate you answered and what you answered
  (pointer to `specs/<feature>/auto-run.md` for the full log).
- Verification: the exact commands run and their result lines, quoted; and the
  feature's FR → test table, read off `tasks.md` rather than off the source.
- `spec-reviewer` findings: fixed, and unaddressed MEDIUM/LOW.
- Retrospective evidence (unjudged): both command outputs verbatim, with the
  suggested verdict labelled as a suggestion and its confidence quoted.
- Follow-ups: everything noticed and deliberately not done.
- Anything left out, and why.

## Completion Checklist

- [ ] Preflight passed (clean tree, green typecheck/lint/tests, constitution read)
- [ ] Phases 1–16 executed in order, no phase skipped silently
- [ ] Org context gathered, or every unavailable lane named in the report
- [ ] Every interactive gate answered autonomously and logged
- [ ] Red-first proven before implementation (failing count quoted)
- [ ] All `tasks.md` items `[X]` or explicitly reported as not done
- [ ] Converge run; appended work implemented or reported
- [ ] `spec-reviewer` run; CRITICAL/HIGH resolved
- [ ] Tests and lint green; every FR covered by a test named in the report's FR → test table
- [ ] No internal identifier (FR id, feature number, task id, Jira key) left in any source file, comments included
- [ ] `artifact-lint.mjs` and `diff-audit.mjs` clean, or every remaining finding explained in the report
- [ ] both were run in their REPORT form, not `--check`: `--check` turns the semantic lane off, so a
      run that only ever used it has not asked whether a requirement is testable or a dependency earns
      its place. If the lane reported itself unavailable, say so in the report — that is not "clean"
- [ ] Mutation score at or above the floor for every touched package, with no disable added to reach it
- [ ] Ticket re-read (comments included) after implementation, and any scope-moving comment reported
- [ ] One commit per implementation slice, nothing pushed
- [ ] Retrospective evidence gathered with `--since`, attached unjudged; no verdict written and no instinct reinforced
- [ ] Final report delivered with the sections above

## Agent Execution Rules: auto deltas

<!-- project-local addition — re-apply after `specify integration upgrade` -->

The constitution's Agent Execution Rules apply in full. Specific to this command:

- This command owns the run order and the gate answers. It does not restate,
  reinterpret, or replace the phase skills' own instructions — when this file
  and a phase skill disagree on how to do the phase's work, the phase skill
  wins; when they disagree on whether to stop and ask, this file wins.
- Every autonomous answer cites its evidence: the description, a constitution
  principle, or `path:line` from a file read this session. An answer with no
  evidence is logged as an assumption in the spec, not presented as a finding.
- Progress is one line per completed phase. No narration of the phase skills'
  internal steps.
- After a context compaction, re-read `specs/<feature>/auto-run.md`,
  `tasks.md`, and `plan.md`; the run log and the `[X]` markers are the truth,
  not memory.
