# Auto run — 778-mark-sent-retry-no-delay

Start: origin/main 7bd20825 (worktree `.worktrees/778-mark-sent-retry-no-delay`).

- preflight: typecheck, lint, test green
- size: level 2 (notion 0.80)
- constitution: card read, v1.8.2, unchanged
- specify: 2 FRs; ST-779 (push failed-write test) folded in, same file family and finding; clarify self-answered: drop the delay (522 clarification "3 in all, no delay"), push case in push.processor spec
- context: story read directly from Notion (ST-778, ST-779 from deferred.md of 522)
- plan, checklist (0 open), tasks (2)
- tests: e-mail back-to-back case red (602 ms between first and third try, limit 150); push case green from the start (a coverage gap, ST-779)
- implement: delay dropped; both specs 50/50 green; pre-commit affected typecheck+test green
- harden: diff-audit no findings in the diff (pre-existing test-only exports and import-extension notes elsewhere, not this change)
- review: spec APPROVE (0), code APPROVE (1 LOW on files outside the diff, not deferred: pre-existing, unconfirmed)
- agent-context: nothing to change; retro: not run (verdict is the owner's)
- archive: Spec Delta merged into notifications (+2); 522 deferred.md bullets for ST-778/ST-779 ticked
