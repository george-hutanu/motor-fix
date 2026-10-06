# Feature Context: Back closes the open task and keeps the page

- **Feature**: 491-back-closes-task
- **Anchor**: ST-491 Tech debt (ST-157): The browser's Back button while a task is open should close the task and keep the page — https://app.notion.com/p/3ef607bff0d281368c38d78fcc7b10ff (from ST-157, Build brief scenario 8)
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic partial (search snippet only; the page is 60k characters and was not read in full) | architecture ok (Architecture decisions only) | decisions not read (Decisions and ideas page not opened; nothing in the other pages points to it)
- **Overall confidence**: medium

## Story

- **ST-491 Tech debt (ST-157): Back closes the task, page stays** — status Planning, priority Low, role System, issue type Task, epic Foundations (EP-1), feature MF-5 "Small actions in dialogs, drawers and sheets"; PR https://github.com/george-hutanu/motor-fix/pull/173; page last edited 2026-10-06.
- Scope per the story: "Today the CDK closes the task as the page navigates back. Needs one history entry per open task that the router ignores, and a `history.back()` on every other close. (spec Clarifications; spec-challenger 5)". Where: `libs/overlays/src/overlays.ts`, `libs/overlays/src/panel.ts`. Found by review, severity low. Parent story ST-157 (Done, PR #40): scenario 8 "Given the browser's Back button while a task is open, then the task closes and the page stays *(proposed)*."
- Comments that moved scope: none (0 comments on ST-491, ST-157, or the feature page MF-5).

## Decisions

- A task never changes the page address and never loses the scroll position; dialogs, drawers and sheets are not routes. — [MF-5 Build brief, Final rules 1] (2026-10-03, confidence: high)
- Back closing the task and keeping the page is a default the owner may change, not a settled rule. — [ST-157 Build brief scenario 8; MF-5 Edge cases: "The browser's Back button: the task closes and the page stays *(proposed)*"] (2026-10-04 / 2026-10-03, confidence: high)
- Closing a task with changed fields asks "Renunți la modificări?" first, also on a phone. — [MF-5 Final rule 9 *(proposed)*; ST-158 scenario 8] (2026-10-03 / 2026-10-05, confidence: medium)
- Stacked tasks: Escape closes the top one only. — [ST-157 scenario 6; MF-5 Edge cases *(proposed)*] (2026-10-04, confidence: medium)
- The front end is Spartan UI on Angular CDK, not PrimeNG. — [Architecture decisions, A1 amended] (2026-10-04, confidence: high)
  - superseded: ST-157 Build brief "Built on PrimeNG Dialog and Drawer" (2026-10-04 edit, a stale line); ST-157's finding already says "the CDK".

## Constraints

- The Back entry must be one the router ignores, and every other close must call `history.back()` — [ST-491, Finding] (2026-10-06, confidence: high)
- The bottom sheet closes by X, tap outside, and drag past a third of its height; each must remove the entry too. — [ST-158 Build brief scenario 4] (2026-10-05, confidence: high)
- Tests expected in ST-157: unit (each way to close, stacked tasks) and an end-to-end on Results (open, Escape, scroll and address unchanged). The sheet's e2e runs at 390×844 and 320×640. — [ST-157 Tests; ST-158 Tests] (2026-10-04 / 2026-10-05, confidence: medium)
- The overlay service is front end only, `libs/overlays` in `apps/web`; server rendering is public pages only (A10). — [MF-5 Build brief; Architecture decisions A10] (2026-10-03 / 2026-10-04, confidence: high)

## Prior Art

- ST-157 (Build the shared dialog and right-hand drawer) — Done, PR #40; it deferred Back to this task. — [ST-157] (2026-10-04)
- ST-158 (bottom sheet on a phone) — Done, PR #48; adds the drag-to-close. — [ST-158] (2026-10-05)
- ST-22 (Write and publish a review in the drawer) — To do; opens the drawer through the overlay route `?review=:jobId` / `?review-garage=:garageId` *(proposed)*. — [ST-22 Build brief] (2026-10-03)

## Open Decisions

- None numbered or T-numbered applies. Scenario 8 stays *(proposed)*; the owner may change it.

## Contradictions with spec.md

- **spec.md** (2026-10-07): the "Sources" line says the Notion page was not fetched again by this phase. — **Notion**: ST-491 was last edited 2026-10-06 and its content matches what spec.md quotes. — newer: spec.md; no conflict in content.
- **spec.md** (2026-10-07): "Notion: Today the CDK closes the task..." and "Modifies 157-FR-001: drops 'no history entry'". — **Notion**: MF-5 rule 1 and ST-157 forbid a changed *address*, and say nothing against a history entry. — newer: spec.md; not a contradiction, the spec's reading is consistent.
- Potential tension, not a contradiction: ST-22 (2026-10-03) opens review drawers through routes `?review=:jobId`. FR-007 (the page navigated while open, close without moving history) and FR-001 (the router ignores the entry) may behave differently for a task opened by a query-parameter route.

## Proposed Clarifications (this command's proposals, not requirements)

- Does a task opened by an overlay route (`?review=:jobId`, ST-22) get the same Back entry, or does the route's own history entry stand in for it? — from ST-22 Build brief; no page answers it.
- Should Forward after a Back close reopen the task? Notion is silent; the spec's autonomous default is no. — from the absence of a rule in MF-5.
- Should a second Back on the discard question leave the task open (spec FR-003) or close it? Notion says only that closing asks first. — from MF-5 rule 9.

## Gaps

- [NEEDS CLARIFICATION: the Foundations epic page was not read in full (60k characters); a statement there about Back or release timing could have been missed.]
- The Decisions and ideas page was not opened.
- No Notion page defines how a stale same-address entry is handled after an app navigation (spec FR-007 and its assumption); this is the spec's own choice.

## Sources

- ST-491 — https://app.notion.com/p/3ef607bff0d281368c38d78fcc7b10ff
- ST-157 Build the shared dialog and right-hand drawer — https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2
- MF-5 Small actions in dialogs, drawers and sheets — https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d
- ST-158 Open small actions as a bottom sheet on a phone — https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628
- ST-22 Write and publish a review in the drawer — https://app.notion.com/p/3ee607bff0d28157b6c5f46d9172876c
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Foundations (epic, search snippet only) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
