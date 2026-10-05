# Feature Specification: Give the live status line room under the header

**Feature Branch**: `612-live-status-spacing`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-612 — https://app.notion.com/p/3f0607bff0d28119a01dcc35cb598b6e
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: tech debt deferred by the PR tester on ST-256 (PR #79), lap 2

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The live status line does not touch the language switch (Priority: P1)

On every dashboard, a live test update shows "Actualizare de test în direct ·
14:03" / "Live test update · 14:03" in a status line under the header. Since
ST-256's first QA lap that line has had no margin and no padding, so at every
size its text sits flush against the bottom edge of the RO/EN switch. After
this change the line starts a small, fixed gap below the header, still aligned
with the header's left edge, whether or not ST-255's offline bar is showing.

**Independent Test**: open a dashboard, deliver a live test update, and measure
the gap between the bottom of the RO/EN switch and the top of the status line;
then take the connection away and measure again with the offline bar shown.

**Acceptance Scenarios**:

1. **Given** a dashboard online at 320 px, 390 px, tablet or desktop width, **When** a live test update arrives, **Then** the status line's top sits at least 8 px (`--mf-space-2`) below the bottom of the RO/EN switch.
2. **Given** the offline bar is showing, **When** the status line holds a test update, **Then** it sits at least 20 px below the bar (the bar's own 12 px bottom margin plus the line's 8 px), and does not overlap it.
3. **Given** any width, **Then** the status line's left edge stays where it was: it carries no horizontal padding or margin.

### Edge Cases

- No test update has arrived: the line is empty; its top margin still applies (8 px above `main`), which is harmless.
- The e-mail banner is shown between the header and the line: the banner's own bottom margin plus the line's top margin separate them.
- The offline bar itself sits flush under the header; that is the bar's own spacing and not this task's (deferred).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The dashboard frame's live status line MUST have a top margin of `--mf-space-2` and no horizontal padding or margin, at every width, so that it never touches the RO/EN switch above it, with or without the offline bar.

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: In the PR QA sweep at 320 px, 390 px, tablet and desktop, the status line is visibly separated from the switch, and no screen scrolls sideways at 320 px.
- **SC-002**: Every existing frame, live and offline-bar test still passes.

## Assumptions

- (autonomous default) `--mf-space-2` (8 px), the value the story names. Evidence: the story's text; `.roles` in `apps/web/src/app/dashboard/frame.ts` already uses `--mf-space-2` for the same small vertical separation.
- (autonomous default) The margin applies whatever sits above the line (header, offline bar or e-mail banner) rather than only when the line follows the header directly: one rule, no sibling selectors over elements that are hidden by `:empty` (Principle I). Under the offline bar the line therefore sits 20 px (12 + 8) below it.
- (autonomous default) The offline bar's own flush top edge under the header is reported as deferred tech debt, not changed here: the story scopes the change to `.live-status`.
- (autonomous default) No text, behaviour or API change.
- (autonomous default) The proof is a Playwright test with the API stubbed (`apps/web-e2e/src/live-status.spec.ts`), not a Jest test: jsdom lays nothing out and resolves no component margin. The stub confirms the e-mail so its banner does not sit between the header and the line.
