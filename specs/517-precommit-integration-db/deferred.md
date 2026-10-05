# Deferred findings: 517-precommit-integration-db

Findings a review verified but deliberately did not act on in this feature.
One line per finding; `.claude/scripts/retro-evidence.mjs` reads the checkboxes.

- [ ] `.claude/scripts/watch.mjs:364` — **low** — follow-up: worktree cleanup prunes the worktree but leaves its pre-commit compose project (`mf-test-<worktree>-<hash>`, PostgreSQL + Redis and their volume) running; take it down with `docker compose -p <project> down -v` when the worktree goes (code-reviewer, 2026-10-05) — Notion: https://app.notion.com/p/3f0607bff0d281d299a3de132688c38e
