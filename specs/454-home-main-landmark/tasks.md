# Tasks: Give the home page its landmarks

**Input**: spec.md, design.md (level 1: no plan.md)
**Tests**: required (constitution II, red-first). Test tasks precede the code they cover and must fail first.

Existing paths: `apps/web/src/app/app.routes.ts`, `apps/web/src/app/addresses.ts`, `apps/web/src/app/addresses.spec.ts`, `apps/web/src/app/public/frame.ts`. New: `apps/web-e2e/src/landmarks.spec.ts`.

## Phase 1: US1 A screen-reader user can jump to the home page's content (P1)

**Independent test**: `/` and `/<language>` at 320 px and desktop report no landmark rule in axe.

- [X] T001 [US1] Test: `apps/web/src/app/addresses.spec.ts` — `/` on the server and `/ro` in the browser render exactly one `main`, not nested, holding Home's name, language switch, version and health line; the sign-in bar sits in a top-level `header`; the tab bar is a `nav` (FR-001, FR-002)
- [X] T002 [US1] Test: `apps/web-e2e/src/landmarks.spec.ts` — `/` at 320 px and 1440 px, RO and EN: axe reports none of `landmark-one-main`, `region`, `landmark-no-duplicate-main`, `landmark-main-is-top-level`; the HTML the server sends for `/` holds one `<main>` (FR-001, FR-002, SC-001)
- [X] T003 [US1] `apps/web/src/app/app.routes.ts` + `apps/web/src/app/addresses.ts` — `/` renders Home inside `PublicFrame`, with the public texts loaded on the server (FR-001)
- [X] T004 [US1] `apps/web/src/app/public/frame.ts` — the top sign-in bar becomes a `<header>`; no style change (FR-002)
- [X] T005 Verify: `apps/web` Jest suite green unchanged otherwise (SC-002)
