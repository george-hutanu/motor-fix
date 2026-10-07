# Auto run — 496-task-done-close-name

Start: origin/main 404c1ab9 (worktree `.worktrees/496-task-done-close-name`). Sibling ST-497 taken in the same PR (same lib, a three-line change in `libs/overlays/src/form.ts`).

- size: level 1, promoted to 2 at ready (projects wire: i18n, overlays, web, web-e2e); plan.md and the checklist written then; context = the two Notion tasks read directly; clarify: nothing material (both choices are in Assumptions); analyze: each FR covered by a test task and a code task, no findings
- constitution: card v1.8.2, unchanged
- specify: 2 FRs, each replacing a 159 FR; autonomous: rename the confirmation's button to "Gata" / "Done" rather than hide a button (spec Assumptions); keep the line until the answer rather than reserve its space
- design: no boards on either task; design.md records the rename against ST-159's wording
- tasks: 4
- tests: form.spec.ts red (2 failed: Done name, line kept while sending); sign-in.spec.ts "clears the message at the next try" rewritten to the new behaviour; implement: overlays, i18n, ui-cockpit 1145 green, sign-in 266 green
- harden: diff-audit no findings in the diff (pre-existing test-only exports elsewhere)
- review: spec APPROVE, code APPROVE (1 LOW each, the same: ticket id in a test title; patched)
- agent-context: nothing to change; retro: not run (verdict is the owner's)
- archive: Spec Delta merged into overlays (~2: 159-FR-005 → 496-FR-001, 159-FR-006 → 496-FR-002)

## Final Report

PR #185: test, fix and archive commits; both reviews APPROVE; decisions on the owner's behalf: "Gata" / "Done" for the confirmation's button, the error line held until the answer. Follow-ups: none.
- 2026-10-07T06:23:17.703Z · level 1 → 2 · projects: i18n, overlays, web, web-e2e
