# Requirements checklist: 766-cloud-rest-fallback

- [x] CHK001 Every FR is testable without the network (injected `run`, stub binaries) [FR-001..FR-005]
- [x] CHK002 Cloud detection is one rule, `CLAUDE_CODE_REMOTE=true`, as every other cloud difference [Assumptions]
- [x] CHK003 The laptop path is specified as unchanged and has a test of its own [US1-7]
- [x] CHK004 The no-PR case keeps gh's message and exit code, so the gate still tells "no PR" from "read failed" [Edge Cases]
- [x] CHK005 Out-of-scope items are named and untouched: QA dispatch, agent-review, merge-gate.mjs, CI workflows, `gh pr merge` [Clarifications]
- [x] CHK006 The gates still judge the original gh command in lifecycle.mjs [FR-002]
- [x] CHK007 `pr checks` exit codes and buckets match gh's (8 pending, 1 failed/none, 0) [FR-004]
- [x] CHK008 PATH persistence is idempotent: one marked line, rewritten [US2-3]
- [x] CHK009 Chromium install only when the pinned revision is missing [US2-4]
- [x] CHK010 The cloud-setup spec is uid-independent [Edge Cases]
- [x] CHK011 A touched registered hook is blessed only after reading its diff [Constraints]
