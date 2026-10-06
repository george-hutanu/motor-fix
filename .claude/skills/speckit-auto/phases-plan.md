# speckit-auto: phases 1–8

Read at phase 1 (a level-1 run reads it for phases 2 and 7). Each phase follows the run order in `SKILL.md`.

## Phases 1–8

### 1. Constitution — verify, never rewrite

Do **not** invoke `/speckit-constitution`: it rewrites the constitution and
propagates into templates and installed skill files, which is not a decision
an autonomous run gets to make. Instead confirm with
`grep -nE '^\*\*Version\*\*|\[[A-Z_]+\]' .specify/memory/constitution.md`
that it has a version and no unfilled `[PLACEHOLDER]` tokens, and carry the
principles on the card read in preflight (`.specify/memory/constitution-card.md`)
— Principle I (No Bloated Code) first — into every later phase.

Only if the file is missing or still a bare template: invoke
`speckit-constitution` with the repo's existing conventions as input, then
continue. Note it in the run log as a material autonomous action.

### 2. Specify

Phase agent: `model: fable`.

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

Then `node .claude/scripts/level.mjs check` (it does the same after phases 4
and 7). A 0 or 1 that trips a wire (more FRs than the threshold, an open
clarification, a contract path, a second Nx project) becomes 2, logged in
`auto-run.md` with the wire; run the phases it skipped (3, 5, 6, 8) in run
order before the next one. It never lowers a level.

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

Runs inline: its pin (`opus`) is the run's model.

Invoke `speckit-clarify`. It first runs the `spec-challenger` subagent — which
matters most here, where this context wrote the spec it is about to question.
Its loop then presents one question at a time and waits;
here, you answer each one with its own `**Recommended:**` / `**Suggested:**`
value and move to the next, up to the skill's maximum of 5. Apply each answer
to the spec as a targeted edit (never regenerate the spec), and log all five
question/answer pairs together in the run log.

If the skill reports there is nothing material left to clarify, that is a
complete phase, not a failure. Then `node .claude/scripts/level.mjs check`.

### 5. Plan

Phase agent: `model: fable`. The `before_plan` design check and the plan commit run inside it.

Invoke `speckit-plan`. Technical Context values come from `package.json`, the
lockfile, `tsconfig*.json`, `nx.json`, `jest.config.ts`, and the touched
workspace's own config — read them and cite them; never a version from memory.
Parse the setup script's JSON for `FEATURE_SPEC`, `IMPL_PLAN`, `FEATURE_DIR`,
`BRANCH` (spec-kit ≥1.0.5 renamed `SPECS_DIR` to `FEATURE_DIR`).

Watch the import-extension rule while planning file layout: `apps/web-e2e`
uses `nodenext` and needs the literal `.js` extension on relative imports;
`apps/api`, `apps/worker`, `apps/mcp`, `apps/web` and the libs resolve with
`bundler` or `preserve` and do not use it (each project's `tsconfig*.json`).
Getting this wrong fails at build time, not typecheck time.

### 6. Checklist

Phase agent: `model: sonnet`.

Invoke `speckit-checklist` for the requirements checklist. Then drive it to
zero unchecked items: for each unchecked item, either fix the underlying
spec/plan gap and check it, or — when the item does not apply to this feature —
strike it with a one-line justification. This is what lets phase 10 pass its own
checklist gate on the merits instead of overriding it.

### 7. Tasks

Phase agent: `model: sonnet`. Its prompt says not to run `speckit.analyze` from `after_tasks`.

Invoke `speckit-tasks`. Its `after_tasks` hook dispatches `speckit.analyze`
(non-optional) — that is phase 8; run it there rather than twice. Then
`node .claude/scripts/level.mjs check`.

### 8. Analyze

Runs inline: its pin (`opus`) is the run's model.

Invoke `speckit-analyze`, which now runs `artifact-lint.mjs` as its first step.
Treat a linter ERROR exactly as a CRITICAL analyze finding: it is mechanical,
so it is never a false positive to argue with. Gate override: the skill asks whether to suggest
remediation edits — the answer is yes, and in this command you also **apply**
them to `spec.md` / `plan.md` / `tasks.md` (artifacts only; no code in this
phase). Re-run analyze after applying. Loop limit: 2 re-runs; if CRITICAL
findings survive both, that is a Hard Stop.
