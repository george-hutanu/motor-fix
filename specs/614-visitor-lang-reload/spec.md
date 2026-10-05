# Feature Specification: The visitor's language survives a reload at 320 px

**Feature Branch**: `614-visitor-lang-reload`
**Created**: 2026-10-05
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: ST-614 — https://app.notion.com/p/3f0607bff0d281bb968ef54c590180fa
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Origin**: seen by the PR tester on PR #99 ("open / at 320 px → click EN → reload": `lang before=ro after=ro`), unconfirmed

## Reproduction (by hand, 2026-10-05, dev server of `origin/main` 53ddff0, 320×640)

| Flow | `<html lang>` after the tap | after reload |
|---|---|---|
| Open `/`, wait for the network to settle, tap EN, reload | en (`/en`) | en (`/en`) |
| Open `/`, tap EN as soon as it is visible (before hydration), reload | ro (`/ro`) | ro (`/ro`) |
| Open `/`, tap the switch's first button (RO), reload | ro | ro |

The language a visitor chose does survive a reload. What reproduces the tester's
`before=ro after=ro` is a tap that lands on the server-rendered page before
Angular has hydrated it: the app keeps no record of it, so EN is never chosen.
On a slow phone that is a real visitor's first tap. (Tapping RO, the first
button, gives the same reading and is a selector slip, not a bug.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tap on EN is never lost (Priority: P1)

A visitor on a 320 px phone opens MotorFix and taps EN while the page is still
loading. The page turns English once it is ready, the address becomes `/en`,
and a reload keeps it English.

**Independent Test**: at 320 px, hold back the app's scripts, tap EN on the
server-rendered Home, release the scripts, then reload.

**Acceptance Scenarios**:

1. **Given** Home at 320 px before hydration, **When** the visitor taps EN, **Then** once the app has hydrated `<html lang>` is `en` and the address is `/en`.
2. **Given** the visitor chose EN on Home at 320 px (before or after hydration), **When** they reload, **Then** `<html lang>` is `en` and the EN button is pressed.

### Edge Cases

- A tap after hydration: unchanged.
- Storage blocked: the address still carries the language (existing test).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A tap on a language button that lands before the page has hydrated MUST be applied once it has, exactly as a tap after hydration, on `/` as on a language address.
- **FR-002**: The language a visitor chose on Home at 320 px MUST survive a reload (`<html lang>` and the pressed button).

## Spec Delta

### Capability: `i18n`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: The 320 px reload flows in `apps/web-e2e/src/language.spec.ts` pass, and the early tap fails without the fix.
- **SC-002**: Every existing web and end-to-end test still passes.

## Assumptions

- (autonomous default) The fix is Angular's own event replay, `withEventReplay()` on `provideClientHydration()` in `apps/web/src/app/app.config.ts`: it records events on server-rendered elements before hydration and replays them after. Evidence: the reproduction above; no new dependency (Principle I).
- (autonomous default) Replay alone did not fix `/`: the browser's first navigation sent `/` to `/ro` before hydrating, which threw the server's Home away with the tapped button in it (replay worked on `/ro`, not on `/`). So the first page in the browser now hydrates `/` where it is and moves to `/<remembered or current language>` a task after the app is stable, once the replay has run; every later navigation to `/` redirects as before. A remembered language therefore shows a moment later than before, after hydration rather than before the first client render; the server's page is Romanian either way.
- (autonomous default) Replay is app-wide: every server-rendered button tapped early (not only the language switch) is replayed once. That is the framework's intended behaviour and no screen relies on early taps being dropped.
- (autonomous default) The PR tester's flow is not changed here: once taps are replayed its reading is right; its choice of button is its own prompt, not repo code.
- (autonomous default) Proven with Playwright (`language.spec.ts`), holding the app's scripts back with `page.route` so the tap lands before hydration deterministically; jsdom cannot hydrate a server page.
