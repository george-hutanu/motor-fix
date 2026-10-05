# Auto run — 704-auto-phase-model-pins

Description: ST-697 The phase model pins fire under /speckit-auto. Problem (measured by another session over 50 runs): the phase skills carry `model:` pins (added by ST-467, PR #33), but /speckit-auto runs the phases inline rather than through the Skill tool (speckit-specify invoked 7 times, plan and clarify 0), so the pins never fire, 95% of story-run turns are Opus, and story/tail agents are 58% of all cost. Build: make the cheap phases (specify, clarify, checklist, tasks, analyze; check each skill's pin) actually run on their pinned model, either by invoking them through the Skill tool, if a pin applies inside a subagent, or by dispatching each as its own short agent with `model` set. Which route works is unknown: prove it with one small trial first and record the evidence. Implementation, review fixes and the pr-tester stay on Opus (owner's rule). Files: the phase-dispatch lines of `.claude/skills/speckit-auto/SKILL.md` (phases 2–8 only), the phase skills' frontmatter, possibly `.claude/hooks/agent-model-router.mjs`. Acceptance: a measured trial transcript showing the phase turns on the pinned model; the cost of a story run before and after, measured, never estimated (state only numbers you measured, and say which were not measurable); spec-reviewer verdicts on that trial no worse; `npm run test:harness`, `harness-eval.mjs --check`, `doctor.mjs` pass. Overlap: PR #140 (ST-688) owns speckit-auto's Hand-off, The wait and The tail sections; another session's lever 4 owns the lines listing the open, ready and merge commands. Stay out of both.

Start commit: 50cdaaacab5ac67d105e12576970f31cd90a64a3 (origin/main, PR #138 merged).

Level: 2 (feature), from `.specify/feature.json` (`level_for: next`, bound to this feature by `level.mjs point`).

Notion story: ST-697 https://app.notion.com/p/3f0607bff0d2816f9b06f0ebbbff4c53 (EP-1).

## 2. Specify

Phase 2 ran as a dispatched agent on the specify skill's pin (`fable`), the route this feature builds; the dispatching session's trial is cited in the spec's Background and not re-measured here.

- Branch `704-auto-phase-model-pins` from the `before_specify` hook (`create-new-feature-branch.sh`, FEATURE_NUM 704); `level.mjs point specs/704-auto-phase-model-pins` → level 2 (feature).
- `spec.md`: 3 user stories, FR-001..FR-009, SC-001..SC-006, Spec Delta on `platform` (as ST-467 did; `harness` has no capability file).
- `checklists/requirements.md`: every item passes in one pass; no `[NEEDS CLARIFICATION]` marker was written.

Autonomous answers, each an `(autonomous default)` line under the spec's Assumptions:

1. Route: agent dispatch with `model` set, not the Skill tool — from the dispatching session's trial (Skill-tool pin inside a subagent served `claude-opus-5-5`, 117,012-token cache read; `model: haiku` Agent ran every turn on `claude-haiku-4-5-20251001`; depth-3 dispatch works).
2. Dispatched phases: specify and plan (`fable`), checklist and tasks (`sonnet`); clarify and analyze (`opus`) stay inline; phase 3 (context) stays inline because its reading already runs in `org-researcher` under its own pin.
3. "The run's model" is the model the `/speckit-auto` session is served on (Opus for a `task-runner` story); the skill states the rule, not a fixed list.
4. Before/after cost: one existing pre-change story-run transcript against this feature's own trial; single runs, indicative; the only number SC-002 targets is "below the 95% baseline".
5. Monetary cost expected not measurable (the transcript carries no price); listed as such, never multiplied by a remembered price.
6. The phase agent's tool set (git, `gh`, Notion) is a plan decision within the harness's existing agents (Principle I).
7. An unstartable pinned model falls back inline with a logged pin miss (FR-009), after the harness's fail-open habit.
8. Spec-reviewer baseline for "no worse": ST-467 and ST-673, both APPROVE.

## 3. Org context

- `org-researcher` (background) returned blocked: no Notion read tool reached it (its tool list names connector ids this session does not carry). `context.md` is an `[UNAVAILABLE: notion]` stub. A dead lane is not a Hard Stop; phase 4 went on without a digest.

## 4. Clarify (inline, pin `opus` = run model)

- `spec-challenger` raised 5 findings; each answered with its recommended default except Q1 (see spec Clarifications):
  - Q1 trial run → this feature's own run, phases 2/5/6/7 dispatched by the new rule by hand (no second backlog story: scope).
  - Q2 turns counted → every assistant turn of the story agent and its subagents, grouped by agent; routed reviewers and mutation-runner keep their own models.
  - Q3 rule or list → fixed list against Opus (`task-runner` pin); Principle I.
  - Q4 pin miss → only an Agent tool error; a silent substitution is a trial finding failing SC-001.
  - Q5 `partial` → passes only for a Notion/mock miss with the artifact in FILES; no retry.

## 5. Plan (dispatched agent, pin `fable`)

Phase 5 ran as a dispatched agent on the plan skill's pin (`fable`, `speckit-plan/SKILL.md:11`); transcript `565e5c5f-…/subagents/agent-ac0a7434ee0bfdd46.jsonl` (`.meta.json`: `model: fable`, depth 2). `before_plan` design check skipped: `design.md` is current (harness task, no screens); the optional commit hook found a clean tree.

- `plan.md`, `research.md` (R1–R7, each with Evidence), `data-model.md`, `quickstart.md`; no `contracts/` (no external interface; the dispatch prompt is specified in the plan's Design).
- Constitution Check: all gates pass, Principle I first; no Complexity Tracking entry.
- `context.md` is an `[UNAVAILABLE: notion]` stub: no Constraints fed the plan; not a stop.

Autonomous decisions:

1. No research agents: every unknown resolved from files read here (Principle I).
2. Phase agent = `subagent_type: task-runner` with explicit `model` (overrides its `model: opus`; tool surface already right; the trial's phase agents used `general-purpose`, which carries the heavy first-turn tools), `run_in_background: false` (phases 2/5/6/7 are serial).
3. Router untouched: `agent-model-router.mjs:178` exits on an explicit `model`; `:40` routes only the two reviewers.
4. Pins untouched; the new spec reads each pin from the skill's frontmatter rather than a second table.
5. Edit scope: `## Phases` lead-in + `### 2/4/5/6/7/8` of `speckit-auto/SKILL.md`, one clause in `task-runner.md`; PR #140 is merged and this branch is behind it, with its hunks at lines 560+ (below every touched line), so implement merges `origin/main` first and the edit is clean.
6. Spec: `.claude/skills/speckit-auto/phase-dispatch.spec.mjs` (vitest), red on today's text (test 1), green after the edit.
7. Measurement: `jq` over `~/.claude/projects` transcripts, `<synthetic>` turns excluded, grouped by `.meta.json` description; after = session `565e5c5f-…` (story agent `agent-a7bb69b0abfa95090`), before = ST-673's story agent under session `2b506914-…`; money not measurable (`telemetry.mjs:11`), stated, never estimated.
8. `after_plan` agent-context hook (optional) not run here: phase 15 refreshes the context file once, under the context ratchet.

## 6. Checklist

`checklists/dispatch.md` (CHK001-CHK020), requirements quality of spec.md + plan.md. Zero unchecked.

Fixes:
- CHK010: plan "The spec" test 3 covered phases 9-12 only while FR-002 says 9-14; now 9-13, with phase 14 stated as out of the test and why (routed reviewers, mutation-runner pin; SC-001 transcript covers it).
- CHK004/CHK011: plan Design 4 now says where the run-log line lives (`## Phases` lead-in, above `## Commit Protocol`), so FR-007's frozen region and the verification diff are unaffected.

Strikes:
- CHK019 (concurrent-run half): "Parallel runs" is outside phases 2-8 and not edited; only the PR #140 / lever 4 overlap stays as a requirement (FR-007).

Other items were satisfied as written (no edit).
