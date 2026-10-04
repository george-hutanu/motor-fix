# Deferred — 467-skill-model-pins

- [ ] .claude/skills/skill-models.spec.mjs:64 — **low** — the frontmatter readers here and in `.claude/scripts/doctor.mjs:34` match `---\n` only, so a CRLF checkout would fail every pinned skill as `found null`; the repo has no `.gitattributes`, and one line (`* text=auto eol=lf`) covers both readers. Repo-wide line-ending gap, not this change; exposure today is nil (CI on Linux, Biome pins `lf`) (code-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d2815cb6cbdd54a2dcc716
