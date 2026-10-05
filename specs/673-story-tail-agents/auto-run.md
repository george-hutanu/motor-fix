# Auto run — 673-story-tail-agents

Description: dedicated agent definitions for the story and tail agents with a trimmed tool set; every story/tail dispatch point switched from `general-purpose`; no full re-read of AGENTS.md / CLAUDE.local.md at dispatch (delta command instead); a constitution card for authors kept in step by a harness spec; the first-turn context measured.

Start commit: 10bdb8f (origin/main 39b1165 merged in before any change, at the coordinator's request).

## size
Level 1 (one-session): the intent is defined by the dispatch (four deliverables, explicit out-of-scope list); harness-only. Phases 2, 7, 9, 10, 12, 14, 16 (+17 steps 1–3).

## constitution
v1.8.1, no placeholders. Principle I first.

## preflight
typecheck and lint green. `npm run test`: unit suites green; 45 failing suites are all `*.integration.spec.ts` (112 ECONNREFUSED: no PostgreSQL/Redis running in this worktree). Autonomous default: not a red start for a harness-only change; CI runs the integration suites. `npm run test:harness`: 52 files, 1184 tests passed.

## notion
ST-673 Planning; EP-1 In progress; notion-ready EP-1 no change.

## specify
spec.md written by hand on the existing branch (FR-001..FR-006, SC-001..003, assumptions marked autonomous default). The `before_specify` branch hook was not run: the branch already existed.

## tasks
tasks.md T001–T004.

## tests
Red: `npx vitest run --config .claude/vitest.config.ts scripts/task-runner.spec.mjs scripts/constitution-card.spec.mjs` → 14 failed, 1 passed (the reviewers already read the full constitution). FR-006 rides on agent-replies.spec.mjs.

## probes (design)
Headless, Opus, first turn = input + cache creation + cache read of "Reply OK": deny list 36,048; allowlist (built-ins + 4 Notion server ids) 34,943; no agent 54,803. Both list Skill and Agent; the deny list keeps `mcp__claude_ai_Notion__*` (44) and leaks the deferred Atlassian and Zoom connectors. Chosen: deny list.

## implement
`task-runner.md` (deny list, Opus, envelope at most 10 lines), `constitution-card.md` (v1.8.1, 2.5 KB), speckit-auto (Parallel runs story dispatch, The tail, Preflight, phase 1), speckit-watch step 4, AGENTS.md step 4 and "Agent replies". `npm run test:harness`: 54 files, 1200 tests green. doctor 16 ok; config-scan 0 high / 0 medium; context-audit held its size. `.claude/` is outside Biome's includes.

## measure (final definition)
`claude -p --agent task-runner --output-format json "Reply OK"`, Opus, first turn (input + cache creation + cache read): **34,876**; same call with no agent: **55,346** (brief: ~57k for general-purpose). Saving 20,470 (37%). Direct tools listed by the agent: Agent, Bash, Edit, Read, Skill, ToolSearch, Write; Notion reachable through ToolSearch under `mcp__claude_ai_Notion__`.
