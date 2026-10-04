# Deferred — 434-agent-pr-review

Verified findings that are real but not this change.

- [ ] `.claude/scripts/pr-test/services.mjs` composePlan — **medium** — the Docker path (`compose up -d --wait … minio-setup`, `down -v`) has never run: this machine has no Docker. Run one tester lap on a Docker host and fix what it shows (code-reviewer, 2026-10-04).
- [ ] `.claude/scripts/artifact-lint.spec.mjs:101` — **medium** — pre-existing: the two `diff-audit` tests run the audit over the live repository against `merge-base HEAD main`; with a stale local `main` (64 commits behind origin here) or a large branch they pass 5 s and time out. Not touched by this feature; CI's Harness job is green (spec-reviewer, 2026-10-04).
- [ ] `.claude/scripts/pr-test/sweep.mjs`, `post.mjs`, `notion-status.mjs` and 17 other harness scripts — **low** — pre-existing convention: the CLI entry check compares `import.meta.url` with a `file://` template, which breaks on a path with spaces; `pathToFileURL(process.argv[1]).href` everywhere (code-reviewer, 2026-10-04).
- [ ] `.claude/agents/org-researcher.md` — **medium** — its tool list names Notion servers (`mcp__claude_ai_Notion__*`, `mcp__f3041bc4-…`) that are not connected in this session, so `/speckit-context` returned UNAVAILABLE; add the connected server's tool names (run log, phase 3).
- [ ] GitHub branch protection — **decision for the owner** — `agent-review` is enforced by the harness gates, not by GitHub; making it a required status check is a repository setting.
