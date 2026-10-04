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
