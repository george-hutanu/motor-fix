# Tasks: The phase model pins fire under /speckit-auto

**Input**: `specs/704-auto-phase-model-pins/` (spec.md, plan.md, research.md, data-model.md, quickstart.md)
**Tests**: requested (FR-008): one vitest spec, written red first.
**Format**: `- [ ] T### [P?] [US?] Description with file path`

## Phase 1: Setup

- [x] T001 Merge `origin/main` into branch `704-auto-phase-model-pins` (`git merge --no-edit origin/main`) and push, so PR #140's hunks in `.claude/skills/speckit-auto/SKILL.md` are present before any edit (plan R5, FR-007)

## Phase 2: Foundational

None: the pins, the mapping spec and the model router are unchanged (FR-006).

## Phase 3: User Story 1 - cheap phases run on their pinned model (P1)

**Goal**: phases 2, 5, 6, 7 dispatch as `task-runner` agents on the skill's pin; 4 and 8 stay inline.
**Independent test**: `npm run test:harness` green with the new spec; the transcript shows pinned models (US2).

- [x] T002 [US1] Write failing spec `.claude/skills/speckit-auto/phase-dispatch.spec.mjs` (new): slice `### N.` subsections of `SKILL.md`; test 1: phases 2, 5, 6, 7 each hold exactly one `` `model: <x>` `` token equal to the pin of `speckit-specify|plan|checklist|tasks` plus `subagent_type: task-runner` and `run_in_background: false`; test 2: phases 3, 4, 8 hold no `model:` token and 4, 8 say `inline`; test 3: phases 9-13 hold no `model:` token (FR-001, FR-002, FR-008). Run `npm run test:harness` and quote the red count.
- [x] T003 [US1] Edit the `## Phases` lead-in of `.claude/skills/speckit-auto/SKILL.md`: add the "Phase agents" paragraph (prompt contents, four-line reply envelope capped at 10 lines, `STATUS:` handling for success/partial/failure/blocked, no retry, Agent-tool error falls back inline and logs a pin miss, run-log line per dispatched phase with model and `STATUS:`) (FR-001, FR-003, FR-004, FR-009)
- [x] T004 [US1] Edit subsections `### 2. Specify`, `### 5. Plan`, `### 6. Checklist`, `### 7. Tasks` of `.claude/skills/speckit-auto/SKILL.md`: one dispatch line each (`model: fable`, `fable`, `sonnet`, `sonnet`), keep their gate overrides; phase 7 prompt says not to run `speckit.analyze` (FR-001, FR-003)
- [x] T005 [US1] Edit `### 4. Clarify` and `### 8. Analyze` of `.claude/skills/speckit-auto/SKILL.md`: one sentence each, "Runs inline: its pin (`opus`) is the run's model", no `model:` token (FR-002)
- [x] T006 [P] [US1] Add one clause to the first paragraph of `.claude/agents/task-runner.md`: its prompt may name one phase of a story run (speckit-auto, Phase agents); frontmatter unchanged (plan "task-runner.md")
- [x] T007 [US1] Verify FR-007: the diff of `.claude/skills/speckit-auto/SKILL.md` from `## Commit Protocol` down is empty against `origin/main`, and `git diff origin/main --stat -- '.claude/skills/*/SKILL.md'` lists only `speckit-auto`

## Phase 4: User Story 2 - cost measured before and after (P2)

**Goal**: measured rows in the run log, no estimates.
**Independent test**: `auto-run.md` has a before row, an after row, and a not-measurable list.

- [x] T008 [US2] Measure the after run with the `jq` command of plan "Measurement" over session `565e5c5f-3244-431a-b602-206141d9b9d0` (story agent `agent-a7bb69b0abfa95090` and its `ST-697` subagents, `<synthetic>` dropped); per model turns and input, output, cache-creation, cache-read totals, plus per-phase model list; write to `specs/704-auto-phase-model-pins/auto-run.md` (FR-004, FR-005, SC-001)
- [x] T009 [US2] Measure the before run (ST-673's story agent and its subagents under session `2b506914-0798-46cf-8306-143d93248a6a`) the same way and write the before row beside the after row in `specs/704-auto-phase-model-pins/auto-run.md` (FR-005, SC-003)
- [x] T010 [US2] In `specs/704-auto-phase-model-pins/auto-run.md` state the after Opus-turn share beside the 95% baseline and list every not-measurable item with its reason (money: no price in a transcript, `.claude/scripts/lib/telemetry.mjs:11`) (SC-002, SC-003)

## Phase 5: User Story 3 - quality and the harness hold (P3)

**Independent test**: the three harness checks exit 0; pins unchanged.

- [x] T011 [US3] Run `npm run test:harness` (new spec green, `skill-models.spec.mjs`, `task-runner.spec.mjs`, `agent-replies.spec.mjs` green), `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs`; all exit 0 (FR-006, FR-008, SC-005)
- [x] T012 [US3] Confirm no `speckit-*` skill `model:` line differs from `origin/main` (`git diff origin/main -- '.claude/skills/*/SKILL.md' | grep '^[+-]model:'` empty) (FR-006)
- [ ] T013 [US3] Record the phase 14 spec-reviewer verdict (APPROVE, 0 CRITICAL/HIGH) in `specs/704-auto-phase-model-pins/auto-run.md` once the review has run (SC-004)

## Dependencies

T001 first. T002 (red) before T003-T005. T006 parallel with T003-T005. T007 after T005. T008-T010 after phases 6-7 have run. T011-T012 after T007. T013 after review.

## Parallel

T006 with T003-T005; T009 with T008.

## Strategy

MVP = US1 (T001-T007): the dispatch plus its spec. US2 and US3 follow with the measurement and the checks.

## FR to task

FR-001 T002 T003 T004 · FR-002 T002 T005 · FR-003 T003 T004 · FR-004 T003 T008 · FR-005 T008 T009 T010 · FR-006 T011 T012 · FR-007 T001 T007 · FR-008 T002 T011 · FR-009 T003
