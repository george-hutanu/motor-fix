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
