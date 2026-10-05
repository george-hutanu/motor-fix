# Deferred: 631-prtest-health-route

- LOW (code-reviewer): `.claude/scripts/pr-test/run.mjs` passes `worktree: wt.dir` to the flows default export, which the documented flows signature in `.claude/agents/pr-tester.md` §2 does not name and nothing reads. Pre-existing (present at c2fb3a3). Later: drop it, or document it. Filed: https://app.notion.com/p/3f0607bff0d281b9a297f3f7019a9cd0
