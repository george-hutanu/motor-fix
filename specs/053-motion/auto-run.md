# Auto run — 053-motion

Description: ST-53 — See screens build up with motion, or still with reduced motion (see spec.md Input).
Start: branch `053-motion` from origin/main 0dfde6c (contains ST-51, #20), 2026-10-04.

## Preflight
- Clean tree; typecheck green; lint green; `npm test` 10 projects green. spec-drift: no active feature before this run.
- Constitution read (v1.3.0, no placeholders).

## 0 Size
- Level 2 (feature): several parts, a shared rule, e2e.

## 2 Specify
- Feature dir created with `create_new_feature.py --allow-existing-branch --number 53 --short-name motion` (branch made by the orchestrator's setup).
- Clarification table: none raised; Assumptions marked (autonomous default): roll 900 ms (mock), pulse 1.6 s, blink to 0.35 once a second, swap button reworded, presentation-attribute transitions for the dial.

## 2b Notion start (standing instruction)
- ST-53 To do → In progress; timeline row Not started → In progress; EP-1 unchanged (In progress).

## Design check
- design.md from mock v22 boards Main, Mechanic, Results, Overlays, DashGarage (Artifact read). Mock vs Build brief: the Build brief's values win.

## 3 Context
- org-researcher not used: its tool list names other Notion connector ids (same as ST-51); the run read the story, MF-3 and EP-1 itself, read-only, into context.md.

## 4 Clarify
- 5 Q/A in spec Clarifications (values from the Build brief; CSS rule + shared signal; roll 900 ms; blink class; no-rating needle untouched per orchestrator).

## 5 Plan
- plan.md. Probe (Playwright Chromium): SVG `stroke-dasharray` and `transform` attribute changes transition, the needle turns about its pivot.

## 6 Checklist
- requirements.md: all items checked.

## 8 Analyze
- artifact-lint: delta-unknown-capability (cockpit-motion) and delta-base-missing (051-FR-012). Fixed: stub `.specify/capabilities/cockpit-motion.md`; merged ST-51's Spec Delta into `cockpit-gauges.md` (its archive had not run; +15). Re-lint clean; `capabilities validate` clean.
- spec-challenger: 8 findings, all answered with its recommendation except: 2 (stagger by document order with a counter) → kept per-container `:nth-child` (no script, SSR first paint; Principle I), cap 660 ms as recommended; 8 (blink as an eased fade) → kept a step cut, 0.35 moved into FR-005. Applied: FR-001/SC-004 scoped to this story's motion; SC-002 measured from the first rise; FR-007 sheet origin at its edge; FR-011 a motion line from the shared signal (its consumer); assumptions for first value after "—" and cell kind changes; Complexity Tracking row for the signal and the blink.

## 9 Tests (red first)
- Unit red: 4 failed + 2 suites failing to run (motion.spec: no reduced-motion block; reduced-motion.spec: no module) of 19 in the 4 touched specs. e2e red: the odometer roll (0 `translate` transitions) and a strict-mode locator in the build-up test (fixed in the test).

## 10 Implement
- Slice 1 (tokens, keyframes, reduced-motion rule, panel, dial, lamp, pop, blink, signal, catalogue): ui-cockpit 228 passed, i18n 428 passed, typecheck green, motion + gauges + cockpit e2e 25 passed on :4253. The odometer part held back on the orchestrator's word until ST-286 (#22) merged.
- Rebased onto origin/main 6220b7a (#22): clean. Odometer roll on top of ST-286's wrap (`max-width: 100%`, `flex-wrap: wrap` kept). ui-cockpit 267 passed; motion + gauges + cockpit + phone e2e 88 passed (repeat-each 2), motion alone 35 passed (repeat-each 5). One earlier run right after `npm install` had 4 failures that did not reproduce (likely the dev server re-optimising dependencies on its first start); `swap` in the e2e now waits for the range to change, so a click replayed after hydration is waited for.

## Draft PR
- Pushed 053-motion; draft PR #31 with the template body; CI all green on 6a3b422.

## Built-in browser walk (PR #28 rule)
- /cockpit served on :4253: 320 px light — no sideways scroll (scrollWidth 320), live label blinking, change button swung the dial to 4,2 and rolled the range digits to 1.400–1.800; dark desktop pane — the dialog popped in and closed at once. Server stopped.

## 13 Ticket refresh
- Story re-read: no comments, Build brief unchanged. No new evidence.

## 14 Review
- test-adversary: motion.adversary.spec.ts, 38 tests, 1 real defect (legacy-only media listeners) → fixed a5182ca; then reverted on code-reviewer's MEDIUM (Angular 22 browserslist has no such Safari; Principle I).
- spec-reviewer: APPROVE (LOW: vacuous blink-period test; MEDIUM: local sign-in stub). code-reviewer: BLOCK — 2 HIGH, all fixed (relayed by the orchestrator):
  - HIGH panel 13th+ at step 0 → `:host(:nth-child(n + 12))` step 11, asserted in motion.spec and the adversary.
  - HIGH vacuous "never faster" test → deleted (exact token values cover it); `.mf-blink` declaration kept in the keyframes test.
  - MEDIUM legacy listener fallback removed; MEDIUM e2e uses `sign-in.ts`; MEDIUM `injectReducedMotion` wrapper removed, `REDUCED_MOTION` exported; LOW odometer spec's dial/lamp half removed.
  - Decision A (orchestrator): the gauges panel now sits in `<main>` beside the table panel (heading moved to sample-page, the sample renders its body); e2e checks the real 60 ms stagger; ST-51's 320 px test locator updated to `section.mf-panel:has(mf-cockpit-gauges-sample)`.
  - Deferred: charts read reduced motion once (chart.ts:93, from #23) → deferred.md + Notion task.
- Merged origin/main (#23 ST-52) into the branch, no conflicts. ui-cockpit 371, i18n 428 passed; e2e motion, gauges, cockpit, phone, charts, dashboards ×2 → 120 passed.

## QA lap 1 (pr-tester on ade9319): failure — repair 1 of 5
- report.md / report.json kept in pr-review/lap1 (no images). All motion, reduced-motion and 320/390 flows passed.
- BLOCKER charts.spec "grows the bars in" flaky: the panel's rise made the element screenshot wait → that test removes the panels' animation; 10/10 ×2.
- HIGH axe colour contrast on blinking text → the dot blinks, the text stays; axe colour-contrast on `.mf-live` over one blink period (after the build-up) in motion.spec.
- MEDIUM the stagger counted every sibling (first panel hidden 480 ms) → `:nth-child(n of mf-panel)`; e2e asserts 0 and 60 ms.
- Ignored on the orchestrator's word: the 401 on /me at /app/driver during the sweep (harness limit).
- Verified: ui-cockpit 371 passed; motion + charts ×3 → 51 passed. One earlier full run lost the dev server mid-run (connection refused on 4 chart tests); not reproduced.
