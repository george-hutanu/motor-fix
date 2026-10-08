# Deferred findings: <feature>

Findings a review verified whose fix is large, so they are not made in this
PR. Borrowed from BMAD's review triage, which routes each verified finding to
**patch** (a small or medium fix, made in this PR even when the problem existed
before the change or sits next to it), **defer** (a large fix), or **decision
needed** (an ambiguous choice that requires a human, available only when a
spec exists to be ambiguous about). AGENTS.md, "Technical debt a review
defers", holds the rule.

The size test: A fix is large when it needs its own design or decision, a data
migration, a different area or epic, or work clearly bigger than the story
itself. A bullet that names none of these arms is not large: fix it in the PR.

One line per finding, each filed as a Notion To do task before the merge
(`speckit-notion-sync debt` appends its URL). `.claude/scripts/retro-evidence.mjs`
reads the checkboxes, so an item stays open until someone closes it, and
`/speckit-retro` reports what is still open.

- [ ] `path/to/file.js:120` — **medium** — large (data migration): <what is wrong and what would happen> (<reviewer>, <date>)
