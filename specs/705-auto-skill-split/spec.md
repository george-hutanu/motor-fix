# Feature Specification: Split speckit-auto into a lean run order and phase references

**Feature Branch**: `705-auto-skill-split`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-704 — https://app.notion.com/p/3f0607bff0d281eba2e2cd21f5ea6d63
**Epic**: EP-1 Foundations
**PR**: #145

## Why

`.claude/skills/speckit-auto/SKILL.md` is 42492 bytes on `origin/main`
(3486742). Every story agent loads all of it on every turn of a run that
averages 54 turns, though most of it covers a single phase. The file also
carries stale text: app names that do not exist, a claim that `specs/` is
git-excluded, and local mutation runs, which happen only in CI.

## User Scenarios

### Story 1: a story agent loads only what the phase in hand needs (P1)

A story agent running `/speckit-auto` reads a lean SKILL.md: the run order,
the Autonomy Contract, the Hard Stops and a pointer per phase. It reads a
reference file only when the run reaches it, and the tail agent reads only
SKILL.md and `tail.md`.

**Acceptance**: SKILL.md is at most 15000 bytes. Every phase 0–17 has one
run-order row that names the file holding its detail.

### Story 2: no rule is lost in the move (P1)

**Acceptance**: `layout.spec.mjs` holds the rule inventory of the
single-file skill. It passes only when each rule is found exactly once,
in the file it applies to, and every phrase another harness spec greps
for resolves where that spec reads it.

## Requirements

- **FR-001**: SKILL.md holds the frontmatter, User Input, Goal, Autonomy
  Contract, the run-order table with a reference-file column, Size, Run state,
  Hard Stops, Notifying, the Final Report envelope and the Agent Execution
  Rules deltas. Nothing else.
- **FR-002**: Every other section moves, unchanged in substance, to one of
  these files beside it: `preflight.md`, `phases-plan.md` (1–8),
  `phases-build.md` (9–12), `phases-close.md` (13–17), `commit-protocol.md`,
  `hand-off.md`, `tail.md` and `report.md`.
- **FR-003**: No rule is dropped, loosened or duplicated. `layout.spec.mjs`
  enforces this.
- **FR-004**: The harness specs that read speckit-auto keep their meaning and
  read the file that now holds their phrases: `tail-handoff-wiring`,
  `task-runner`, `agent-replies`, and `lifecycle-wiring` once #141 merges.
- **FR-005**: The stale text is corrected:
  - Name the real apps (web, api, worker, mcp, web-e2e) in the
    import-extension rule.
  - Say that `specs/`, `.specify/` and `.claude/` are tracked and committed.
  - State that mutation testing runs only in CI.
  - Use `biome.jsonc`.
  - Replace "Jira key" with "story id".
  - Replace the Notion "lanes" wording with "connector".
- **FR-006**: The report measures bytes with `wc -c`:
  - SKILL.md before and after.
  - The bytes a typical level-2 story run loads.
  - The bytes a tail agent loads.
- **FR-007**: `speckit-auto`'s `hand-off.md` and `tail.md` (the lines listing
  the ready and merge commands) and `speckit-git-commit/SKILL.md` (the
  first-commit recipe) name one `lifecycle.mjs` call per step instead of the
  recipe.

## Assumptions

- The tail prompt names `tail.md` in place of "The tail" in SKILL.md, since
  the tail agent needs no other file. (autonomous default)
- The byte budget of 15000 leaves room for #144's "Phase agents" paragraph,
  about 1.5 KB, in SKILL.md. (autonomous default)
- Phase 17 has no subsection today, only its row. It gets a pointer to
  `speckit-archive` in `phases-close.md`. (autonomous default)

## Success Criteria

- **SC-001**: SKILL.md is at most 15000 bytes, down from 42492.
- **SC-002**: `npm run test:harness` is green, `layout.spec.mjs` included.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-006
- **Modifies**: `696-FR-009` → `FR-007`
- **Removes**: `704-FR-007` (it fenced ST-697's own edit of SKILL.md to the dispatch lines; that change has merged, and this split moves those sections by design)
