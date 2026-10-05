# Feature Specification: The live toast passes axe and is still announced

**Feature Branch**: `582-live-toast-axe`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion**: https://app.notion.com/p/3f0607bff0d281abbe99d98e58a87bd3 (ST-582, Tech debt from ST-257, PR #77 QA lap 2) · Epic: https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (EP-1 Foundations)

## Context

The dashboard's live toast is the shared kit toast (`HlmToaster` in
`libs/ui-cockpit`, Spartan brain sonner 1.5.0). Its markup is
`section > ol[data-sonner-toaster] > brn-sonner-toast > li[role=status][aria-live]`.
axe flags it at every viewport, scheme and language:

- `list` (serious): the `ol` directly contains `brn-sonner-toast` elements, not `li`.
- `aria-allowed-role` (minor): `role="status"` is not allowed on `li`.

The markup comes from the brain library's template, which this repo does not
copy (only helm components are copied into `libs/ui-cockpit`).

## User Scenarios & Testing

### User Story 1 — A screen-reader user hears the toast, and the page passes axe (Priority: P1)

A driver on the dashboard gets a live test update; the toast shows and a screen
reader announces it. An axe scan of the page finds nothing in the toast.

**Acceptance Scenarios**:

1. **Given** a dashboard with a toast shown, **When** axe scans the toaster, **Then** it reports no `list` and no `aria-allowed-role` violation, and no other violation, at 320 px, 390 px, tablet and desktop, light and dark.
2. **Given** the /cockpit sample page in Romanian or English, light or dark, **When** its sample toast shows, **Then** axe reports no violation in the toaster.
3. **Given** a toast is shown, **When** its markup is read, **Then** the toast is a live region (`aria-live` polite, assertive when `important`; `aria-atomic="true"`) holding its text.

### Edge Cases

- Several toasts at once, and a toast added while others show: each one gets the same roles.
- Server render: the toaster renders no toast on the server; nothing runs there.

## Requirements

### Functional Requirements

- **FR-001**: The toast stack MUST pass axe with no violation (`list` and `aria-allowed-role` included) whenever at least one toast is shown, on every screen that mounts `hlm-toaster`.
- **FR-002**: Each shown toast MUST stay a live region: `aria-live="polite"` (`"assertive"` for an important toast) and `aria-atomic="true"` on the element that holds its text.
- **FR-003**: The toast stack MUST keep list semantics: the stack is a list and each toast one item of it.
- **FR-004**: FR-001–FR-003 MUST hold for every toast, including toasts added while others are shown.

### Key Entities

None.

## Success Criteria

- **SC-001**: The PR QA sweep reports no axe `list` or `aria-allowed-role` finding on the dashboard toast at any of its 4 viewports × 2 schemes × 2 languages.
- **SC-002**: No visual change to the toast (same place, colours, text, timing).

## Assumptions

- (autonomous default) The fix lives in `HlmToaster` (`libs/ui-cockpit/src/lib/helm/toaster.ts`) and adjusts the rendered roles after the brain template draws them (explicit `role="list"` on the `ol`, `role="none"` on each `brn-sonner-toast` wrapper, no `role` on the `li`, which keeps its `aria-live` and `aria-atomic`). Evidence: axe-core 4.13.0 on candidate markups — this one is the only clean variant that keeps both the list and the live region; `role="status"` is allowed on no `li` and a status wrapper breaks the list.
- (autonomous default) Dropping `role="status"` keeps the announcement: `role="status"` only implies `aria-live="polite"` + `aria-atomic="true"`, which the `li` already carries explicitly.
- (autonomous default) Copying the brain toaster's template into the repo is rejected (Principle I: ~400 lines of library code to change three attributes).
- (autonomous default) The type is `fix` (the markup a user's assistive technology reads changes), labelled `bug` on the PR; Notion's Issue type stays Tech debt.

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-001–FR-004
