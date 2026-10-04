# Implementation Plan: The shared dialog and right-hand drawer

**Branch**: `157-dialog-drawer` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)
**Input**: spec.md, design.md, context.md

## Summary

A new `libs/overlays` library (`@motor-fix/overlays`) with one `Overlays` service: `open(task, { shape, title, data?, confirmDiscard? })` returns a promise of the task's result or `cancelled`. It opens an `OverlayPanel` through Spartan's `BrnDialogService` (Angular CDK dialog underneath: focus trap, focus restore, block-scroll strategy, modal ARIA, close on navigation). The panel draws the kit's existing surfaces (`spartan-dialog-content`, `spartan-sheet-content[data-side="right"]`), so ST-53's `mf-pop` and reduced-motion rule apply untouched, and owns the three closes, the discard question, the first-field focus and the loading skeleton. The task component reads its data and closes itself through `injectOverlayTask()`. The kit's catalogue (`/cockpit`) gets a sample task opened in all three shapes.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Angular 22.2.1 standalone with signals, zoneless tests (`libs/*/src/test-setup.ts`).
**Primary Dependencies**: `@spartan-ng/brain` 1.5.0 (`dialog`: `BrnDialogService`, `BrnDialogRef`, `injectBrnDialogContext`), `@angular/cdk` 22.2.1 (`DialogRef`, `OverlayPositionBuilder`), `@motor-fix/i18n` (`TranslatePipe`). No new npm dependency.
**Storage**: none.
**Testing**: Jest 30 through `jest-preset-angular` (jsdom) from the root preset; Playwright 1.63 `apps/web-e2e` against `/cockpit`; axe-core 4.13 in the e2e.
**Target Platform**: browser, Angular SSR (`apps/web`); the service only runs on user action, so nothing renders on the server.
**Project Type**: Nx monorepo library (`libs/overlays`), consumed by `libs/ui-cockpit` (catalogue) and later `apps/web` (sign-in).
**Performance Goals**: the panel shows on the same frame as the click; a loader task shows its skeleton at once.
**Constraints**: no route change, no history entry; 44 px targets; 12 px minimum text; texts through i18n in RO and EN; Romanian hyphens are U+2011 (ST-18's check); no PrimeNG.
**Scale/Scope**: 1 service, 1 panel component, 1 task helper; catalogue sample; 4 shell text keys; ~10 cockpit sample keys.

## Constitution Check

- **I. No Bloated Code**: one service, one panel; no interface layer; the shapes are three CSS classes; no new dependency. The new library is the one the Build brief and the Front end architecture name; it is three source files plus Nx config (Complexity Tracking).
- **II. Test Discipline**: unit specs colocated (`libs/overlays/src/*.spec.ts`) written first and red; e2e `apps/web-e2e/src/overlays.spec.ts` for the browser-only behaviour (Tab trap, real scroll, widths, axe).
- **III. Given Stack**: Spartan brain + CDK, not PrimeNG; Biome; Jest; Playwright.
- **IV. One Toolchain**: Nx project with the same `typecheck`/`test`/`test:mutation` shape as `libs/media`.
- **V. Rules in One Place**: the shapes' widths live in the panel's styles only; the theme's surfaces stay in `cockpit.css`.
- **VI. PostgreSQL**: not touched.
- **VII. Lifecycle**: draft PR #40 open; Notion in step.

## Project Structure

### Documentation (this feature)

```text
specs/157-dialog-drawer/
├── spec.md, plan.md, tasks.md, design.md, context.md, auto-run.md, notion-sync.md
└── checklists/requirements.md
```

### Source Code

```text
libs/overlays/                      (new Nx library)
├── project.json, jest.config.cts, tsconfig.json, tsconfig.lib.json, tsconfig.spec.json, stryker.config.json
└── src/
    ├── index.ts                    Overlays, injectOverlayTask, types
    ├── overlays.ts                 the service: shape → Brn options, result promise
    ├── panel.ts                    OverlayPanel: header, X, body, discard question, skeleton, focus
    ├── task.ts                     OVERLAY_TASK token, injectOverlayTask(), OverlayTask type
    ├── overlays.spec.ts            unit: closes, result, focus, scroll lock, discard, stacking, ARIA, loader
    └── test-setup.ts
tsconfig.base.json                  path "@motor-fix/overlays"
libs/i18n/src/shell/{ro,en}.json    overlay.close, overlay.discard.{question,discard,keep}
libs/ui-cockpit/src/lib/sample-task.ts   (new) the catalogue's sample task
libs/ui-cockpit/src/lib/sample-page.ts   three open buttons and the last-result line
libs/i18n/src/cockpit/{ro,en}.json  overlay.* sample texts
apps/web-e2e/src/overlays.spec.ts   (new) e2e flows
```

**Structure Decision**: `libs/overlays` depends on Spartan brain, the CDK and `libs/i18n` only; `libs/ui-cockpit` depends on it (architecture: `ui-cockpit → overlays`). The panel uses the class names `cockpit.css` styles (`spartan-dialog-content`, `spartan-sheet-content`, `spartan-dialog-close`, `spartan-button spartan-button-variant-*`, `mf-label`) rather than importing the kit's helm, which would be a cycle; the close cross is drawn inline (the same path as the kit's `mf-close-icon`).

## Design decisions

- **Opening**: `BrnDialogService.open(OverlayPanel, undefined, context, options)` with `disableClose: true` and `closeOnOutsidePointerEvents: false`, so Brn's own Escape and outside handling never closes; the panel subscribes to the CDK `DialogRef`'s `keydownEvents` (the CDK sends keys to the topmost overlay only, which gives FR-011) and `backdropClick`, and decides between closing and asking.
- **Backdrop**: `backdropClass: 'spartan-dialog-overlay'`, the class `cockpit.css` already paints with `--mf-mask`.
- **Position**: dialog centred (Brn's default global strategy); drawers `global().top('0').right('0')`; the host is `spartan-sheet-content` with `data-side="right"` (fixed, full height, ST-53 pop from the right edge).
- **Widths**: host styles `min(480px, 100vw)` and `min(720px, 100vw)` for drawers; the dialog keeps the kit's `min(480px, 100vw − 32px)` plus `max-height: calc(100dvh − 48px)`; header and body in grid rows, the body `overflow-y: auto; overscroll-behavior: contain`.
- **Scroll lock**: the CDK block strategy (Brn's default): the page keeps its scroll position and is restored on close; a stacked task finds the page already blocked and leaves it to the first.
- **Focus**: `autoFocus: false`, `restoreFocus: true`; after render the panel focuses the first field when `matchMedia('(min-width: 768px) and (pointer: fine)')` matches, else the dialog container. A loader task does the same once it arrives.
- **ARIA**: `role: 'dialog'`, `ariaModal: true`, `ariaLabelledBy` the panel title's id.
- **Result**: `firstValueFrom(brnRef.closed$)`, `undefined` (any dismissal, close on navigation) → `'cancelled'`.
- **Discard**: `input` events from the body set `changed`; the task can call `markUnchanged()`; X/Escape/backdrop with `changed && confirmDiscard` show the question (body hidden, not destroyed).
- **Task source**: a component class (`reflectComponentType` is non-null) or a loader function.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New Nx library `libs/overlays` | Named by the Build brief and the Front end architecture (`ui-cockpit → overlays`); sign-in in `apps/web` and the kit's catalogue both use it | Putting it in `libs/ui-cockpit` contradicts the architecture page and would leave the bottom-sheet story to move it later |
| Loader task source (`() => Promise<Type>`) | Brief FR-012 *(proposed)*; sign-in is loaded on demand | Callers awaiting the import before `open` would show nothing until the code arrives |
