# Feature Specification: The constitution and harness docs name biome.jsonc

**Feature Branch**: `613-biome-docs`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "Point the constitution and harness docs at biome.jsonc" — PR #99 (ST-609) renamed the root Biome config from `biome.json` to `biome.jsonc`; AGENTS.md was updated, the constitution and harness docs were not.

Notion: ST-613 https://app.notion.com/p/3f0607bff0d28138b2b8da4ddbb4cf68 (Task, Low, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Deferred from the PR tester's review of PR #99.

## Finding: five live lines name a file that no longer exists

- `.specify/memory/constitution.md:246` (Principle IV: "from the root `biome.json`").
- `.specify/contexts/implement.md:10`.
- `.claude/hooks/post-edit-check.sh:10` (a comment).
- `.claude/agents/spec-reviewer.md:55` ("a second biome.json").
- `.claude/skills/speckit-auto/SKILL.md:49`, named by the story, no longer mentions Biome: nothing to change there.

No script opens the file by name, so nothing is broken; the text is out of date.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The rules name the config that exists (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the constitution, the phase contexts, the hooks, the agents and the skills, **When** they name the root Biome config, **Then** they name `biome.jsonc`.
2. **Given** the constitution's change, **When** it is amended, **Then** it is a PATCH (1.8.1 → 1.8.2) with a Sync Impact Report entry.

### Edge Cases

- Sync Impact Report entries and frozen `specs/*/` artifacts are history and keep the name they had.
- The spec-reviewer's "a second biome.json" means any per-project Biome config; it says "a second Biome config".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: No live harness text (`AGENTS.md`, `.specify/memory/constitution.md` outside its Sync Impact Report, `.specify/contexts/`, `.claude/hooks/`, `.claude/agents/`, `.claude/skills/`) MAY name the root Biome config as `biome.json`.
- **FR-002**: The constitution MUST be amended as a PATCH to 1.8.2, with its Sync Impact Report, and the files that name its version MUST follow.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: A harness spec finds zero `biome.json` (not `biome.jsonc`) mentions in the live text of FR-001.
- **SC-002**: `npm run test:harness` and `node .claude/scripts/doctor.mjs` pass (the edited hook re-blessed).

## Assumptions

- Level 1: the intent is fully stated by the story; the Notion "boards" fact is the epic's rollup, not a design for this task (autonomous default).
