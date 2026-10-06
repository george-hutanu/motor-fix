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

## 9. Tests
form.spec.ts: 7 new cases (FR-001 ×4 `it.each`, FR-003 ×3); adversary title renamed, expect kept. Red: `npx jest -c libs/overlays/jest.config.cts libs/overlays/src/form` → `Tests: 4 failed, 73 passed, 77 total` (the four FR-001 cases). Cloud VM note: the image's PATH puts /opt/node22 before /usr/bin, so cloud-setup's Node 24 was not picked up ("Node 24 is not on PATH after installing it"); ran with PATH=/usr/bin first. Follow-up on cloud-setup.sh.

## 10. Implement
`toProblem`: `offline` read once; a 504 with no problem code while offline → `{ code: 'offline', status: 504 }`; local `codeOf` shared with `fromBody` (no export). `nx run-many -t test typecheck -p overlays` exit 0. Commit 00cfccd. Pre-commit's first full run failed one unrelated domain integration spec (send-claim retry race, 2 Brevo calls vs 1); passed 3/3 alone and in the next full run → deferred.md, filed as a Notion task. Notion: Implementing (connector); PR label in development, +bug, +scope: overlays.

## 11. Converge
Every FR built and tested; diff limited to libs/overlays/src/form.ts + its two specs (SC-003). Nothing appended.

## 12. Harden
diff-audit: 0 errors 0 warnings (jev lane off: no key). artifact-lint: 0 errors pre-archive. Inline adversary pass (no Agent tool): added 5 cases — a problem sent as text keeps its code, JSON string / number / array bodies read offline, no `navigator` keeps internal_error. Commit 32f8a9a. Repairs: 0.

## 13. Refresh
Story page and comments re-read via the connector: no new evidence (context.md ## Refresh).

## 14. Review
Inline (no Agent tool, so no spec-reviewer/code-reviewer subagents; the PR tester's review in the tail is the independent read). Spec conformance: FR-001..FR-004, SC-001..SC-003 met; no internal ids in source. Code: no CRITICAL/HIGH/MEDIUM. LOW: none. Verdict APPROVE (self, recorded as such).

## 15. Agent context
CLAUDE.local.md already points at this plan (7053f1e); nothing to change.

## 16. Retrospective evidence (unjudged)
`retro-evidence.mjs --since c032309`: 8 commits listed, carried open items from earlier features only; jev lane unavailable (no TYPESAFE_API_KEY). `instincts.mjs triggered`: none. No verdict written.

## 17. Archive
capabilities merge: overlays +2 ~1 −0 (159-FR-008 retired → 509-FR-002); in-context "(FR-001)" fixed to 509-FR-001. spec.md status Archived (2026-10-06).

## Hand-off
PR body filled (pr-body-check passes), published via REST; PR #159 ready (ccr/ready_for_review); Notion story → QA (connector); label QA; qa line committed 77a7281. QA dispatch refused: this session's GitHub token cannot dispatch workflows (403 on actions/workflows/pr-qa.yml/dispatches, REST and GitHub MCP) and dispatch.mjs needs GraphQL. Hand-off note posted as a `<!-- speckit-handoff -->` comment with the flows file inlined; no QA run recorded, so the tail dispatches lap 1.

## Final Report
- Branch 509-offline-on-worker-504, specs/509-offline-on-worker-504, range 52534bb..HEAD; this resume: 647d2b9 (merge main), 75475ab, 00cfccd, 32f8a9a, ebcaab6, 77a7281, plus this log.
- Phases 6–17 run (6/7/14 inline: no Agent tool in the session). Red 4 failed / 73 passed → green; overlays test+typecheck exit 0; pre-commit affected typecheck+test+lint green.
- FR → test: FR-001 form.spec.ts "the service worker's 504" it.each + adversary odd bodies; FR-002 form.spec.ts status-0 cases (unchanged); FR-003 form.spec.ts online/problem/500 cases + adversary text problem and no-navigator; FR-004 diff limited to libs/overlays/src/form*.
- Review: inline, no CRITICAL/HIGH/MEDIUM. Deferred: 1 (domain send-claim flake), filed in Notion.
- Retrospective evidence: gathered unjudged; jev lane unavailable.
- Follow-ups: cloud-setup.sh PATH (Node 22 shadows 24); org-researcher connector id; QA dispatch impossible from cloud sessions without actions:write.
