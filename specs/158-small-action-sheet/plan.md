# Implementation Plan: Open small actions as a bottom sheet on a phone

**Branch**: `158-small-action-sheet` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)
**Input**: spec.md, design.md, context.md

## Summary

`Overlays.open()` matches `(min-width: 768px)` when a task opens; when it does not match, the panel's context says `sheet: true` and the CDK pane sits on the bottom edge. The panel then renders on the kit's sheet surface with `data-side="bottom"`, adds a grip row above its header, caps itself at 92 % of the visible height and, while it is a sheet, follows `window.visualViewport` (bottom offset and height cap as CSS variables on the host, the focused element scrolled into view). Dragging the grip moves the panel with the pointer; on release past a third of the height measured at the drag's start it returns to rest and calls the same `dismiss()` the X calls; otherwise it springs back. The kit's `cockpit.css` gains the bottom edge of its sheet surface (geometry and `mf-pop`'s origin). Callers, texts and the public API do not change.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Angular 22.2.1 standalone with signals (`package.json`).
**Primary Dependencies**: `@angular/cdk` 22.2.1 (`OverlayPositionBuilder`, the dialog's block scroll strategy and focus trap), `@spartan-ng/brain` 1.5.0 dialog (`BrnDialogService`, as ST-157). No new npm dependency.
**Storage**: none.
**Testing**: Jest 30.5.2 through `jest-preset-angular` (zoneless, `libs/overlays/src/test-setup.ts`), jsdom 30.1.1 (`PointerEvent`, no layout: sizes and `visualViewport` are faked in the spec); Playwright 1.63.0 in `apps/web-e2e` against the catalogue `/cockpit`, axe-core 4.13.0.
**Target Platform**: browser; on the server `open()` is never called.
**Project Type**: Nx monorepo — libs `overlays` (code), `ui-cockpit` (kit CSS); app `web-e2e`.
**Performance Goals**: the drag follows the pointer every frame (one style write per `pointermove`, no layout read during the drag).
**Constraints**: 44 px targets, 12 px minimum text, 320 px without sideways scroll, no animation under reduced motion (the kit's global rule), safe areas from the kit's `--mf-safe-*` tokens; `libs/*` use bundler resolution (no `.js` on relative imports, as `libs/overlays/src/index.ts`); `libs/overlays` must not import `libs/ui-cockpit` (cycle: `ui-cockpit → overlays`, specs/157-dialog-drawer/plan.md:62).
**Scale/Scope**: ~80 lines in `panel.ts`, ~10 in `overlays.ts`, ~15 lines of kit CSS; unit and e2e specs.

## Constitution Check

- **I. No Bloated Code**: no new shape option, no sheet component, no gesture library; one `sheet` flag on the existing panel context, three pointer handlers and one viewport listener inside the panel. The 768 px query is one constant shared with the panel's existing `COMPUTER` query.
- **II. Test Discipline**: red first: `libs/overlays/src/sheet.spec.ts` (new: shape by width, grip, drag threshold, keyboard, safe-area CSS), `libs/ui-cockpit/src/motion.adversary.spec.ts` (bottom origin), `apps/web-e2e/src/sheet.spec.ts` (new, phone flows), and `apps/web-e2e/src/overlays.spec.ts`'s phone test moved to the sheet.
- **III. Given Stack**: Spartan's sheet surface and the CDK, no PrimeNG (A1 amended 2026-10-04).
- **IV. One Toolchain**: existing Nx targets, Biome, Jest, Playwright.
- **V. Rules in One Place**: the phone boundary is the kit's 768 px (one constant in overlays, pinned by the e2e at 767/768 against the kit's CSS); the sheet surface's geometry lives in `cockpit.css` beside the right and left edges; the 92 % cap and the keyboard follow live in the panel only.
- **VI. PostgreSQL**: not touched.
- **VII. Lifecycle**: draft PR #48 open, labelled; Notion in step.

## Project Structure

### Documentation (this feature)

```text
specs/158-small-action-sheet/
├── spec.md, plan.md, tasks.md, design.md, context.md, auto-run.md, notion-sync.md
└── checklists/requirements.md
```

### Source Code

```text
libs/overlays/src/overlays.ts      choose the sheet at open; bottom-edge pane
libs/overlays/src/task.ts          PanelContext.sheet
libs/overlays/src/panel.ts         sheet host bindings, grip, drag, visualViewport follow, styles
libs/overlays/src/sheet.spec.ts    (new) unit specs
libs/ui-cockpit/src/styles/cockpit.css   .spartan-sheet-content[data-side="bottom"] + its origin
libs/ui-cockpit/src/motion.adversary.spec.ts   bottom origin
apps/web-e2e/src/sheet.spec.ts     (new) phone flows
apps/web-e2e/src/overlays.spec.ts  the phone test now expects the sheet
```

## Design decisions

- **Choosing the sheet.** `Overlays.open()` reads `matchMedia(TABLET).matches` (`TABLET = '(min-width: 768px)'`, exported from `panel.ts` beside `COMPUTER`, which becomes `${TABLET} and (pointer: fine)`). No match → `context.sheet = true`, pane `global().bottom('0').left('0')`. Frozen until close (Clarifications 1).
- **Surface.** Host classes `spartan-sheet-content mf-overlay-sheet`, `data-side="bottom"`. Kit CSS: `inset-block: auto 0; inset-inline: 0; width: auto; border-width: 1px 0 0; border-radius: var(--mf-radius-panel) var(--mf-radius-panel) 0 0`, and in the motion block `transform-origin: center bottom`. Panel CSS: `max-height: calc(0.92 * var(--mf-visible-height, 100dvh)); inset-block-end: var(--mf-keyboard, 0px)`; the header loses the top safe area (`:host[data-side='right']` keeps it); header and body pad the sides with `max(<own>, var(--mf-safe-left|right))`.
- **Grip.** A `div.mf-overlay-grip` row, `aria-hidden`, `height: var(--mf-tap)`, `touch-action: none`, a 36 × 4 px `::before` bar in `--mf-line-strong`; the grid becomes `auto auto minmax(0, 1fr)` and the sheet's header drops its top padding.
- **Drag.** `pointerdown` (primary button) captures the pointer, records `clientY` and the host's `offsetHeight`; `pointermove` sets `--mf-drag` (`max(0, dy)`), the host's `transform: translateY(var(--mf-drag))` with the class `mf-overlay-dragging` (no transition); `pointerup` clears the drag (the spring is the host's `transition: transform var(--mf-motion-pop) var(--mf-motion-ease)`, removed under reduced motion by the kit) and, when `dy > height / 3`, calls `dismiss()`; `pointercancel` clears it only.
- **Keyboard.** While a sheet, the panel adds `resize` and `scroll` listeners on `window.visualViewport` (removed on destroy) and on each event writes `--mf-keyboard = max(0, innerHeight − (offsetTop + height))px` and `--mf-visible-height = height px` on the host, then scrolls `document.activeElement` into view (`block: 'nearest'`) when it is inside the body. A `focusin` in the body does the same once the viewport has had a frame. No `visualViewport`: nothing is set, the CSS fallbacks apply.
- **Focus.** Unchanged: on a phone `focusStart()` already focuses the dialog container (no `COMPUTER` match).

## Complexity Tracking

| Addition | Why it is needed | Simpler alternative rejected because |
| --- | --- | --- |
| `visualViewport` listener in the panel | iOS Safari does not shrink the layout viewport for the keyboard, so `dvh` and `position: fixed; bottom: 0` leave the sheet under it (Build brief scenario 5) | `interactive-widget=resizes-content` in the viewport meta is ignored by iOS Safari, and it is the app shell's file, not the library's |
| Overlays' own 768 px constant | `libs/overlays` cannot import `Layout` (cycle) | importing it would make `ui-cockpit ↔ overlays` circular |
