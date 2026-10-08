---
capability: ui-review
updated: 2026-10-08
features:
  - 953-ui-review-checks
---

# Capability: UI review

How a PR's screens are reviewed before it merges: the measured layout checks the PR QA sweep runs at every viewport, colour scheme and language, the screenshot comparison against `main`, the design rubric and mock-fidelity check the PR tester judges by, and the design audit hardening runs on a change that touches the web app. Requirements arrive with feature 953 (`node .claude/scripts/capabilities.mjs merge 953-ui-review-checks --apply` at archive).

## Requirements

### 953-FR-001 — The sweep MUST report text below the minimum size: on phone viewports (390 and 320 px) any text in a reading or interaction role (paragraphs, list items, table cells, form fields, buttons, standalone links) rendered under 16 px, measured on the element's own text (a `small` or caption element inside it is measured as its own element); at every viewport any visible text rendered under 12 px; and at every viewport any text input, textarea or select rendered under 16 px.

_From 953-ui-review-checks._

### 953-FR-002 — The sweep MUST report text whose rendered font size is not one of the Cockpit type-scale sizes, read from the UI library's theme tokens at run time, never from a list kept in the check. When the theme defines line-height or weight tokens, the same check applies to those; a dimension the theme does not define as a token is not checked.

_From 953-ui-review-checks._

### 953-FR-003 — The sweep MUST report, on phone and tablet viewports, an interactive control whose rendered size is under 44 by 44 px, except a link inside running text.

_From 953-ui-review-checks._

### 953-FR-004 — The sweep MUST report text that is clipped or ellipsised: an element with overflow hidden or clip, a text ellipsis or a line clamp whose content is wider or taller than its box by more than 0.5 px, measured on the element's own text, and text that spills more than 0.5 px sideways out of a box with overflow visible. A container that scrolls (overflow auto or scroll) is not clipped text.

_From 953-ui-review-checks._

### 953-FR-005 — The sweep MUST report two interactive elements, neither containing the other, whose rendered boxes intersect by more than 0.5 px on both axes.

_From 953-ui-review-checks._

### 953-FR-006 — The sweep MUST report spacing off the 4 px grid: a visible element whose computed `gap` (row or column) or padding is not 0 and not within 0.5 px of a multiple of 4 px. Margins are not measured (an `auto` margin computes to whatever centres the box).

_From 953-ui-review-checks._

### 953-FR-007 — The sweep MUST report an image whose rendered aspect ratio differs from its natural aspect ratio by more than 2 % (a stretched or squashed image).

_From 953-ui-review-checks._

### 953-FR-008 — The sweep MUST report a web font the page asked for that did not load, naming the family expected and the fallback in use.

_From 953-ui-review-checks._

### 953-FR-009 — The sweep MUST report an interactive element that shows no visible focus indication when it has keyboard focus, measured at the desktop viewport only: none of its outline, box shadow, border colour or background colour differs between unfocused and focused, or its outline is none.

_From 953-ui-review-checks._

### 953-FR-010 — Every finding from FR-001 to FR-009 MUST carry the element's selector, the value measured, the value expected, the route, viewport, scheme and language it was seen in, and the screenshot as evidence; one finding lists every combination it was seen in, as today.

_From 953-ui-review-checks._

### 953-FR-011 — Severities follow the rubric: text under the minimum (FR-001), sideways scroll at 320 px, clipped text (FR-004), off-scale type (FR-002), a contrast failure and a measured gap off the grid (FR-006) are high and block the merge; tap targets (FR-003), overlap (FR-005), stretched images (FR-007), a fallback font (FR-008) and a missing focus ring (FR-009) are medium. A finding on a PR that touches no web code stays capped at medium, as today; and a layout finding the baseline run (FR-012) already reported, by the same key, is pre-existing and capped at medium, so a PR is never blocked by a defect `main` already had. A baseline report from a tester that measured no layout (no `layout: true`) cannot tell the two apart, so every layout finding is pre-existing that lap.

_From 953-ui-review-checks._

### 953-FR-012 — The QA run MUST compare each screenshot of the PR head with the baseline screenshot of the same route, viewport, scheme and language from the newest finished PR QA run of a commit already on `main` (an ancestor of the PR's base), and list every changed region per shot with a diff image under the run's evidence folder; a shot with no changed region is marked identical.

_From 953-ui-review-checks._

### 953-FR-013 — A changed shot on a route the PR did not touch MUST be a finding (medium). On a PR that touches no web code the run raises it; on a web PR the run lists every changed shot and the tester raises it when the change is a defect.

_From 953-ui-review-checks._

### 953-FR-014 — When no such baseline run can be found or downloaded, the run MUST say so in the report and list every shot as new; it does not boot `main` a second time.

_From 953-ui-review-checks._

### 953-FR-015 — The PR tester's instructions MUST carry a design rubric with its severities: high (blocking) for text under the minimum, sideways scroll at 320 px, clipped text, broken alignment, a contrast failure and off-scale type; medium for inconsistent spacing, weak hierarchy, cramped density and amateur polish (misaligned icons, uneven padding, orphaned words in buttons, mixed radii); with the Apple design guidance and the design-audit skill (its scan and contrast helpers) as the references.

_From 953-ui-review-checks._

### 953-FR-016 — For every changed screen whose `design.md` names a board, the tester MUST compare the screenshot with the board at the same viewport on type hierarchy, spacing, alignment, colour, component choice and states, and report any difference `design.md` does not explain as a finding at the rubric's severity; a screen with no board is judged by the rubric alone and the review says so.

_From 953-ui-review-checks._

### 953-FR-017 — Hardening MUST run the design audit on the changed screens when the feature's diff touches the web app or the UI library, list its findings in the hardening report and fix every high finding before the review; when the diff touches no web file the audit is skipped and the report says so.

_From 953-ui-review-checks._

### 953-FR-018 — The spec reviewer MUST check the implementation against `design.md` and report a screen that does not conform.

_From 953-ui-review-checks._

### 953-FR-019 — Every new check MUST have its tests before its implementation: a unit test of the rule, and a fixture page per check that must fail it and one that must pass it, run through the real check in a browser; every changed gate gets a harness-eval case; a gate script's fingerprint is re-recorded only after its diff was read.

_From 953-ui-review-checks._

### 953-FR-020 — The checks MUST run inside the existing PR QA workflow on GitHub Actions, within its time budget (recent successful runs take 3 to 7 minutes under a 60-minute limit); a run that takes longer because of this feature states the cost in the PR. No screenshot, baseline or diff image is ever committed to a repository; they are run artifacts.

_From 953-ui-review-checks._

## Retired
