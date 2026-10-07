# Deferred findings: 803-active-plan-pointer

- [ ] `.specify/scripts/bash/update-agent-context.sh:64` — **low** — the Spec Kit core script still targets the tracked `CLAUDE.md` (`CLAUDE_FILE="$REPO_ROOT/CLAUDE.md"`). Nothing in `.claude/` or `.specify/extensions.yml` calls it, and it was on main before this change. Delete it, or have `.claude/scripts/active-plan-pointer.spec.mjs` assert nothing calls it. (code-reviewer, 2026-10-07) — Notion: https://app.notion.com/p/Tech-debt-ST-803-the-Spec-Kit-core-script-still-targets-the-tracked-CLAUDE-md-CLAUDE_FILE-REPO-3f2607bff0d281b29f24c550caa67967
