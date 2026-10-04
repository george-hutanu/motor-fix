# Tasks: Pin a model to each spec-kit phase

**Input**: `specs/467-skill-model-pins/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [ ] T001 [US1] Test: `.claude/skills/skill-models.spec.mjs` (new) — the mapping of every `speckit-*` skill to its model or to none; each skill directory's `SKILL.md` frontmatter `model` equals its entry; a directory missing from the mapping fails by name (FR-001–FR-006)

## Phase 2: Implementation

- [ ] T002 [US1] Add `model: fable` to the frontmatter of `.claude/skills/speckit-{specify,plan,correct-course,retro}/SKILL.md` (FR-001)
- [ ] T003 [US1] Add `model: opus` to `.claude/skills/speckit-{clarify,analyze,tests,implement,converge,harden,bug-assess,bug-fix,elicit,roundtable}/SKILL.md` (FR-002)
- [ ] T004 [US1] Add `model: sonnet` to `.claude/skills/speckit-{size,checklist,tasks,design-check,context,notion-sync,agent-context-update,archive,doctor,learn,evolve,config-gc,assess-decide,assess-define,assess-intake,assess-research,assess-shape,bug-test,taskstoissues}/SKILL.md` (FR-003)
- [ ] T005 [US1] Add `model: haiku` to `.claude/skills/speckit-git-{commit,feature,initialize,remote,validate}/SKILL.md` (FR-004)

## Phase 3: Proof

- [ ] T006 `npm run test:harness` green; `git diff origin/main -- .claude/agents .claude/hooks` empty; `node .claude/scripts/doctor.mjs` reports skills/frontmatter OK (FR-005, FR-007, SC-001)

## FR → test

| FR | Proof |
|---|---|
| FR-001–FR-006 | `.claude/skills/skill-models.spec.mjs` |
| FR-007 | empty diff under `.claude/agents` and `.claude/hooks` |
