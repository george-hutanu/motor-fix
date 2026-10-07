# Implementation Plan: Back closes the open task and keeps the page

**Branch**: `491-back-closes-task` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)
**Input**: spec.md (Clarifications of 2026-10-07), context.md (Constraints), design.md (no screen of its own)

## Summary

Each open task gets one same-address history entry, marked in `history.state`; Back removes it and the panel closes as the X would (discard question included); every other close steps back itself and hands the result once the browser has reported the step. The change is confined to `libs/overlays` (the panel owns the entry; the service stops the CDK from closing every overlay on `popstate`), its colocated specs and the web end-to-end suite. No text, option, control or dependency is added.

## Technical Context

**Language/Version**: TypeScript 6.0.3, Angular 22.2.1 standalone with signals (`package.json` devDependencies / dependencies; `package-lock.json`:324, 540).
**Primary Dependencies**: `@spartan-ng/brain` 1.5.0 (`BrnDialogService`, `BrnDialogRef`; `package-lock.json`:11617), `@angular/cdk` 22.2.1 (`Dialog`, `DialogConfig`, `DEFAULT_DIALOG_CONFIG`, `DialogRef`, exported at `node_modules/@angular/cdk/fesm2022/dialog.mjs`:721), `@angular/router` 22.2.1 (`provideRouter(routes)` with no options, `apps/web/src/app/app.config.ts`:25). No new npm dependency.
**Storage**: N/A (no data; the browser's session history only).
**Testing**: Jest 30.5.2 with `jest-preset-angular` 17.0.1 on `jest-environment-jsdom` 30.5.2 / jsdom 30.1.1 (`package.json`; `libs/overlays/jest.config.cts` `testEnvironment: 'jsdom'`); Playwright `@playwright/test` 1.63.0 in `apps/web-e2e`.
**Target Platform**: the browser, in `apps/web` (Angular SSR). The service runs on user action only; where there is no window nothing is pushed or listened to (FR-008; context.md Constraints: front end only, A10).
**Project Type**: Nx library `libs/overlays` (`project.json`: `typecheck` runs `ngc` on `tsconfig.lib.json` and `tsc` on `tsconfig.spec.json`; `test:mutation` present; path `@motor-fix/overlays` in `tsconfig.base.json`:28).
**Performance Goals**: none beyond today: one `pushState` per open, one `history.back()` per non-Back close; the close animation is Brn's (`spartan-ng-brain-dialog.mjs`:157-176).
**Constraints**: the Back entry is one the router ignores and every other close calls `history.back()` (context.md Constraints, ST-491 Finding); the sheet's X, tap outside and drag past a third each remove the entry (ST-158 scenario 4); the address never changes (MF-5 rule 1); Constitution I, ~40 lines of logic.
**Scale/Scope**: 2 source files changed (`panel.ts`, `overlays.ts`), 2 unit specs extended, 2 end-to-end specs extended; the `overlays` capability's 157-FR-001/005/011 modified per the Spec Delta.

## Constitution Check

- [x] **I. No Bloat**: one marker key, one module counter, one `popstate` listener per panel, one child environment injector in the service. No new option on `open()`, no new text, no catalogue control, no dependency. Rejected: a history service of its own (one consumer), a `closeOnNavigation` fork of Brn (the CDK default is overridable through a public token), a reload hook that clears stale entries (spec Assumption).
- [x] **II. Test Discipline**: failing Jest specs first in `libs/overlays/src/panel.spec.ts` and `overlays.spec.ts` (jsdom fires `popstate` as a queued task on `history.back()`: `node_modules/jsdom/lib/jsdom/living/window/SessionHistory.js`:19-20, 129-137, `History-impl.js`:37-51; the specs' `settle()` already waits a macrotask three times), then Playwright in `apps/web-e2e/src/overlays.spec.ts` and `sheet.spec.ts` with `page.goBack()` / `page.goForward()`. No FR id in source.
- [x] **III. The Given Stack**: Angular CDK dialog under Spartan brain, as today; the fix for the CDK's `closeOnNavigation` uses its public `DEFAULT_DIALOG_CONFIG` token.
- [x] **IV. One Repository, One Toolchain**: same Nx library, root Jest preset, Biome.
- [x] **V. Rules Live in One Place**: the entry's marker and the step-back live in the panel only; the service only changes how its `BrnDialogService` is built. No API.
- [x] **VI. PostgreSQL Is the Truth**: not touched.
- [x] **Notion choices**: Build brief scenario 8 stays *(proposed)*; no T-item applies (context.md Open Decisions). ST-22's overlay route (`?review=:jobId`) is out of scope (spec Assumptions).

## Project Structure

### Documentation (this feature)

```text
specs/491-back-closes-task/
├── spec.md, context.md, design.md, plan.md (this file), quickstart.md
├── research.md      N/A: no NEEDS CLARIFICATION; every decision below carries its evidence
├── data-model.md    N/A: no entity, no storage
├── contracts/       N/A: no API; the library's public surface (open(), OverlayTask) is unchanged
└── tasks.md         /speckit-tasks
```

### Source Code (repository root)

```text
libs/overlays/src/
├── overlays.ts          service: its BrnDialogService from a child environment injector whose
│                        CDK Dialog has closeOnNavigation: false; comment updated (no close on navigation)
├── panel.ts             OverlayPanel: the history entry on open, popstate → Back close, step back on every
│                        other close, result handed after the step; dismiss()/close() routed through it
├── overlays.spec.ts     unit: "changes neither the address nor the history" rewritten (address unchanged, one
│                        Back after a close leaves the page); Back closes top only; result after the step back;
│                        close with the entry not current moves nothing; no entry without a window
├── panel.spec.ts        unit: Back on a sheet; drag then one Back leaves; discard question on Back, asks again
apps/web-e2e/src/
├── overlays.spec.ts     e2e on /cockpit reached from /: Back closes one task and keeps page, scroll and focus;
│                        each other close then one goBack() reaches /; Forward reopens nothing; stacked; discard
├── sheet.spec.ts        e2e at 390×844 and 320×640: Back closes the sheet; the drag then one goBack() reaches /
.specify/capabilities/overlays.md   merged by /speckit-archive (Spec Delta), not by this plan
```

**Structure Decision**: the panel owns `dismiss()` and `close()`, the two paths every close already goes through (X, Escape, outside, drag, Discard, the task's `close(result)` through `taskApi.close`), so the history logic sits there and the service changes only how it obtains its dialog service. No new file.

## Design

Each decision carries its evidence; the Clarification answers of spec.md are the requirements they implement.

1. **Stop the CDK closing every overlay on `popstate`.** `BrnDialogService.open` passes no `closeOnNavigation` to `Dialog.open` (`node_modules/@spartan-ng/brain/fesm2022/spartan-ng-brain-dialog.mjs`:195-245), so the CDK default `closeOnNavigation = true` (`node_modules/@angular/cdk/fesm2022/dialog.mjs`:60) becomes the overlay's `disposeOnNavigation` (`dialog.mjs`:526), and the overlay subscribes to `Location` and disposes on any popstate (`_overlay-module-chunk.mjs`:784-786): every open task at once, and on the service's own `history.back()` too. `Dialog` merges `inject(DEFAULT_DIALOG_CONFIG, {optional: true})` under the per-call config (`dialog.mjs`:442-470) and shares `openDialogs` with its parent `Dialog` through `inject(Dialog, {optional, skipSelf})` (`dialog.mjs`:444-453). So `Overlays` builds `createEnvironmentInjector([{ provide: DEFAULT_DIALOG_CONFIG, useValue: { ...new DialogConfig(), closeOnNavigation: false } }, Dialog, BrnDialogService], inject(EnvironmentInjector))` and takes `BrnDialogService` from it; `BrnDialogService` is `providedIn: 'root'` (`spartan-ng-brain-dialog.mjs`:296) and an explicit provider in the child wins. The app's declarative Spartan dialogs keep the CDK default. Implements the first Clarification (drop close-on-app-navigation; stacking holds).
2. **The entry.** Module counter `entries`; each panel takes `entry = ++entries` on construction and, when `this.window` exists, calls `history.pushState({ ...history.state, mfOverlay: entry }, '')` (same URL). Copying `history.state` keeps the router's `navigationId` / `ɵrouterPageId` (`node_modules/@angular/router/fesm2022/_router-chunk.mjs`:4463-4472; read at 4374). The router handles the popstate as a same-URL request: `isUpdatedBrowserUrl()` compares the browser URL with the current one (4089-4094), `router.navigated` is true, so with the default `onSameUrlNavigation = 'ignore'` (4546; `provideRouter(routes)` passes nothing, `app.config.ts`:25) the request is skipped at 3855-3857 with no `NavigationStart`. Implements FR-001 and the second Clarification (a marker in the state). `pushState` also prunes forward entries, so FR-006 needs no code: after a Back close the forward entry holds a marker of a destroyed panel, and a later open replaces it.
3. **"Gone" and the `popstate` listener.** A panel's entry is gone when `(history.state?.mfOverlay ?? 0) < entry`. One `window.addEventListener('popstate', …)` per panel, removed through `DestroyRef`. On popstate with the entry gone: if `leaving` holds a pending result (decision 4) → `dialog.close(leaving.result)`; otherwise it is a Back press → `dismiss()`, and when that showed the discard question, push the entry again (`pushState` with the same marker) so a further Back asks again (FR-003; the spec's FR-003 and Assumption say so in these words). With stacked tasks the popstate lands on the lower task's marker, which is below the top's `entry` only: the top closes, the lower stays (FR-002). A router navigation is a `pushState`, not a popstate, so the listener never fires on app navigation (FR-007, "adds no close on app navigation").
4. **Every other close steps back first.** `close(result?)` (the Discard button, `taskApi.close`, and `dismiss()` when nothing changed): if `history.state?.mfOverlay === entry` → `leaving = { result }`, `history.back()`, and the dialog closes on the popstate of decision 3; else → `dialog.close(result)` at once (FR-004, FR-007: the entry is not current after the bell's sign-out navigation, `apps/web/src/app/dashboard/bell.ts`:36). The opener's promise is `firstValueFrom(ref.closed$)` (`overlays.ts`:55), which settles only after Brn's close, hence after the browser's report: FR-005 and the fifth Clarification (no timer), so `sign-in-dialog.ts`:33/39/61 (`await overlays.open(...)` then `router.navigateByUrl`) needs no change. Escape and outside while the question shows keep (`panel.ts`:304, 309), as today.
5. **No window.** `this.window` is `inject(DOCUMENT).defaultView` (`panel.ts`:259); when null nothing is pushed, listened to or stepped back and `close()` closes at once (FR-008).
6. **Accepted edges, from the spec.** A reload with a task open, a Forward onto a closed task's entry, and a task closed while its entry is under a newer one each leave one dead same-address entry (spec Assumptions, third Clarification). A Back after an app navigation made with a task still open can close that task once the person is back on its page; it is not navigated anywhere a Back would not have gone.
7. **Tests to change, not only add.** `overlays.spec.ts`:192 ("changes neither the address nor the history") asserts `history.length` unchanged; after a non-Back close the removed entry remains as a forward entry, so the check becomes: address unchanged, no marker in `history.state`, and one `history.back()` from a prior pushed page entry reaches that page (SC-002). The e2e "closes with …" cases (`overlays.spec.ts`:119, `sheet.spec.ts`:218) gain `page.goBack()` → the page before `/cockpit`. The cockpit sample (`libs/ui-cockpit/src/lib/sample-task.ts`: `task.close('saved')`, "Open another") already drives a result close and stacking; SC-004 (navigate on a result, Back returns) uses the real sign-in in `apps/web-e2e/src/sign-in.spec.ts` (`ready(page, '/ro')`, `openFromHeader`) and `page.goBack()` after the landing.

## Complexity Tracking

None: no constitution gate is violated.
