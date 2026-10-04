# Auto run — 158-small-action-sheet

- Description: ST-158 Open small actions as a bottom sheet on a phone (https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628)
- Start commit: 5b99c7d (origin/main), branch 158-small-action-sheet

## Preflight
- Clean tree; `npm ci` in the worktree; `typecheck`, `lint`, `test:unit` green (heavy.sh). Constitution v1.6.0 read.

## Size
- Level 2 (feature): a new presentation in a shared library, a gesture, keyboard handling and a kit surface edge.

## Specify
- Spec written from the story, its Build brief (drag scenario 4 is designed, so built) and design.md. Branch and `.specify/feature.json` from create_new_feature.py.
- Decision: `libs/overlays` cannot import the kit's `Layout` signal (the architecture is `ui-cockpit → overlays`; the catalogue imports overlays, and ST-157's plan kept overlays free of kit imports). The sheet follows the same 768 px media query at open, as the panel's `COMPUTER` query already does; the e2e pins 767 and 768 px. (autonomous default; specs/157-dialog-drawer/plan.md:62)
- Decision: the shape is chosen when a task opens and kept until it closes (Build brief States: turning the phone sideways keeps the sheet). (Build brief)

## Context
- org-researcher: story ok, feature ok, epic ok, architecture ok, decisions partial (Open decisions page too big). 3 contradictions (PrimeNG wording superseded by A1 2026-10-04; discard question answered as proposed; Escape kept) → carried into clarify. Story has 0 comments.

## Clarify
- spec-challenger: 8 findings, all answered in spec Clarifications: shape frozen at open; 768 px from overlays' own constant (cycle), pinned by e2e at 767/768; visualViewport follow tested by a fake viewport (Jest and Playwright); drag threshold on the height at drag start, rest before the discard question, distance only; sheet reaches the bottom edge with safe-area padding; drag follows the finger under reduced motion; spring on ST-53 tokens; stacking unchanged.

## Plan / Checklist / Tasks / Analyze
- plan.md (versions from package.json). requirements checklist 16/16. tasks.md T001–T013. artifact-lint: 4 errors on the Modifies line → rewritten as `157-FR-002 → FR-010`, `157-FR-003 → FR-011`; re-run 0 errors, 0 warnings (Jev lane unavailable: no key).

## Tests (red first)
- libs/overlays/src/sheet.spec.ts: 18 failed, 4 passed (the 4 guard existing behaviour: the three shapes at ≥ 768 px and phone focus). Two hollow passes (no grip yet) were tightened to assert the grip first.
- libs/ui-cockpit/src/motion.adversary.spec.ts: 2 failed (bottom origin, bottom geometry).
- apps/web-e2e/src/sheet.spec.ts (19 flows); overlays.spec.ts's phone test retired (replaced by the sheet's).

## Implement
- task.ts `PanelContext.sheet`; overlays.ts chooses it at open from `TABLET`; panel.ts grip, drag, visualViewport follow, sheet styles; cockpit.css `[data-side="bottom"]` geometry and origin; index.ts usage note.
- Existing specs adjusted: ui-cockpit sample-page.spec's shape test now says "on a computer" (its jsdom matchMedia stub matches nothing, so it reads as a phone); task-form.spec's openForm waits for the panel (the dialog container has no box around a fixed sheet, as around the drawer).
- e2e fix: `still()` waits two frames and then the overlay's own animations (it ran before the pop or spring had started).
- Unit: overlays 142 passed; ui-cockpit, web green; typecheck green. E2E (own dev server on :4358): sheet, overlays, task-form, motion, phone, cockpit 90 passed.
- Visual: 320 dark RO, 390 light RO (form), 390 dark EN, 820 dark (dialog), 1280 light EN (drawer) — match the board (screenshots in the scratchpad only).

## Converge
- All tasks T001–T013 [X]; nothing unbuilt found against spec/plan/tasks.

## Harden / Review
- diff-audit: import-extension errors are false positives (bundler resolution, as 159 recorded) and cover files this range does not touch; untested-new-file rows predate the branch. Mutation run skipped locally (owner's rule: no local mutation tests).
- test-adversary: 31 tests, 3 failed → second pointerdown mid-drag and a second pointer id drove the sheet (fixed: one pointer per drag, `lostpointercapture`); the lower stacked grip test removed (unreachable: the top task's backdrop covers it; the reachable case "a drag closes only the top" is in sheet.spec.ts); one adversary expectation contradicted FR-004 (130 px of 300 closes) and was corrected to the spec.
- spec-reviewer: APPROVE. MEDIUM sign-in e2e → deferred (ST-82); LOW asking guard → patched with a red-first test; LOW stale plan `focusin` line → plan updated; LOW 768 px in three places → deferred.
- code-reviewer: BLOCK on HIGH (drag release ignored the discard question) → patched (same fix as above). MEDIUM pointer ids → patched. MEDIUM stacked sheets untested → test added. LOW scrollIntoView on every pan → only on resize, red-first test. LOW e2e waits after Escape → added. LOW dead TaskSave exports (pre-existing) → deferred.
- Pre-existing flake in overlays.spec close/scroll test (1/16 local) → deferred.
- code-reviewer re-run: APPROVE; 2 LOWs patched (plan wording, an adversary test title).

## Hand-off
- PR #48 body filled (pr-body-check passed), marked ready; Notion review; label `in review`. CI on 1fcd7ed green (15 checks).
- QA lap 2 (pr-tester at 1fcd7ed): failure — blocker: the pre-existing desktop close/scroll e2e flake (2 of 167), traced to wheel momentum landing after the scroll lock lifts (sheet and dialog alike). All nine requested flows clean; axe clean.
- Lap 2 fixes, tests first: e2e close tests wait for the wheel scroll to end; the sheet fits an already-shrunk visible area at open; sheet rule specificity above the kit's; specs colocated as panel.spec.ts / panel.adversary.spec.ts. The wheel behaviour itself stays deferred (medium, Notion task already filed, bullet updated). Storage-down readiness is the machine (no Docker).
- Local: overlays 176 passed; close tests 54/54 over 6 repeats; overlay and kit e2e 90 passed.
