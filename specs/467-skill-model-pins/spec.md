# Feature Specification: Pin a model to each spec-kit phase

**Feature Branch**: `467-skill-model-pins`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-467 — https://app.notion.com/p/3ef607bff0d28190bd78faa63765a900
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each phase runs on the model chosen for it (Priority: P1)

The owner runs a spec-kit phase (`/speckit-plan`, `/speckit-tasks`, a git
helper, …) from a session on any model. The phase runs on the model its skill
names, not the session's: the strongest where a mistake carries furthest, the
cheapest where the work is mechanical. Orchestrators keep the session's model.

**Independent Test**: read every `speckit-*` skill's frontmatter and compare its
`model` with the mapping below; a skill outside the mapping fails.

**Acceptance Scenarios**:

1. **Given** the specify, plan, correct-course or retro skill, **Then** its frontmatter names `fable`.
2. **Given** the clarify, analyze, tests, implement, converge, harden, bug-assess, bug-fix, elicit or roundtable skill, **Then** it names `opus`.
3. **Given** the size, checklist, tasks, design-check, context, notion-sync, agent-context-update, archive, doctor, learn, evolve, config-gc, any assess-*, bug-test or taskstoissues skill, **Then** it names `sonnet`.
4. **Given** any git-* skill, **Then** it names `haiku`.
5. **Given** the auto, review, pr-test or constitution skill, **Then** it names no model.
6. **Given** a new `speckit-*` skill added without an entry in the mapping, **When** the harness specs run, **Then** they fail and name it.

### Edge Cases

- `speckit-pr-test` is newer than the story's list: it orchestrates the `pr-tester` subagent, so it is treated like `speckit-review` and stays unpinned.
- A quoted value (`model: "opus"`) reads the same as an unquoted one.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The specify, plan, correct-course and retro skills MUST name `model: fable`.
- **FR-002**: The clarify, analyze, tests, implement, converge, harden, bug-assess, bug-fix, elicit and roundtable skills MUST name `model: opus`.
- **FR-003**: The size, checklist, tasks, design-check, context, notion-sync, agent-context-update, archive, doctor, learn, evolve, config-gc, assess-decide, assess-define, assess-intake, assess-research, assess-shape, bug-test and taskstoissues skills MUST name `model: sonnet`.
- **FR-004**: The git-commit, git-feature, git-initialize, git-remote and git-validate skills MUST name `model: haiku`.
- **FR-005**: The auto, review, pr-test and constitution skills MUST NOT name a model.
- **FR-006**: A harness spec MUST fail when a `speckit-*` skill directory is missing from the mapping, or its `model` differs from it.
- **FR-007**: The subagents' frontmatter and the reviewer model router MUST stay unchanged.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007

## Success Criteria *(mandatory)*

- **SC-001**: All 42 `speckit-*` skills are covered: 38 name the model above, 4 name none, and the harness specs are green.

## Clarifications

### Session 2026-10-04

- Q: Where does the model live? → A: the skill's own frontmatter, the field Claude Code reads for a skill, the same way `.claude/agents/*.md` pins its agents. (autonomous default; evidence: `.claude/agents/code-reviewer.md:5`)
- Q: What about `speckit-pr-test`, which the story's list predates? → A: unpinned, like `speckit-review`: it orchestrates a subagent that has its own model. (autonomous default)
- Q: Do AGENTS.md or CLAUDE.local.md need a line? → A: no; neither names phase models today, and the mapping lives once, in the harness spec (Principle V). (autonomous default)

## Assumptions

- Claude Code honours `model` in a skill's frontmatter for the turn the skill runs and accepts the aliases the agents already use (`fable`, `opus`, `sonnet`, `haiku`). Whether a pin holds when `/speckit-auto` invokes the skill inside its own turn cannot be asserted by a spec; it is reported, not tested. (autonomous default)
- The mapping is the owner's, given in the description; this feature does not re-decide it.
