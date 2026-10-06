# Auto run — 749-cloud-sessions

Description: run the speckit workflow in Claude Code cloud sessions without changing local behaviour (task prompt from the orchestrating session). Start: origin/main 4a499cd, branch 749-cloud-sessions, worktree .worktrees/749-cloud-sessions.

## Size
- Level 1 (set by the caller; `level.mjs set 1`). Phases 2, 7, 9, 10, 12, 14, 16.

## Notion
- ST-749 filed in MotorFix stories (Task, Medium, Role System, no epic: none exists for the harness).

## Specify / Tasks
- spec.md, tasks.md and design.md written inline in this run (pin miss: no phase agent for 2 and 7; a level 1 harness task with its FRs given by the caller).

## Tests (red)
- 6 spec files, 24 new cases red before any change: cloud-setup (5), lifecycle handoff/ready (10), github-identity (1), identity (2), heavy (1), tail-handoff-wiring (5). Local twins pass on today's code.

## Implement / Harden
- T007–T013 done. Harness 1738/1738 green, harness-eval 82/82, doctor 17 ok after --bless-hooks (github-identity 3af31e3c29ed → 138c04c3b6e6, diff read: cloud guard only).
- diff-audit, artifact-lint, capabilities validate: clean. trace-matrix: 749 0/5 because the harness specs under .claude/ are not scanned (pre-existing, same as 693/696); @traces tags added anyway.

## Review (in flight at hand-back)
- spec-reviewer and code-reviewer launched in the background on 4a499cd..HEAD; verdicts not yet read.
- PR body ready at scratchpad pr-158-body.md (pr-body-check passes); not yet published.
- To finish: read verdicts, fix CRITICAL/HIGH, write deferred.md (run-state repair count lost on a fresh VM; cloud-setup.sh unverified on a real VM), `lifecycle.mjs ready --body-file <body>`, dispatch.mjs 158 --no-wait --lap 1, add QA run line, `lifecycle.mjs handoff --pr 158`.

## Review
- spec-reviewer APPROVE (2 LOW, both patched tests first: a failed comment after `ready` names only `handoff --pr <n>`; nvm sourced without set -eu).
- code-reviewer APPROVE (1 MEDIUM, 4 LOW): patched the named Docker wait (CLOUD_SETUP_DOCKER_WAIT), `sudo -n`, nvm under set +eu; row 1 (script not gated) decided: kept ungated and said so in its header (whether a setup script sees CLAUDE_CODE_REMOTE is unverified); row 5 (100-comment page) deferred.
- deferred.md: 3 items filed as To do in Notion through the connector; `notion-sync.mjs debt` 400s for a story with no epic (sends Epic [undefined]).

## Final Report
- PR #158 ready at 0c3609b; ST-749 in QA. QA run 37490077229 (lap 1) dispatched with --no-wait; handoff.md written and posted as a `<!-- speckit-handoff -->` comment.
- Harness 1742/1742, harness-eval 82/82, doctor 17 ok; both reviews APPROVE, every finding patched or deferred (3 To do tasks in Notion).
- Next: tail #158 after QA run 37490077229.
