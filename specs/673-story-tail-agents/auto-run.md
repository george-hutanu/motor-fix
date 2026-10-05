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

## review lap 1
spec-reviewer BLOCK (CRITICAL: Artifact denied, the design check reads the mock with it; HIGH: code-reviewer and spec-reviewer list AGENTS.md to read). code-reviewer BLOCK (HIGH: Artifact; HIGH: REREAD missed main's wrapped `> Follow\n> AGENTS.md`; MEDIUM: webstorm denied though harden runs it, card claim too wide, EnterWorktree/Monitor unmeasured). Fixed: Artifact and WebStorm reachable (FR-001 amended), the reviewers' AGENTS.md lines say it is in context, REREAD strips quote markers and backticks and catches bullets (proved against origin/main's four files), cap pinned, duplicate exists tests dropped, speckit-auto wording. Deferred (deferred.md): author skills still load the full constitution; Jira steps; reviewer/org-researcher Notion ids.

## measure (after lap 1)
`claude -p --agent task-runner --output-format json "Reply OK"`: **43,519** (Artifact's schema is ~8.6k of it); no agent: **55,240**. ToolSearch returns EnterWorktree, Monitor, TaskStop, PushNotification; Artifact, Skill and Agent are direct.

## review lap 2
spec-reviewer APPROVE, code-reviewer APPROVE (no CRITICAL/HIGH). Patched: task-runner no longer says "you do not" read the constitution; FR-003's "in your context" pinned; ArtifactData pinned; REREAD covers "the current"/"both" and numbered lists (still flags main's four texts); deferred.md in the severity/path format retro-evidence parses; spec assumption dates its 34.9k/36.0k figures. Harness 54 files / 1199 tests green.

## Final Report
ST-673, PR #138 ready at 0492ec2 (labels QA, tooling, scope: harness, EP-1); Notion QA. Start 10bdb8f (origin/main merged at 39b1165 and 479d592).
- First turn (headless, Opus, input + cache creation + cache read of "Reply OK"): task-runner 43,519 vs no agent 55,240 (brief: ~57k general-purpose). Deny list chosen over allowlist: the allowlist can't follow the Notion connector's changing id.
- Harness 54 files / 1199 tests green; doctor 16 ok; config-scan 0 high/0 medium; context-audit held.
- Review: two laps, both reviewers APPROVE at lap 2; 3 deferred items filed as Notion tech debt.
- Retrospective evidence (unjudged): retro-evidence --since eab31fe lists the 4 feature commits; Jev lane unavailable; no instincts triggered.
- Owner decision: a lighter second definition without Artifact for tail/watch fixes (~8.6k less).
