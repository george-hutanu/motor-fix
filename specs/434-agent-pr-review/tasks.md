---
description: "Tasks: agent QA review of every ready PR"
---

# Tasks: Test and review every ready PR like a QA engineer before it merges

**Input**: `specs/434-agent-pr-review/` — spec.md, plan.md, design.md, context.md

**Tests**: required (constitution II, red first). Harness specs on vitest beside each file. The FR → test mapping is at the end, not in the source.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Add `axe-core` 4.13.0 to devDependencies in `package.json` and `package-lock.json`
- [X] T002 [P] Read `POSTGRES_PORT`, `REDIS_PORT`, `MINIO_PORT` in `docker-compose.yml` with the old fixed ports as defaults

## Phase 2: User Story 5 — heavy commands share one lock (P2, foundational: everything heavy below runs through it)

- [X] T003 [US5] Red tests in `.claude/scripts/heavy.spec.mjs`: runs the command and returns its code; re-entrant under `MOTOR_FIX_HEAVY_HELD`; a held lock with `MOTOR_FIX_HEAVY_WAIT=1` exits 75 without running; an unmet memory floor with a bounded wait exits 75; exports `JEST_MAX_WORKERS=2`
- [X] T004 [US5] Implement `scripts/heavy.sh` (lockf on macOS, flock on Linux, bounded wait, re-entrant)
- [X] T005 [US5] `.husky/pre-commit` under the lock with `--parallel=1`; `jest.preset.cjs` reads `JEST_MAX_WORKERS`; `stop-test-gate.sh` and `post-edit-check.sh` run Jest through the lock with a bounded wait and `--maxWorkers=2`, reporting a skip

## Phase 3: User Story 2 — the verdict decides the merge (P1)

- [X] T006 [P] [US2] Red tests in `.claude/scripts/pr-test/findings.spec.mjs`: severity table, web-touching cap, verdict, changed GET endpoints from two OpenAPI documents, apps to boot from a diff, Markdown report
- [X] T007 [US2] Implement `.claude/scripts/pr-test/findings.mjs`
- [X] T008 [P] [US2] Red tests in `.claude/scripts/pr-test/post.spec.mjs` with a fake `gh`: review event, COMMENT fallback on refusal, status on the tested commit, section replaced or comment added, dry run posts nothing, a failed status call fails the run
- [X] T009 [US2] Implement `.claude/scripts/pr-test/post.mjs`
- [X] T010 [P] [US2] Red tests in `.claude/hooks/merge-gate.spec.mjs` and `.claude/hooks/pr-lifecycle-gate.spec.mjs`: merge refused without `agent-review` success, allowed with it; command parsing; Stop gate names the tester when the review is missing
- [X] T011 [US2] Implement `.claude/hooks/merge-gate.mjs`, update `.claude/hooks/pr-lifecycle-gate.mjs`, register `pre:bash:merge-gate` in `.claude/hooks/registry.json` and `.claude/settings.json`
- [X] T012 [US2] Eval cases in `.claude/evals/cases/merge-gate.json` and `.claude/evals/cases/pr-lifecycle.json`: block without the status, pass with it; doctor `--bless-hooks` after reading the diff

## Phase 4: User Story 1 — a ready PR is tested and reviewed (P1)

- [X] T013 [P] [US1] Red tests in `.claude/scripts/pr-test/services.spec.mjs`: distinct bindable free ports; health wait succeeds when a server comes up and times out otherwise; compose and local service commands built from ports and project name
- [X] T014 [US1] Implement `.claude/scripts/pr-test/services.mjs`
- [X] T015 [P] [US1] Red tests in `.claude/scripts/pr-test/worktree.spec.mjs` against a temporary origin: the worktree is at the PR head and outside the caller's tree; teardown removes it
- [X] T016 [US1] Implement `.claude/scripts/pr-test/worktree.mjs`
- [X] T017 [P] [US1] Red tests in `.claude/scripts/pr-test/sweep.spec.mjs`: the matrix (routes × 3 viewports × 2 schemes × 2 languages, mobile with touch), screenshot names, observations to findings
- [X] T018 [US1] Implement `.claude/scripts/pr-test/sweep.mjs` (one browser, sequential contexts, axe, overflow, screenshots)
- [X] T019 [US1] Implement `.claude/scripts/pr-test/run.mjs`: re-exec under `scripts/heavy.sh`, worktree, services, install, migrate, build, boot, health, sweep, flows file, API calls, affected tests, e2e, report; teardown in `finally` and on SIGINT/SIGTERM
- [X] T020 [US1] `.claude/agents/pr-tester.md` and `.claude/skills/speckit-pr-test/SKILL.md`

## Phase 5: User Story 4 — Notion shows QA and Blocked (P2)

- [X] T021 [P] [US4] Red tests in `.claude/scripts/notion-status.spec.mjs`: start/review/qa/finish ladder, never backwards, blocked records the prior status, unblock returns to it, Done never moves, timeline names
- [X] T022 [US4] Implement `.claude/scripts/notion-status.mjs`; update `.claude/skills/speckit-notion-sync/SKILL.md`

## Phase 6: User Story 3 — the loop and the lifecycle (P1)

- [X] T023 [US3] Wire the tester, the QA status, the fix-and-retest loop and the Blocked event into `.claude/skills/speckit-auto/SKILL.md`, `.claude/skills/speckit-review/SKILL.md`, `.claude/skills/speckit-archive/SKILL.md`
- [X] T024 [US3] Constitution VII and Enforcement (v1.5.0), AGENTS.md lifecycle and the heavy-lock line, CLAUDE.local.md gate table without growing past its baseline

## Phase 7: Proof

- [ ] T025 Run the tester on this feature's PR; act on its findings; copy the evidence to `specs/434-agent-pr-review/pr-review/`
- [ ] T026 Dry-run the tester on PR #14 without posting; evidence in `specs/434-agent-pr-review/pr-review/pr-14-dry-run/`
- [ ] T027 `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check`, `node .claude/scripts/doctor.mjs`, `npm run lint`

## FR → test

| FR | Test |
| --- | --- |
| FR-001 | `worktree.spec.mjs` |
| FR-002 | `services.spec.mjs` |
| FR-003 | `services.spec.mjs` (health wait), `findings.spec.mjs` (apps to boot) |
| FR-004 | `sweep.spec.mjs` (matrix) |
| FR-005 | `sweep.spec.mjs` (observations to findings) |
| FR-006 | `findings.spec.mjs` (severity table, web cap) |
| FR-007 | `findings.spec.mjs` (changed endpoints) |
| FR-008 | `findings.spec.mjs` (test failure is blocker) |
| FR-009 | `findings.spec.mjs` (verdict) |
| FR-010 | `post.spec.mjs` |
| FR-011 | `merge-gate.spec.mjs`, `evals/cases/merge-gate.json` |
| FR-012 | `pr-lifecycle-gate.spec.mjs`, `evals/cases/pr-lifecycle.json` |
| FR-013 | `heavy.spec.mjs` (re-entrant), run.mjs re-exec exercised by the T025/T026 runs |
| FR-014 | `heavy.spec.mjs` |
| FR-015 | `heavy.spec.mjs` (bounded wait, exit 75); hooks exercised by the session |
| FR-016 | `notion-status.spec.mjs` |
| FR-017 | spec-reviewer (prose) |
