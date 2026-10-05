# Tasks: No agent holds its context across the CI and QA wait

**Input**: spec.md, plan.md in `specs/688-qa-wait-handoff/`
**Tests**: required (Constitution II); every test task is red before its implementation task.

## Phase 1: Foundational — the hand-off line

- [x] T001 [P] Write `.claude/scripts/pr-test/qa-run.spec.mjs`: `qaRunLine` formats `- QA run: <id> · head <sha> · lap <n> · <url>`; `parseQaRun` reads id and head back, takes the last line, returns null for a note without one or a short sha (FR-001, FR-003)
- [x] T002 Implement `.claude/scripts/pr-test/qa-run.mjs` (FR-003)

## Phase 2: User Story 1 — the story agent ends with QA running (P1)

- [x] T003 [US1] Extend `.claude/scripts/pr-test/dispatch.spec.mjs`: `parseArgs` reads `--no-wait` and `--run <id>`; with a fake `gh` on PATH, `--no-wait` dispatches once, prints the hand-off line, never calls `run watch` or `run download`, exits 0; exits 2 with no line when no run appears (FR-001)
- [x] T004 [US1] Implement `--no-wait` in `.claude/scripts/pr-test/dispatch.mjs`; poll lists before it sleeps (FR-001)
- [x] T005 [US1] Extend `.claude/scripts/tail-handoff-wiring.spec.mjs`: the Hand-off dispatches with `--no-wait`, writes the `QA run:` line to `handoff.md`, ends with `NEXT: tail #<n> after QA run <id>`, and starts no `--watch` wait (FR-007)
- [x] T006 [US1] Rewrite Hand-off steps 4–5 in `.claude/skills/speckit-auto/SKILL.md` (FR-007, FR-008)

## Phase 3: User Story 2 — the watcher waits (P1)

- [x] T007 [US2] Extend `.claude/scripts/watch.spec.mjs`: `fixOf` gives `waiting` with no fix for CI pending / none / run unfinished / run unreadable, `tail` at once when both finished (CI pass or fail), today's rule for no line or an older head, and no-checks past the threshold; `collect` reads the line and asks `runOf` only for a handed-off ready PR at its head; `dispatchPlan` dispatches nothing for `waiting` (FR-004, FR-005, FR-006)
- [x] T008 [US2] Implement the `qaRun` row field, the `runOf` dependency and the waiting rule in `.claude/scripts/watch.mjs`; count `waiting` in the board header (FR-004, FR-005, FR-006)
- [x] T009 [US2] Update the `tail` row and the waiting verdict in `.claude/skills/speckit-watch/SKILL.md` (FR-012)

## Phase 4: User Story 3 — the tail reviews a finished run (P1)

- [x] T010 [US3] Extend `.claude/scripts/pr-test/dispatch.spec.mjs`: `--run <id>` with a fake `gh` dispatches nothing, exits 2 on a run not completed, downloads that run's artifact into `--out` and exits 0/1/2 by the report, refusing a report about another head (FR-002)
- [x] T011 [US3] Implement `--run <id>` in `.claude/scripts/pr-test/dispatch.mjs` (FR-002)
- [x] T012 [US3] Extend `.claude/scripts/tail-handoff-wiring.spec.mjs` and `.claude/scripts/pr-test/qa-in-ci.spec.mjs`: the tail runs the tester on the run (`RUN`), dispatches a fix lap with `--no-wait` after `run-state.mjs repair`, and ends; pr-tester takes `RUN`, uses `--run`, raises "flow not run"; the flows live in `.specify/.cache/qa-flows-<pr>.mjs` (FR-009, FR-010)
- [x] T013 [US3] Rewrite The tail steps 1–4 in `.claude/skills/speckit-auto/SKILL.md`, leaving its dispatch paragraph (PR #138) alone (FR-009)
- [x] T014 [P] [US3] Update `.claude/agents/pr-tester.md` (inputs, §2 flows path, §3 `RUN`) and `.claude/skills/speckit-pr-test/SKILL.md` (procedure step 4–6) (FR-010, FR-012)
- [x] T015 [US3] Update AGENTS.md lifecycle steps 4–6 (FR-012)

## Phase 5: Polish

- [x] T016 Run `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check`, `node .claude/scripts/doctor.mjs`; confirm `git diff origin/main -- .claude/hooks/merge-gate.mjs .claude/hooks/pr-lifecycle-gate.mjs .claude/evals/cases/merge-gate.json .claude/scripts/pr-test/carry.mjs .claude/scripts/run-state.mjs` is empty (FR-011, SC-002, SC-003)

## Dependencies

T001→T002→T003/T007; T003→T004; T010→T011; each wiring spec before its prose task. T014 is parallel with T013.
