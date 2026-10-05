# Feature Specification: Give the home page its landmarks

**Feature Branch**: `454-home-main-landmark`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-454 — https://app.notion.com/p/3ef607bff0d28150a4b9d50fbc0092b5
**Same finding**: ST-458 — https://app.notion.com/p/3ef607bff0d28115bdbbcb19f9f61434
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by the PR tester on ST-51 (`specs/051-cockpit-gauges/deferred.md`), raised again on ST-286 and ST-390

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A screen-reader user can jump to the home page's content (Priority: P1)

A visitor who uses a screen reader opens MotorFix's home page and asks for the
page's landmarks. Today the page has no main region, and part of what it shows
sits outside every landmark, so "jump to main content" finds nothing and that
content can only be reached by reading the page line by line. The PR tester's
accessibility scan reports both problems on `/`, in every viewport, scheme and
language it sweeps. After this change the page has exactly one main region and
everything it shows belongs to a landmark.

**Independent Test**: open `/` and `/<language>` at a phone width and at a
desktop width, run the accessibility scan, and check that it reports no
landmark rule.

**Acceptance Scenarios**:

1. **Given** a visitor opens `/`, **When** the page has loaded, **Then** it has exactly one main landmark, and the name, version and health line are inside it.
2. **Given** a visitor opens `/ro` or `/en` at a desktop width (where the top "Autentificare" bar shows), **When** the page has loaded, **Then** every piece of visible content sits inside a landmark.
3. **Given** a visitor opens the home page at a phone width (320 px) or a desktop width, in Romanian or English, **When** the accessibility scan runs, **Then** it reports none of `landmark-one-main`, `region`, `landmark-no-duplicate-main` or `landmark-main-is-top-level`.
4. **Given** the page as it looks today, **When** this change lands, **Then** what the page shows and where it shows it is unchanged: the name, the language switch, the version, the health line, the top sign-in button on wide screens and the tab bar on phones.

### Edge Cases

- The page as first sent by the server (before the browser takes over and moves `/` to the language address) also has its main landmark, so a visitor with a slow or failed script still gets it.
- The home page shown inside the public frame never ends up with two main landmarks, or one nested in another.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The home page, at `/` and at each language address, MUST have exactly one main landmark, not nested inside another landmark, holding the page's own content (name, language switch, version, health line).
- **FR-002**: Every visible part of the public pages' frame on the home page (the top sign-in bar on wide screens, the tab bar on phones) MUST sit inside a landmark.

## Spec Delta

### Capability: `phone-layout`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: The accessibility scan of the home page reports 0 landmark violations (`landmark-one-main`, `region`, `landmark-no-duplicate-main`, `landmark-main-is-top-level`) at 320 px and at desktop width, in both languages.
- **SC-002**: Every existing home-page and public-frame test still passes unchanged.

## Assumptions

- (autonomous default) `/` renders the home page inside the same public frame as `/ro` and `/en`, rather than the home page carrying a `<main>` of its own: the frame already holds the one `<main>` for every public page (`apps/web/src/app/public/frame.ts`), and a second one in Home would nest inside it at `/ro` (Principle I: one place for the shell).
- (CI lap 1) `/` renders the frame without the tab bar (route data `tabBar: false`): ST-287 keeps the bar off the server's render of `/`, which exists for search engines; the browser moves on to `/<lang>`, where the bar shows. The bar now also reads the address it starts on, since the frame may create it after that navigation ended.
- (autonomous default) The frame's top bar becomes a banner landmark (`<header>`); no new text, no visual change.
- (autonomous default) No other public page is in scope beyond what the shared frame fixes for them too; the not-found page already has its own `<main>`.
- (autonomous default) ST-286's note to "add the landmarks when Home's real screen is built in Discovery" is superseded by the ticket being Ready to work; when Discovery replaces Home's content it keeps the frame's landmarks.
