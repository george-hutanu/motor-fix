# Context — 157-dialog-drawer

Gathered: 2026-10-04 · by the parent session (the `org-researcher` subagent had no Notion tools in this run: `[UNAVAILABLE: notion — tools not reachable from the subagent]`; the pages below were read directly).

## Sources

- Story ST-157 https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2 (edited 2026-10-03; no discussions).
- Feature MF-5 "Small actions in dialogs, drawers and sheets" https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d (edited 2026-10-03).
- Epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (Build plan slice 3; Status In progress).
- Foundations build timeline row https://app.notion.com/p/3ee607bff0d281c4b21ff61f8a06887f (W2, lane A · UI kit, 5 points, critical path, blocks 6).
- Front end architecture https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a (edited 2026-10-03).
- Architecture decisions (search highlight, edited 2026-10-04): "Amended October 4, 2026: Angular with Spartan UI (Cockpit theme) on the front end".

## Constraints

- One overlay service: dialog on desktop, drawer for long content, bottom sheet on a phone (the sheet is a sibling story); each task is a component that returns a result. (Front end architecture, Patterns)
- Dialogs, drawers and sheets are not routes; a small action never changes the page. (Front end architecture, Routes; MF-5 rule 1)
- Shared libraries: `ui-cockpit` (theme, gauges, panels) and `overlays` (dialog, drawer, bottom sheet), with `ui-cockpit → overlays` in the diagram. (Front end architecture, Structure)
- Drawer 480 px, wide drawer 720 px *(proposed)*; touch targets ≥ 44 px; smallest text 12 px; motion follows reduced motion. (MF-5 Build brief, rules 2 and 10)
- Closing with changed fields asks "Renunți la modificări?" *(proposed)*; stacking with Escape closing only the top *(proposed)*; Back closes and the page stays *(proposed)*. (MF-5 Build brief)
- Out of scope: phone bottom sheet; saving, validation and errors; the ten other tasks. (ST-157 Build brief)

## Contradictions

- ST-157 and MF-5 say "Built on PrimeNG Dialog and Drawer" → Architecture decisions (amended 2026-10-04, newest) and AGENTS.md: Spartan UI. Spartan wins.
- Mock drawer widths 520/660 px → Build brief 480/720 px. Build brief wins.
- Mock phone boundary 640 px → MF-5 Build brief 768 px *(proposed)*; only matters for the first-field focus here.
- Front end architecture: "the review drawer opens with `?review={jobId}`" *(proposed)* → ST-157 rule "never changes the page address". The review story decides; nothing to build here.

## Proposed Clarifications

- Where the service lives (`libs/overlays` vs the kit) — answered in spec Clarifications.
- Back button "page stays" — deferred, needs a history entry per task.
