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
