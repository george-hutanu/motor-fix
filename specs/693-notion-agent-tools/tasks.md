# Tasks: Give the Notion agents the current connector's tools

**Input**: `specs/693-notion-agent-tools/spec.md` (level 1: no plan.md by design)
**Tests**: required first (FR-006); the spec is red before any script code.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Tests first (red)

- [ ] T001 [US1,US2] [FR-003,FR-006] Write `.claude/scripts/notion-agent-tools.spec.mjs` (vitest): `check` on fixture agent files in a temp dir (clean exit 0; exit 1 for a server id one agent lacks, a read tool outside its set, a missing tool of the set, a write tool under any id); `add` (bare id and `mcp__<id>__notion-*` name accepted, each agent gets its own read set, other tools and frontmatter order kept, ids appended after the last Notion tool, second run is a no-op exit 0, never writes a write tool); `detect` on fixture transcripts (exit 1 naming the missing id, 0 once added, 0 with a note when no transcript dir, newest 20 files only, main-checkout slug first). Run it: red.
- [ ] T002 [P] [US3] [FR-005] Extend the spec with a case asserting both agent bodies and `speckit-context/SKILL.md` and `speckit-auto/phases-plan.md` carry the `[UNAVAILABLE: notion — no Notion tool in this agent; run node .claude/scripts/notion-agent-tools.mjs detect, then add <id>]` text. Red.
- [ ] T003 [P] [US4] [FR-004] Add a case asserting `doctor.mjs` reports a missing id from `detect` as `warn`, never a failure. Red.

## Phase 2: The script

- [ ] T004 [US1,US2] [FR-002,FR-003] Write `.claude/scripts/notion-agent-tools.mjs` with `check`, `add <id|tool name>` and `detect`; find the Notion agents by a `mcp__*__notion-` name on the `tools:` line; read sets: researcher `notion-search`, `notion-fetch`, `notion-get-comments`, `notion-query-data-sources`, `notion-get-tool-access`; reviewer `notion-search`, `notion-fetch`, `notion-get-comments`; refuse any write-named tool. T001 green.

## Phase 3: Apply and report

- [ ] T005 [US1] [FR-001] Run `node .claude/scripts/notion-agent-tools.mjs add fd62790a-b7ca-480e-9cf5-9073c1192ba8`; the id is on `.claude/agents/org-researcher.md` and `.claude/agents/spec-reviewer.md`; `check` and `detect` exit 0.
- [ ] T006 [P] [US3] [FR-005] Put the "no Notion tool" report (first check, then the `[UNAVAILABLE: notion — …]` line) in the bodies of `.claude/agents/org-researcher.md` (context.md and reply) and `.claude/agents/spec-reviewer.md` (report, continue without Notion); keep `.claude/agents/agent-replies.spec.mjs` green.
- [ ] T007 [P] [US3] [FR-005] Tell the caller to run `detect` then `add` on that line in `.claude/skills/speckit-context/SKILL.md` and `.claude/skills/speckit-auto/phases-plan.md` phase 3, keeping the `[UNAVAILABLE: notion — ` prefix. T002 green.
- [ ] T008 [US4] [FR-004] `.claude/scripts/doctor.mjs` runs `detect` and reports a missing id as a `warn`. T003 green.

## Phase 4: Verification

- [ ] T009 [FR-006] `npm run test:harness` green (new spec included), `node .claude/scripts/doctor.mjs` shows no Notion warning, `node .claude/scripts/artifact-lint.mjs` clean.

## FR map

| FR | Tasks |
| --- | --- |
| FR-001 | T005 |
| FR-002 | T001, T004 |
| FR-003 | T001, T004 |
| FR-004 | T003, T008 |
| FR-005 | T002, T006, T007 |
| FR-006 | T001, T009 |

Stories: US1 T001 T004 T005; US2 T001 T004; US3 T002 T006 T007; US4 T003 T008.
