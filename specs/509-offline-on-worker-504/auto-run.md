# Auto run — 509-offline-on-worker-504

Description: ST-509 (Tech debt from ST-82): show the offline message when the service worker answers a failed fetch with 504.
Start commit: 52534bb (origin/main). Branch 509-offline-on-worker-504. Draft PR #159.

## 0. Size
level 2 (classifier 0.80; boards 1 via the feature rollup, brief not found).

## 1. Constitution
v1.8.1, card read.

## 2. Specify
task-runner (fable): success — spec.md (4 FRs, Spec Delta modifies overlays 159-FR-008), checklist, design.md; Notion start (Planning). Commit a162a75.
Draft PR #159 opened, `notion-sync pr 159`.

## Preflight
typecheck + lint + test green (exit 0, nx cache 10/11). spec-drift baseline: none recorded.

## 3. Org context
[UNAVAILABLE: notion — org-researcher had no Notion tool for this session's connector id (fd62790a-…); `notion-agent-tools.mjs detect` reports none missing from its transcripts]. Follow-up: add the current connector id to org-researcher. Story page itself was read by the run (preflight), matching the spec.

## 4. Clarify
spec-challenger: 5 findings, none blocking. Answers (its recommendations): title rename allowed, assertions fixed (SC-002); onLine read once at mapping time (FR-001); new-password.ts reads toProblem but branches on 410 only, out of scope; mapping-level tests suffice; SC-003 = one file, no new export. level check: 2 stands.

## 5. Plan
task-runner (fable): success — plan.md (one branch in `toProblem`, ~6 lines, no new export), research.md (R1 worker 504 from `ngsw-worker.js:935`, R2 branch placement, R3 `navigator.onLine`), data-model.md (N/A), quickstart.md. Design check: design.md current (no boards). No research agents: nothing NEEDS CLARIFICATION. Constitution check clean, Complexity Tracking empty.

## Resume (cloud session, 2026-10-06)
Worktree .worktrees/509-offline-on-worker-504; merged origin/main (647d2b9, pushed). No Agent tool in this run: phases 6 and 7 ran inline (pin miss: sonnet → opus); phase 14's reviewers likewise.

## 6. Checklist
inline (pin miss): checklists/error-mapping.md, 14 items, 0 unchecked (every item answered by a spec section; none struck). requirements.md 16/16.

## 7. Tasks
inline (pin miss): tasks.md, 5 tasks (3 tests first, 1 implementation, 1 proof) with the FR → test table. level check: 2 stands.

## 8. Analyze
artifact-lint: 2 ERRORs (Spec Delta `Modifies` had no `→ FR-XXX` replacement). Remediation applied: FR-002 rewritten as the full replacement of 159-FR-008 (offline reading gains the 504 rule, the status table restated unchanged); delta now Adds FR-001, FR-003, Modifies 159-FR-008 → FR-002. Re-run: 0 errors, 1 warning (FR-004 unassigned: a scope rule, by design). capabilities validate clean. Coverage: every FR has a task; no CRITICAL left.
