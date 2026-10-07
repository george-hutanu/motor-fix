# Context — 481-watch-done-threshold

Source: the Notion story only (fetched 2026-10-07).

- ST-481, Task, Medium, Status To do, Ready to work ticked, Role System, epic https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 [story page 3ef607bf-f0d2-811e-9a0b-d0abcf3e0ace].
- Finding (pr-tester, PR #29, from ST-464): the done phase has no stale threshold, so a merged, clean subagent worktree is unlocked and removed by the first `--fix` pass after its PR merges, even seconds after its last commit; give removal a grace period, "for example the review threshold" [story, Finding].
- No open decisions, sibling constraints or architecture pages bear on the harness script.
