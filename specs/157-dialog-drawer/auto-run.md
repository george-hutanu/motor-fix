# Auto run — 157-dialog-drawer

- Description: ST-157 Build the shared dialog and right-hand drawer (Notion https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2), on libs/ui-cockpit's Spartan dialog and sheet; ST-53 motion already merged.
- Start commit: 7685810 (origin/main), worktree `agent-a600dde36061d7cad`, branch `157-dialog-drawer` (the generator offered `475-dialog-drawer`; renamed to the story number, the repo's convention).
- Draft PR: #40 https://github.com/george-hutanu/motor-fix/pull/40

## 0. Size
- Level 2 (feature): the intent has design choices (service shape, discard question, stacking, Back). `level.mjs set 2`.

## Preflight
- Clean tree; `npm ci` in the worktree; `typecheck && lint && test:unit` green (heavy.sh). Constitution v1.6.0 read.

## 1. Constitution
- Read v1.6.0, no placeholders. Principle I and III drive the library and PrimeNG answers.

## 2. Specify
- Spec written from the story, its Build brief, feature MF-5 and the epic. Autonomous answers (also in spec Clarifications):
  - PrimeNG in the brief → Spartan + CDK (Constitution III, AGENTS.md).
  - `libs/overlays` in the brief → inside `libs/ui-cockpit` (dependency cycle with the catalogue; Principle I).
  - Drawer widths 480/720 px (brief over mock 520/660).
  - "A computer" = ≥ 768 px wide with a fine pointer.
  - Changed field = any `input` event in the task body.
  - Back button: deferred (history entry vs router).
- Design check: `design.md` written from `Overlays.dc.html`.
- Notion start: story To do → Planning, timeline Not started → Planning, epic unchanged.
- Coordinator note mid-run: ST-18 merged (8e4773d) — Romanian hyphens must be U+2011, user text through `mf-as-written`. Merged origin/main in.
