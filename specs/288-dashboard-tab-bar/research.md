# Research: dashboard tab bar

## 1. Views as child routes, guarded with canMatch
- Decision: each dashboard route (`app/driver`, `app/garage`, `app/admin`) gets `children` from `dashboardRoutes(area)`: `''` for the dashboard view, one route per view with `canMatch` reading `Session.current().capabilities` against the view's capability; a refused or unknown view falls through to `'**'`, which redirects to `''` (the dashboard's own address).
- Rationale: the spec's redirect-before-load (Clarification 3) and the existing `areaGuard` pattern; the parent's guard has already loaded the session.
- Alternatives: a `canActivate` (loads the view first); keeping views as frame state (no addresses, no `aria-current="page"`).
- Evidence: `apps/web/src/app/dashboard/area.guard.ts:8-20`, `apps/web/src/app/app.routes.ts:30-32`.

## 2. Current-page marking
- Decision: `RouterLinkActive` with `ariaCurrentWhenActive="page"` and `[routerLinkActiveOptions]="{ exact: view.path === '' }"` on both menu links and tabs.
- Rationale: built into the router; sets `aria-current` only on the active link.
- Evidence: `node_modules/@angular/router/types/_router_module-chunk.d.ts` (`ariaCurrentWhenActive` input of `RouterLinkActive`).

## 3. Phone vs tablet
- Decision: CSS `@media (min-width: 768px)` hides the bar; below it the aside's nav is hidden; no `BreakpointObserver`.
- Rationale: SSR-safe, no listener, same approach as `mf-public-tab-bar`.
- Evidence: `apps/web/src/app/public/tab-bar.ts` styles (`@media (min-width: 768px) { :host { display: none; } }`).

## 4. Scrolling the active tab into sight
- Decision: on the link's `isActiveChange` (true), `scrollIntoView({ block: 'nearest', inline: 'nearest' })` on that link, guarded for environments without it (jsdom, the server). Not on `NavigationEnd`: `RouterLinkActive` sets `aria-current` in a microtask after it (`node_modules/@angular/router/fesm2022/_router_module-chunk.mjs`, `update()`), so a first-render query found no current tab.
- Rationale: a no-op when already visible; keeps the page from scrolling vertically.

## 5. Account controls on a phone
- Decision: the aside stays on a phone as a top band (logo, area tag, name, sign out); only its nav is hidden.
- Rationale: one DOM for the account controls; the phone e2e already passes with the aside stacked at the top (`apps/web-e2e/src/phone.spec.ts`).
