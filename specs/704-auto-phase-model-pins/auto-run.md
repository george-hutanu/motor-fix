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
