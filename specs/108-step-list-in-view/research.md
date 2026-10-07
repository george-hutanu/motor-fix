# Research: Move through the six steps with the step list in view (ST-108)

Every unknown of the Technical Context was answered from files read in this
worktree; no external fetch was needed.

## R1. Where the page lives and how it is routed

- Decision: a lazy `loadComponent` child `list-your-garage` of the `:lang`
  route inside `PublicFrame`, next to `terms` and `privacy`; the path is added
  to `PUBLIC_PATHS`.
- Rationale: every public page is one path under both language prefixes, with
  `languageAddress` loading the `public` texts and choosing the language before
  the child matches; `PUBLIC_PATHS` feeds the sitemap and the canonical and
  hreflang links, so adding the path there is the whole SEO change.
- Alternatives considered: a per-language slug (`/ro/listeaza-service`, the
  brief's proposal) needs a path-translation mechanism the frame lacks; left
  to an SEO story (spec Assumptions).
- Evidence: `apps/web/src/app/app.routes.ts:50-95`,
  `apps/web/src/app/addresses.ts:32` (`PUBLIC_PATHS`), `:50-56`
  (`languageAddress`), `:40-45` (`alternates`), `:158-172` (`publicAddress`);
  `apps/web/src/server/search.ts:41` (sitemap over `PUBLIC_PATHS`);
  `apps/web/src/server/search.spec.ts:54-62` lists the sitemap's `<loc>`s
  exactly, so it gains the two new addresses.

## R2. The tab title

- Decision: the route's `title` is a `ResolveFn<string>` returning
  `inject(I18n).t('public.listing.heading')`; Angular's default
  `TitleStrategy` writes it to `document.title`.
- Rationale: the spec's assumption is "the tab title is the heading in the
  current language"; the language switch navigates to the other prefix
  (`replaceUrl`), which resolves the title again, so it follows the language
  with no code in the component. The texts are loaded before the child route
  matches (R1), so `t()` has them.
- Alternatives considered: a `Title` service call in the component (extra
  injection and an effect); leaving `MotorFix` (contradicts the assumption).
- Evidence: `node_modules/@angular/router/types/_router_module-chunk.d.ts:2547`
  (`title?: string | Type<Resolve<string>> | ResolveFn<string>`),
  `node_modules/@angular/router/types/router.d.ts:204`
  (`DefaultTitleStrategy`); `apps/web/src/app/addresses.ts:135` and `:104`
  (the switch moves the address with `navigateByUrl(..., { replaceUrl: true })`);
  `libs/i18n/src/i18n.ts:47` (`t(key, params)`); `apps/web/src/index.html:5`
  (`<title>MotorFix</title>` today).

## R3. Texts

- Decision: one new group `listing` in the existing public catalogue,
  `libs/i18n/src/public/{ro,en}.json`: `label`, `heading`, `intro`, `steps`
  (the list's title), `step1`…`step6`, `optional`, `required`, `bar`
  (`"{n} / 6 · {label}"`). Rendered with the `t` pipe and `I18n.t`.
- Rationale: the page is in the public area whose texts `languageAddress`
  already loads; `t()` substitutes `{name}` placeholders, so the bar's text is
  one template string per language.
- Alternatives considered: a TypeScript constant per language like
  `legal-texts.ts` (used there because the legal texts are long documents; the
  step labels are UI strings and belong in the catalogue, where
  `libs/i18n/src/check.ts` checks both languages).
- Evidence: `libs/i18n/src/public/ro.json` (groups `confirmEmail`, `invite`…
  nested by feature), `libs/i18n/src/i18n.ts:47-57` (placeholders),
  `libs/i18n/src/files.ts:1-30` (per-area lazy catalogues),
  `apps/web/src/app/public/placeholder.ts:11` (`{{ title | t }}`).

## R4. Scroll spy: the current step

- Decision: a pure function `currentStep(tops: readonly number[], line: number,
  atEnd: boolean): number` in `apps/web/src/app/public/steps.ts` (the last
  index whose heading top is at or above `line`, the bottom edge of the bar or
  the header; 1 when none; 6 when `atEnd`), called from a passive `scroll` and
  `resize` listener attached in `afterNextRender`, reading the six headings'
  `getBoundingClientRect().top`. The current step is a `signal(1)`, so the
  server render and the first browser paint show step 1.
- Rationale: the spec fixes one rule with two edges (step 1 before any, step 6
  at the page's end); a scroll listener over six rectangles is ~10 lines and
  expresses it exactly, and the decision itself is a pure function Jest tests
  (SC-004). `afterNextRender` never runs on the server, so SSR is safe by
  construction.
- Alternatives considered: `IntersectionObserver` with a `rootMargin` (cannot
  express "step 6 at the end" or "last heading above the line" without extra
  bookkeeping); Angular CDK `ScrollDispatcher` (same listener, one more
  import).
- Evidence: `node_modules/@angular/core/types/core.d.ts:2720`
  (`afterNextRender`); spec FR-005 and Edge Cases.

## R5. The tapped step stays current while the jump settles

- Decision: activating an entry sets the current step to that entry and holds
  it until the jump's own scroll events have stopped (a 150 ms quiet timer
  restarted by each `scroll` event, started at the tap so a jump that moves
  nothing releases the hold too); afterwards the spy resumes on the next
  scroll.
- Rationale: in this story the sections are empty shells, so a tapped step's
  heading cannot always reach the line (section 5 above a short section 6
  lands at the page's end, which the rule reads as step 6), yet FR-006 and the
  US3 test require the tapped entry to become current. A hold during the
  programmatic scroll satisfies both without changing the layout.
- Alternatives considered: giving section 6 a viewport-tall `min-height` so
  every heading can reach the line (a screen of blank page in this story,
  layout for the sake of the spy); the `scrollend` event (not in every
  shipping browser; Playwright's Chromium only would pass).
- Evidence: spec FR-005, FR-006, User Story 3 Independent Test;
  `specs/108-step-list-in-view/design.md` "Six empty section shells".

## R6. The jump and reduced motion

- Decision: each section carries `scroll-margin-top` (the bar's height on a
  phone, the frame's top padding on a desktop) and `heading.scrollIntoView({
  behavior: reduced ? 'auto' : 'smooth', block: 'start' })`, then
  `heading.focus({ preventScroll: true })` on a heading with `tabindex="-1"`.
  `reduced` is the `REDUCED_MOTION` signal from `@motor-fix/ui-cockpit`.
- Rationale: `scroll-margin-top` also makes the browser's own landing on a
  `#pasul-4` fragment stop under the bar, with no router scrolling option;
  the server renders the ids, so the fragment works before hydration (Edge
  Cases). `tabindex="-1"` is focusable programmatically only, as the spec
  asks. `REDUCED_MOTION` already follows the media query live.
- Alternatives considered: `withInMemoryScrolling({ anchorScrolling })` in
  `app.config.ts` (an app-wide change; not needed since the browser handles
  the fragment on load); `window.scrollTo` with a computed offset (duplicates
  what `scroll-margin-top` gives for free).
- Evidence: `libs/ui-cockpit/src/lib/reduced-motion.ts:11-33`,
  `libs/ui-cockpit/src/index.ts:19`; `apps/web/src/app/app.config.ts:25`
  (`provideRouter(routes)` with no scrolling feature);
  `apps/web-e2e/src/motion.spec.ts:89,272` (Playwright's `reducedMotion`).

## R7. One `nav`, two layouts

- Decision: one `<nav [attr.aria-label]="steps">` holding a `<button
  aria-expanded>` bar and one `<ol>`; CSS at the frame's breakpoint lays it
  out: under `(min-width: 768px)` the bar is `display: none` and the `nav` is
  `position: sticky` in the second column of a grid; under `not all and
  (min-width: 768px)` the `nav` is sticky at `top: 0` and the `<ol>` is shown
  only while `open()` (a host class). Outside tap: a `document:click` host
  listener while open; Escape: `keydown.escape` on the host, refocusing the
  bar. A resize from phone to desktop needs no code: CSS shows the list and
  ignores `open`.
- Rationale: FR-004 forbids two copies and FR-005 wants exactly one
  `aria-current`; CSS is the breakpoint the frame already uses (`.top` at
  768 px). On a phone the public frame has no header (`.top` is hidden), so
  the bar's "under the header" is the top of the viewport.
- Alternatives considered: `Layout` from `@motor-fix/ui-cockpit` with two
  templates (`@if`), which the server renders as phone and the browser then
  re-renders (a flash, and two copies in code); Spartan `brn-popover`/`sheet`
  for the open list (a dialog with a focus trap, which the clarification
  rejected: a disclosure).
- Evidence: `apps/web/src/app/public/frame.ts:24-27`;
  `libs/ui-cockpit/src/styles/cockpit.css:449` (phone query form);
  `libs/ui-cockpit/src/lib/layout.ts:15-16` (server says phone);
  spec Clarifications (one `nav`; disclosure, no trap).

## R8. The language switch keeps the page instance

- Decision: the page's own `<header>` holds `<mf-language-switch />`, as
  `Home` does, and nothing else is needed for FR-009.
- Rationale: the switch sets the language signal and the environment
  initializer moves the address to the other prefix with `navigateByUrl`
  (`replaceUrl`); the route config is the same `:lang/list-your-garage`
  entry, so the default route reuse strategy keeps the component instance and
  its state (the current step, future inputs); every text is a signal read
  through `t`, so it re-renders in place. `language.spec.ts` already proves
  the "no reload" switch on Home.
- Alternatives considered: none needed; the public header is another story's.
- Evidence: `apps/web/src/app/home/home.ts:29`, `libs/i18n/src/switch.ts:31-42`,
  `apps/web/src/app/addresses.ts:126-146`, `apps/web-e2e/src/language.spec.ts:34`.

## R9. Tests

- Decision: Jest `apps/web/src/app/public/steps.spec.ts` (the pure function
  and the six RO and EN labels) and `list-your-garage.spec.ts` (the page under
  `RouterTestingHarness` on both addresses, the `nav` and `aria-current`, the
  bar's text, the server render with `PLATFORM_ID: 'server'`); Playwright
  `apps/web-e2e/src/list-your-garage.spec.ts` (desktop tap of each entry,
  390 px bar and jump to step 5, Escape, reduced motion); the two addresses
  join `phone.spec.ts`'s routes for the 320 px sideways and 12 px/44 px
  checks; `search.spec.ts` gains the two sitemap `<loc>`s.
- Rationale: the brief names Jest for the spy and the labels and Playwright
  for the two flows (context.md Constraints); `legal.spec.ts` is the pattern
  for a public page under the harness; `phone.spec.ts` already sweeps every
  public route at 320 and 375 px.
- Evidence: `apps/web/src/app/public/legal.spec.ts:10-27`,
  `apps/web-e2e/src/phone.spec.ts:5-12,26-40`,
  `apps/web/src/server/search.spec.ts:54-62`, `apps/web/jest.config.cts`
  (jsdom, `jest-preset-angular`), `apps/web-e2e/tsconfig.json:3`
  (`nodenext`: literal `.js` on relative imports).

## R10. Query string tolerance (ST-114)

- Decision: nothing to do; a route path matches regardless of the query, and
  `publicAddress` strips the query from the canonical path.
- Evidence: `apps/web/src/app/addresses.ts:162-171`, `:197-198`.
