# Deferred findings — 704-auto-phase-model-pins

- [ ] The trial's phase agents ran as `general-purpose`, not `task-runner`; the first real `/speckit-auto` run under `task-runner` should confirm a phase's hooks (branch, Notion `start`, design check, commit) still reach their tools past its `disallowedTools`. Source: spec-reviewer, LOW. `.claude/skills/speckit-auto/SKILL.md` ("Phase agents"), `.claude/agents/task-runner.md:5`.
