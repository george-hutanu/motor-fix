# Auto run: 287-public-tab-bar (ST-287)

- Description: ST-287 "Move between public screens with a bottom tab bar on a phone": a bottom tab bar on the public phone screens, built against placeholder routes for the EP-4 screens.
- Start: branch `287-public-tab-bar` from `origin/main` 418b111 (fast-forwarded from b5b5419 after PR #33 merged); worktree `.claude/worktrees/agent-ad48048b29bc7dbd7`.
- Rules followed: AGENTS.md, CLAUDE.local.md and the skills at origin/main. The Skill tool loaded `speckit-auto` from the main checkout, which carries uncommitted local edits ("never push"); the origin/main copy (push every commit, full hand-off) and the owner's instruction win.
- Test services: local PostgreSQL (`motorfix_287`, migrated with psql) and Redis db 7; Docker is not installed on this machine.

## 0. Size
- Level 2 (feature): the intent has open choices (placeholder routes, Cont behaviour, keyboard rule).

## Preflight
- `npm run typecheck && npm run lint && npm run test` under heavy.sh: green ("Successfully ran target typecheck for 12 projects", "Successfully ran target test for 10 projects").

## 1. Constitution
- v1.6.0, no placeholders. Principle I first; VII drives the lifecycle.

## 2. Specify
- Branch made by hand as `287-public-tab-bar` (story-numbered, like every story branch here) before the hook ran.
- Design checked first (design.md): mock boards Mobile · Results, Mobile · Home, Mobile · Garage profile.
- Autonomous defaults (spec Assumptions): placeholder paths `garages`, `garages/<garage>`, `mechanics/<mechanic>`, `account`; Cont signed out → account placeholder; last brand from the results address, in memory; no bar on the server render of `/`; sticky bar; keyboard = text field focus; texts in the `public` area.
