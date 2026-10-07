# Auto run — 207-garage-approval-flow

Description: ST-207 (Task, EP-2 Garage onboarding and verification, Highest, 5 points) — Keep garages hidden until approved, with a status flow. https://app.notion.com/p/3ee607bff0d2818b8b02f41b122c27f6
Start commit: 664610a3 (worktree .worktrees/207-garage-approval-flow, branch 207-garage-approval-flow from origin/main).

## Phases

## 2. Specify
- Story read with its Build brief (current 2026-10-03) and its two decisions of 2026-10-03 (X18 stays-public rule; mobile mechanic's seat). Spec: 11 FRs, 4 stories, 6 SCs; Spec Delta: new capability `garage-verification`, modifies 079-FR-005. Level: 2 (point handed it to the feature).
- Autonomous answers (each an Assumptions line marked "autonomous default"):
  - Q scope of read paths: only the new public `GET /api/v1/garages/{slug}` ships; the bypass test covers search/map/routing/sitemap/MCP as they arrive; the Playwright scenario lands with the search story.
  - Q listing draft: not in the repo; Ciornă derives from a `draft` garage with no file until the submission story adds the draft.
  - Q `previous_file_id` and 404-for-everyone-else: both kept as the brief proposes.
  - Q `skip_manual_approval`: env `SKIP_MANUAL_APPROVAL` (`1`/`true`), ignored under `APP_ENV=production`, never required.
  - Q `approved_at` on a reopened file's approval: reset.
  - Q negative decision on a reopened approved file: garage stays approved and public (no exit from `approved` but suspension); flagged for the owner.
  - Q 409 code: `verification_transition_refused`, detail "already decided by {first name}".
  - Q `public:search:{brandId}` audience: emitted once brands exist; empty list today.
- after_specify hooks: `lifecycle.mjs open` made the empty start commit 778c7ddc, pushed, opened draft PR #188 (label planning), Notion ST-207 To do → Planning, timeline row Planning, EP-2 To do → In progress, PR linked; ready-to-work refresh flagged ST-354, ST-245, ST-202 for review (see notion-sync.md).
- Design check: the mock (artifact EoPWH9MHmuY5Jfw7vTWTHr) is not shared with this account ("artifact not found"); design.md opens with the UNAVAILABLE marker and is filled from the epic's Design table and the Build brief; no screens of its own. Re-run before plan and implement once the mock is shared.
- agent-context update pointed CLAUDE.local.md at another feature's plan (780, no plan.md for 207 yet) and grew it past its baseline: reverted, not committed; re-runs at `/speckit-plan`.
- `level.mjs check`: level 2, unchanged (fr-count tripped at 11 FRs; clarification, contract and projects clear).

## 3. Context
- org-researcher: success, 20 findings (story, MF-30, EP-2, Architecture decisions, decisions index); 4 contradictions with spec.md, 4 proposed clarifications; context.md written.

## 4. Clarify
- spec-challenger: 5 findings (A34 410, second open, concurrency/SC-002 self-pairs, 409 wording, bypass test); folded in. Latest Notion source wins.
- Q1 suspended slug 404 or 410? → 410 `gone` for `suspended` (A34, 2026-10-04); 404 for never-approved and unknown. US1 sc.2, FR-005, SC-001, Edge Cases.
- Q2 second admin opens an `in_review` file: 409? → No: succeeds unchanged, answers the first `opened_by`/`opened_at` so the caller warns (MF-30 rule 15); 409 only for a second decision. US3 sc.1, FR-002, SC-002, Edge Cases.
- Q3 where may `skip_manual_approval` act? → `APP_ENV=test` only (A33); development, staging, production ignore it. US4, FR-009, SC-005.
- Q4 story references? → ST-116 submits; ST-206 uploads/declaration; ST-208 re-send after more requested; ST-209 e-mail per status; re-approval changes are the change-flow stories. FR-007, FR-010, Assumptions.
- Q5 reopened approved file then rejected/more requested: still public? → Yes, stays `approved`; told the result (X18); hiding is MF-59 suspension. Flagged for the owner. Assumptions.
- Checklist requirements.md 16/16 → 16/16. Deferred to plan: the concurrency mechanism (compare-and-set update) and the 409 detail sentence per status.
- level.mjs check: level 2, unchanged.
