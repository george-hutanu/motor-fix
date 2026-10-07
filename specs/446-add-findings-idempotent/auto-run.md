# Auto run — 446-add-findings-idempotent

- Description: ST-446 tech debt from ST-434 — `post.mjs --add` writes the merged findings back, so a second run doubles them; covers ST-484 (`--add --dry-run` then the real post).
- Start: origin/main ab4edd89, worktree .worktrees/446-add-findings-idempotent, draft PR #182

## 0. Size
- level.mjs suggest ST-446: level 2 (boards: 1 via the epic rollup, brief not found); accepted.

## 1. Constitution
- v1.8.2 card read; Principles I, II, VII carried. Preflight typecheck, lint, test green.

## 2–8. Specify, context, clarify, plan, checklist, tasks, analyze
- Written inline (a 3-line harness fix; no phase agents dispatched): spec.md (2 FRs, 2 autonomous clarifications), plan.md, tasks.md (3 tasks), design.md (no screens).
- Context: the two Notion tasks (ST-446, ST-484) are the whole input; ST-484 is the same defect (a non-idempotent add), so one fix covers both (spec.md Clarifications).
- analyze: artifact-lint 0 errors, 2 warnings (delta-unassigned: harness fix, no capability requirement, by design).

## 9–10. Tests, implement
- Red: new post.spec.mjs case (repeated add deep-equal to one add) failed 1/18 before the change.
- Green: addFindings skips a finding whose JSON the report already holds; npm run test:harness 75 files, 1907 tests pass.

## 12. Harden
- diff-audit: no finding in the touched files (its warnings are in libs/domain, pre-existing). Biome ignores .claude/scripts.

## 14. Review
- code-reviewer: APPROVE, 2 LOW patches applied (jsdoc names the JSON.stringify identity; a `[x, x]` assertion covers the in-file duplicate, kept per spec.md Assumptions).
- spec-reviewer: APPROVE, 1 LOW: ST-484 linked to PR #182, moved to Implementing, Ready to work unticked; it moves with ST-446 to QA and Done.

## 17. Archive
- spec.md status Archived (2026-10-07); Spec Delta all none (platform), nothing to merge.
