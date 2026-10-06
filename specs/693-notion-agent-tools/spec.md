# Feature Specification: Give the Notion agents the current connector's tools

**Feature Branch**: `693-notion-agent-tools`
**Created**: 2026-10-06
**Status**: Archived (2026-10-06)
**Level**: 1 (one-session)
**Notion story**: ST-693 — https://app.notion.com/p/3f0607bff0d281b3b181cde072bd7f9c
**Epic**: EP-1 Foundations
**Type**: Tech debt (harness bug)

## Why

`.claude/agents/org-researcher.md` and `.claude/agents/spec-reviewer.md` grant
their Notion tools by MCP server id on the frontmatter `tools:` line:
`mcp__claude_ai_Notion__*`, `mcp__f3041bc4-d91f-4aa7-a3e8-b9172efcd78f__*` and
`mcp__828510aa-7547-4d43-8807-be1f9e5d3a0f__*`. The desktop app's Notion
connector gets a new id between sessions; today it is
`mcp__fd62790a-b7ca-480e-9cf5-9073c1192ba8__*`, on neither list, so both
subagents start with no Notion tool and `/speckit-context` returns
`[UNAVAILABLE: notion]` for every story (ST-432, 2026-10-06). PR #27 (merged
2026-10-04) patched one id by hand; the next change broke it again two days
later. Every story pays for this: no context digest, and a spec review that
cannot read the story.

A cross-server wildcard (`mcp__*__notion-fetch`) was probed with
`claude -p --agents` and grants nothing, and a deny list cannot name write
tools under an id nobody knows yet, so the allowlist stays and must be kept
current by a tool, not by hand.

## User Scenarios

### Story 1: the next id change is a one-command fix (P1)

A story agent's `/speckit-context` reports no Notion tool. The owner (or the
orchestrating session) runs `node .claude/scripts/notion-agent-tools.mjs detect`,
which names the connector id this project's recent sessions carried that the
agents lack, then `add <id>`, which puts that server's read tools on every
Notion agent. The next `/speckit-context` reads Notion.

**Acceptance**: `detect` exits 1 and names the missing id while the agents lack
it; after `add <id>` it exits 0, `check` exits 0, and both agent files list the
new server's read tools. Running `add <id>` again changes nothing.

### Story 2: the agents stay read-only by construction (P1)

Whatever id is added, neither agent ever gains a Notion write tool.

**Acceptance**: `check` exits 1 when a Notion agent lists any tool whose name
matches create, update, move, duplicate, delete or comment under any server
id, or when the two agents list different server ids, or when one lists a
read tool outside its own set. `add` only ever writes read tools.

### Story 3: a missing tool is reported plainly (P2)

When a Notion agent starts without a Notion tool it says so in words the
caller can act on, instead of a bare `[UNAVAILABLE: notion]`.

**Acceptance**: `org-researcher` writes
`[UNAVAILABLE: notion — no Notion tool in this agent; run node .claude/scripts/notion-agent-tools.mjs detect, then add <id>]`
into `context.md` and its reply; `spec-reviewer` puts the same line in its
report and reviews without Notion. `/speckit-context` and speckit-auto's
phase 3 text tell the caller to run `detect` then `add` on that message.

### Story 4: the harness notices drift before a story does (P2)

`node .claude/scripts/doctor.mjs` reports `detect`'s finding as a warning, so
a stale list shows up in the health check and not in a story run.

## Requirements

- **FR-001**: Both agents carry the current server's read tools:
  `org-researcher` lists `notion-search`, `notion-fetch`, `notion-get-comments`,
  `notion-query-data-sources` and `notion-get-tool-access`; `spec-reviewer`
  lists `notion-search`, `notion-fetch` and `notion-get-comments`. Today's id,
  `fd62790a-b7ca-480e-9cf5-9073c1192ba8`, is on both lists when this merges.
- **FR-002**: No Notion write tool (a name starting `notion-create`,
  `notion-update`, `notion-move`, `notion-duplicate`, `notion-delete` or
  `notion-upload`, which covers `notion-create-comment`; the read tool
  `notion-get-comments` stays allowed), nor a whole-server grant
  (`mcp__<id>` or `mcp__<id>__*`), ever appears in either agent's tools or,
  for a Notion server, in `permissions.allow`.
- **FR-003**: `.claude/scripts/notion-agent-tools.mjs` owns the list, with
  three commands:
  - `check`: exit 1 with one line per finding when a Notion agent lists a
    server id another lacks, lists a read tool outside its set, lacks one of
    its set for a listed server, or lists a write tool, and when
    `.claude/settings.json` `permissions.allow` (if it has one) lacks a
    server the agents list or allows a Notion write tool; exit 0 otherwise.
  - `add <server-id or mcp tool name>`: add that server's read tools to every
    Notion agent, each agent its own set, and the union of those sets to
    `permissions.allow`; idempotent (a second run is a no-op
    and exits 0); accepts a bare id or any `mcp__<id>__notion-*` name.
  - `detect`: read this project's recent Claude Code transcripts
    (`~/.claude/projects/<project slug>/*.jsonl`), collect every
    `mcp__<id>__notion-*` name in their deferred tool lists (never prose), and report the ids the agents
    lack; exit 1 when one is missing, 0 when none is, and 0 with a note when
    no transcript is found.
- **FR-004**: `doctor.mjs` runs `detect` and reports a missing id as a `warn`
  result, never a failure; a `check` finding (lists out of step, a write
  tool) is a `fail`.
- **FR-005**: `org-researcher` and `spec-reviewer` check for a Notion tool
  first and, when none is present, report the line in Story 3; the researcher
  writes it to `context.md` and its reply, the reviewer to its report and
  continues without Notion. `/speckit-context` and speckit-auto phase 3 tell
  the caller to run `detect` then `add` on that line.
- **FR-006**: Harness specs cover the script (`check`, `add`, `detect` on
  fixture agent files and fixture transcripts) under vitest; the existing
  `.claude/agents/agent-replies.spec.mjs` and `npm run test:harness` stay
  green.

## Out of scope

- Changing which agents read Notion, or giving any agent a Notion write tool.
- The Notion connector itself, its id lifecycle, or the desktop app.
- Removing the earlier ids: a session may still carry one.

## Assumptions

- The Notion agents are exactly `org-researcher` and `spec-reviewer`; the
  script finds them by a `mcp__*__notion-` name on their `tools:` line, so an
  agent added later with such a tool is covered with no list to maintain.
  (autonomous default)
- The project slug for `detect` is the cwd with `/` replaced by `-`, as the
  desktop app names it (`-Users-georgehutanu-projects-motor-fix`); the
  worktree's transcripts fall under the main checkout's slug when the session
  starts there, so `detect` reads the main checkout's slug first and the
  cwd's slug when it differs. "Recent" is the newest 20 files by mtime; today
  12 exist and 5 carry the current id. (autonomous default)
- `add` writes the agent files in place and keeps every other tool and the
  frontmatter order; the ids are appended after the last existing Notion
  tool. (autonomous default)
- `check` is not a hook: it runs in the harness specs and from `doctor.mjs`;
  `detect` is advisory because the transcript dir is outside the repo.
  (autonomous default)
- The `[UNAVAILABLE: …]` line keeps the `[UNAVAILABLE: notion — ` prefix so
  every existing grep in `speckit-context`, `phases-plan.md` and
  `phases-close.md` still matches. (autonomous default)

## Success Criteria

- **SC-001**: After `add fd62790a-b7ca-480e-9cf5-9073c1192ba8`, `/speckit-context`
  on this worktree reads the story instead of returning `[UNAVAILABLE: notion]`.
- **SC-002**: `check` and `detect` exit 0 on the merged branch; `doctor.mjs`
  shows no Notion warning.
- **SC-003**: `npm run test:harness` is green, the new spec included.

## Spec Delta

### Capability: `platform`

- **Adds**: none (FR-001–FR-006 are archived in `platform.md` as 693-FR-001–693-FR-006)
- **Modifies**: none
- **Removes**: none
