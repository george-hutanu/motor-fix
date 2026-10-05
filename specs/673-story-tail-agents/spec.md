# Feature Specification: Story and tail agents start with a smaller first turn

**Feature Branch**: `673-story-tail-agents`
**Created**: 2026-10-05
**Status**: Archived (2026-10-05)
**Level**: 1 (one-session)
**Notion story**: ST-673, https://app.notion.com/p/3f0607bff0d281feb2adccfde12ec4ef (Task, EP-1)
**Epic**: EP-1 Foundations

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A dispatched task agent carries only the tools it uses (Priority: P1)

The orchestrating session and `/speckit-watch` dispatch one agent per task: the
story's agent (`/speckit-auto` to its hand-off), the tail agent, and the watch
fixes. They are `general-purpose` today, so each starts with every built-in and
every connected server: about 57k tokens of first turn, against about 16k for
this repo's agents that declare their tools. A dedicated definition removes the
browser, simulator, visualize and session-management tools while keeping
Bash, the file tools, Skill, Agent, ToolSearch, Monitor, TaskStop,
EnterWorktree, PushNotification, Artifact (the design check reads the mock
with it), the WebStorm inspections harden runs, and the Notion connector,
whatever its id.

**Independent Test**: `claude -p --agent task-runner --output-format json "Reply OK"`
from the worktree reports a first turn below the `general-purpose` figure, and
the same agent lists Skill and Agent among its tools.

**Acceptance Scenarios**:

1. **Given** the definition, **When** it is read, **Then** it pins `model: opus`, has no `tools:` allowlist, and its `disallowedTools` deny list names the heavy built-ins and servers and none of the tools the runs use, Notion included.
2. **Given** every dispatch point for a story, a tail or a watch fix, **When** it is read, **Then** it names `subagent_type: task-runner`, never `general-purpose`, and `merge` still passes `model: "sonnet"`.

### User Story 2 - No agent re-reads the rules it already has (Priority: P1)

AGENTS.md and CLAUDE.local.md reach every agent through CLAUDE.md; the dispatch
prompts still told agents to follow them, and agents re-read them in full (241
and 117 times). The constitution (26 KB) was read 238 times, mostly by authors
who need only its principles and gates.

**Independent Test**: no dispatch template or definition asks for a full read
of AGENTS.md or CLAUDE.local.md; the definition gives the delta command; the
card exists and matches the constitution.

**Acceptance Scenarios**:

1. **Given** the dispatch templates and the definition, **When** they are read, **Then** none says to follow or read AGENTS.md or CLAUDE.local.md, and the definition gives `git diff -R origin/main -- AGENTS.md CLAUDE.local.md`.
2. **Given** `constitution.md` gains, drops or renames a principle, or changes version, **When** the harness specs run, **Then** the card check fails until the card follows.
3. **Given** `/speckit-auto`'s Preflight and phase 1, **When** they are read, **Then** they read the card; `spec-reviewer`, `code-reviewer` and `pr-tester` still read the full constitution.

### Edge Cases

- A new Notion connector id: a deny list does not name Notion, so its tools stay reachable under any id (an allowlist cannot match `mcp__*__notion-*`; mid-name wildcards are ignored).
- A connector is denied by its `mcp__claude_ai_<name>` id (Gmail, Calendar, Drive among them); when it connects under a per-session UUID instead, the name no longer matches, and since its tools are deferred only their names reach the first turn.
- A watch `merge` fix keeps `model: "sonnet"`: the Agent call's `model` overrides the definition's `opus`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `.claude/agents/task-runner.md` MUST pin `model: opus`, MUST NOT carry a `tools:` allowlist, and its `disallowedTools` MUST deny the artifact comment and data, browser, Chrome, simulator, visualize and session-management tools while denying none of Bash, Read, Edit, Write, Grep, Glob, Skill, Agent, ToolSearch, Monitor, TaskStop, EnterWorktree, PushNotification, Artifact (the design check's mock read), the WebStorm inspections (harden) or any Notion tool.
- **FR-002**: The story dispatch and the tail dispatch in `speckit-auto`, and step 4 of `speckit-watch` (resume, tail, rerun-qa, fix-ci, merge), MUST name `subagent_type: task-runner` and no story, tail or watch dispatch MUST name `general-purpose`; `merge` MUST keep `model: "sonnet"`; AGENTS.md MUST name the definition for the story and tail agents.
- **FR-003**: No dispatch template in `speckit-auto` or `speckit-watch`, and no agent definition, MUST tell an agent to follow or read AGENTS.md or CLAUDE.local.md, or list either among the files to read; `task-runner.md` MUST say they are in context and give the delta command.
- **FR-004**: `.specify/memory/constitution-card.md` MUST name every principle of `constitution.md` (numeral and title, in order) and its version, in at most 3,000 bytes; a harness spec MUST fail when they drift.
- **FR-005**: `speckit-auto`'s Preflight and phase 1 MUST read the card instead of the full constitution; `spec-reviewer`, `code-reviewer` and `pr-tester` MUST keep reading `constitution.md`.
- **FR-006**: The definition MUST carry the AGENTS.md reply envelope verbatim and a cap of at most 10 lines.

## Success Criteria *(mandatory)*

- **SC-001**: The first turn of `task-runner`, measured with `claude -p --agent task-runner --output-format json "Reply OK"` (input + cache creation + cache read), is below the same call without an agent, and is reported in the PR body. Never a number not measured.
- **SC-002**: The same agent sees the Skill and Agent tools.
- **SC-003**: No gate is loosened: every harness spec, `doctor.mjs` and the eval baseline pass unchanged.

## Assumptions

- One definition, `task-runner`, serves the story agent, the tail and every watch fix: their tools, model, context rules and envelope are the same, and the prompt names the part to run; two files would duplicate every line. (autonomous default)
- A deny list rather than an allowlist: measured before review lap 1 (Artifact and WebStorm still denied), the allowlist saved about 1.1k tokens (34.9k against 36.0k) but drops Notion whenever the connector's id changes (seen: `claude_ai_Notion`, `828510aa-…`, `fd62790a-…`); the deny list keeps it under any id. (autonomous default)
- `disallowedTools` in an agent file's frontmatter is honoured by Claude Code 2.1.289, verified by listing the agent's tools headless. (autonomous default)
- The delta command runs in the checkout the agent starts in (the dispatcher's, whose copy CLAUDE.md loaded), before `EnterWorktree`; `-R` makes `+` lines the ones `main` added. (autonomous default)
- The card cap is 3,000 bytes, a little above the ~2 KB asked, so each principle keeps its gate. (autonomous default)
- Phase 1 still checks the full file for a version and placeholders, by `grep`, not a read. (autonomous default)
- Skill helpers that are not story or tail runs (`speckit-plan` research, the `notion-ready` fallback) stay `general-purpose` on Sonnet. (autonomous default)
- The preflight's 45 failing suites are all `*.integration.spec.ts` with no PostgreSQL or Redis in this worktree (112 ECONNREFUSED); unit, typecheck and lint were green and the change touches no product code. (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001-FR-006
