# Feature Context: Open small actions as a bottom sheet on a phone

- **Feature**: 158-small-action-sheet
- **Anchor**: ST-158 "Open small actions as a bottom sheet on a phone" — https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628 | terms: bottom sheet, overlay service, grip, 768 px, safe area
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok | decisions partial (Architecture decisions read; the Open decisions page is too big to fetch, and the feature page and Build briefs list "Open: None")
- **Overall confidence**: high

## Story

- **ST-158 Open small actions as a bottom sheet on a phone** — status Planning, ready to work yes, priority Highest, role Visitor, 3 points, labels front end + design, epic EP-1 Foundations, feature MF-5 Small actions in dialogs, drawers and sheets. Timeline row: lane A · UI kit, wave W3, 2026-10-30 to 2026-11-02, blocked by 2 rows, blocking 2 rows.
- Scope per the story (acceptance criteria, page edited 2026-10-04T14:15):
  - On a phone, a centred dialog and a right drawer both become a bottom sheet.
  - The sheet is no taller than 92 percent of the screen.
  - The sheet has a grip.
  - The screen behind is dimmed and does not scroll.
  - The sheet closes with X or a tap outside.
  - The sign-in dialog opens as a bottom sheet on a phone.
- Build brief (current as of 2026-10-03; "where this section and anything above disagree, this section wins") adds eight scenarios:
  1. Below 768 px *(proposed breakpoint)*, the sheet has a grip, is at most 92% tall, and its content scrolls inside.
  2. Backdrop dims and the page behind does not scroll.
  3. X or outside tap closes it and the page is where it was.
  4. Dragging the grip down past a third of the sheet closes it; less springs back *(proposed)*.
  5. With the keyboard open, the sheet stays above it and the field stays in view.
  6. On an iPhone with a home bar, the main button sits above the safe area.
  7. A drawer task opened on a phone is also a bottom sheet.
  8. Changed fields: the same discard question as on a computer *(proposed)*.
- Left out by the story: bottom sheets of the other ten tasks (built with each task, on this service); tab bars (ST-287 and the dashboard bar).
- Comments that moved scope: none. The story has no comments (`notion-get-comments` returned only `suggested_edits_status: not_enabled`, with resolved and child-block discussions included).

## Decisions

- On a phone the one overlay service shows every dialog and drawer as a bottom sheet with a grip, at most 92% of the screen tall; sign-in is the first task shown this way — [ST-158, Build brief Scope] (2026-10-03, confidence: high)
- The module is front end only: `libs/overlays` in `apps/web`, the "overlays" library of the Front end architecture page — [Small actions feature page, Build brief] (2026-10-03, confidence: high)
- A small action never changes the page address or scroll position; dialogs, drawers and sheets are not routes — [Feature page, Final rules 1; Front end architecture, Routes] (2026-10-03, confidence: high)
- The sheet is dismissed with X, a tap outside, or Escape; on a phone also by dragging the grip down *(proposed)* — [Feature page, Final rules 4] (2026-10-03, confidence: medium)
  - The ST-158 criteria list only X and tap outside. Escape and drag-down come from the feature page and the brief.
- Focus stays inside the task and returns to the opener on close. A task component returns a typed result to its opener *(proposed)* — [ST-157, Build brief] (2026-10-03, confidence: medium)
- Smallest text on a phone is 12 px, touch targets are at least 44 px, form fields at least 16 px so iOS does not zoom — [Feature page rule 10; ST-286 Build brief; Front end architecture Budgets] (2026-10-03, confidence: high)
- Motion follows the reduced-motion setting — [Feature page rule 10; ST-157 Build brief] (2026-10-03, confidence: high)
- Turning the phone sideways keeps the sheet open, at most 92% of the new height — [ST-158 States; Feature page Edge cases] (2026-10-03, confidence: high)
- The overlay UI library choice: Spartan UI (brain primitives plus helm components in `libs/ui-cockpit`, on Angular CDK), not PrimeNG — [Architecture decisions, A1 "Amended 2026-10-04"] (2026-10-04, confidence: high)
  - ST-158 Rules and the feature page "For the build team" name the Spartan sheet in the bottom position, on the Angular CDK; their older component-library wording (2026-10-03 or older) is superseded by A1.
  - The same A1 amendment postdates the ST-157 brief ("Built on PrimeNG Dialog and Drawer"). ST-157 is merged, so its actual implementation is the ground truth for the service.

## Constraints

- Phone layout comes from the shared `LayoutService` signal: phone < 768 px, tablet 768–1023 px, desktop from 1024 px (all *(proposed)*, built in the merged ST-286). The sheet should follow this signal and not add its own matchMedia — [ST-286, Build brief Rules] (2026-10-04, confidence: high)
- Safe area: `env(safe-area-inset-*)` on every fixed bottom or top bar. The viewport is `width=device-width, initial-scale=1, viewport-fit=cover` and zoom is never disabled — [ST-286, Build brief Rules; scenario 5 covers "a bottom bar or sheet"] (2026-10-04, confidence: high)
- The width crossing a breakpoint switches the layout at once without losing input, so the shape must change live with an open task — [ST-286, scenario 7] (2026-10-04, confidence: medium)
- ST-158 needs ST-157 (the overlay service) and ST-286 (phone rules), both Done (ST-157 PR #40, ST-286 PR #22) — [ST-158 Build brief Depends on; ST-157 and ST-286 status] (2026-10-04, confidence: high)
- Edge cases from the feature page:
  - Stacked tasks: Escape closes the top one only *(proposed)*.
  - Back button closes the task and the page stays *(proposed)*.
  - Session expiry opens sign-in on top, with the text kept.
  - Double tap on the main button sends one request *(idempotency key, A32)*.

  — [Feature page, Edge cases] (2026-10-03, confidence: medium)
- Tests named by the story: Jest for "the shape follows the width" and the drag-to-close threshold; Playwright at 390 × 844 and 320 × 640 for open sign-in, the height limit, close by tapping outside, and the page not having moved — [ST-158, Tests] (2026-10-04, confidence: high)
- A new lib is created by the story that first needs it (repo rule). The brief names `libs/overlays`, which ST-157 built — [ST-157, Build brief Scope] (2026-10-03, confidence: high)
- Texts in Romanian and English, e.g. "Autentificare", "Renunți la modificări?", "Închide" — [Feature page rule 10] (2026-10-03, confidence: high)

## Prior Art

- ST-157 shared dialog and right-hand drawer — Done, PR #40. It built `libs/overlays` with the overlay service, backdrop, scroll lock, focus trap, three ways to close, and the typed result. It names shapes `dialog`, `drawer` and `drawer-wide` *(proposed names)* and the discard question "Renunți la modificări?" with "Renunță" and "Continuă editarea". The sheet should extend this service, not fork it — [ST-157] (2026-10-04)
- ST-286 shared phone layout rules — Done, PR #22. It built `LayoutService`, safe-area rules and the 16 px field rule — [ST-286] (2026-10-04)
- ST-159 shared saving, validation and errors — Done (merged per caller); the form behaviour the sheet hosts. Not re-read for this digest — [Feature page, Stories] (2026-10-03)
- ST-82 sign-in — in progress per caller. It is the first task shown as a sheet. Not re-read for this digest — [Foundations, Slice 4] (2026-10-03)
- ST-53 motion — drives how the sheet slides and the reduced-motion rule, per the feature's dependency on the Cockpit design system. Not re-read in detail; tech-debt pages exist for it, one noting a shared `REDUCED_MOTION` token that charts do not yet use — [Search result, "Tech debt (ST-53)"] (2026-10-04)
- In the mock: Mobile · Sign-in sheet (MSignIn.dc.html) and Mobile · Review sheet (MReview.dc.html). The mock URL is https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr, recorded and not opened — [ST-158 Screens; Foundations Design] (2026-10-03)

## Open Decisions

- None blocking. ST-158 and the feature page both end with "Open: None". Items marked *(proposed)* are owner-changeable defaults: the 768 px breakpoint, the drag-down threshold of one third, the 36 × 4 px grip with a 44 px touch area, the discard question, stacking and Back — [ST-158 and feature page Build briefs] (2026-10-03)
- The feature page's older States table says "Decide whether long texts such as reviews should ask before discarding". Final rule 9 answers it with the discard question *(proposed)*, and the Foundations risks list still lists it as undecided — see Contradictions.

## Contradictions with spec.md

- spec.md is the unfilled spec-kit template (placeholders only, no FRs), so nothing can be compared yet. Everything above is newer than the template. Rerun the comparison after `/speckit-specify` fills it.

## Contradictions inside Notion (latest wins)

- **UI library:** ST-158 Rules and the feature page toolkit toggle say "Spartan sheet, position bottom". **A1 amended 2026-10-04** sets Spartan UI brain primitives, helm components in `libs/ui-cockpit` and Angular CDK. Newer wins, so the sheet is built on Spartan/CDK, not PrimeNG. Caveat: ST-158's page was edited 2026-10-04T14:15 (after A1) but its Build brief still dates itself 2026-10-03, so its library line dates from before A1. AGENTS.md also states the Spartan stack.
- **Discard question:** Foundations "Risks and open decisions" (2026-10-03) lists "decide whether long texts such as reviews ask before discarding" as open. The feature page's Final rule 9 and ST-158 scenario 8 both answer it *(proposed)*. Same date. The Build brief says it wins, so treat it as answered-as-proposed.
- **Close methods:** the ST-158 criteria list X and tap outside; the feature page also lists Escape and (phone) drag-down *(proposed)*. Not a conflict, but the sheet should keep Escape from ST-157.

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm the sheet is built on Spartan/CDK primitives in `libs/overlays`, and that ST-157's real implementation, not the PrimeNG wording, is the base — from A1 amendment vs ST-158 Rules.
- Should drag-to-close apply only to the grip, or to the whole sheet header? Notion says only "dragging the grip". Should content scroll take priority over a downward drag when the content is scrolled — from scenario 4, gap.
- Should the 768 px breakpoint be read from `LayoutService` (ST-286) rather than the sheet's own query, and does an open dialog become a sheet live when the width crosses 768 px (ST-286 scenario 7) — from ST-286 and the *(proposed)* breakpoint.
- Should Escape and Back also close the sheet on a phone (feature page rules 4 and Edge cases) even though the ST-158 criteria do not list them — from the feature page.
- Does the grip's 44 px touch area count as the drag handle and a keyboard-accessible close control for screen readers — from the 44 px rule and the dialog-role scenario in ST-157.
- Which viewport unit and mechanism should keep the sheet above the on-screen keyboard (dynamic viewport vs VisualViewport), given that Notion only states the outcome — from scenario 5, gap.

## Gaps

- [NEEDS CLARIFICATION: how the sheet stays above the on-screen keyboard — Notion states the outcome only; no page names a mechanism.]
- [NEEDS CLARIFICATION: the sheet's open and close animation (duration, easing) — nothing in the pages read gives values; ST-53 and the Cockpit design system page may.]
- [NEEDS CLARIFICATION: the grip's colour and the backdrop opacity are not given in the pages read; the design mock was not opened (outside Notion).]
- Open decisions page (3ee607bff0d2817d95ebd3b142c1de11) was too big to fetch, so numbered decisions there were not read directly; the Build briefs list none for this story.
- ST-82, ST-159 and ST-53 bodies were not read in full; only their status and relationship are recorded.
- The ST-158 timeline row page is empty beyond its properties.

## Sources

- Open small actions as a bottom sheet on a phone (ST-158) — https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Small actions in dialogs, drawers and sheets (MF-5) — https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d
- Build the shared dialog and right-hand drawer (ST-157) — https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2
- Set up the shared phone layout rules (ST-286) — https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c
- Foundations (EP-1) build timeline row — https://app.notion.com/p/3ee607bff0d281da81fed1425fb27a29
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a

## Refresh

- 2026-10-04: story re-read after implementation; no comments, no discussion; Build brief unchanged since the first read (the page's last edit is this run's own Status/PR writes). No new evidence.
