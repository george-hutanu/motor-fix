# Research: 016-i18n-runtime

## R1 — Runtime library: Transloco or local code

- **Decision**: local code in `libs/i18n` (a signal-based service and an impure pipe), no dependency.
- **Rationale**: with plurals taken by `Intl.PluralRules` (clarification), what is left is a language signal, a key lookup with a Romanian fallback, `{name}` interpolation, and lazy `import()` per area — well under the cost of a dependency (Principle I). Transloco's own semantics fight the spec: on a failed load it switches the *active language* to the fallback (`setActiveLang` on `translationLoadSuccess` with `wasFailure`), where FR-008 wants only the area's texts to fall back; an unknown language is loaded rather than ignored (FR-006 wants a no-op); and ICU would need `@jsverse/transloco-messageformat` + `@messageformat/core` on top. A signal service is also the constitution's idiom (III: standalone, signals) and is what ST-17/ST-19 need to react to.
- **Evidence**: `node_modules/@jsverse/transloco/fesm2022/jsverse-transloco.mjs` (8.4.0, installed then removed) — `handleFailure` / constructor `events$.subscribe(... setActiveLang(e.payload.langName))`; `npm view @jsverse/transloco-messageformat` dependencies `@messageformat/core ^3.4.0`; Notion Technology stack marks Transloco *Proposed* (context.md Decisions).
- **Alternatives considered**: Transloco 8.4.0 (above); Angular build-time i18n (`@angular/localize`) — rejected by the brief, cannot switch without a reload.

## R2 — Loading files per area, on server and browser

- **Decision**: a static map of loaders; `shell.ro` is a static JSON import (bundled), every other file is `() => import('./<area>/<lang>.json')`. The Angular application builder (esbuild) emits each dynamic JSON import as its own chunk, and the same code runs under SSR without HTTP.
- **Rationale**: no HTTP loader means no absolute-URL problem on the server and no `public/` asset copying; the bundled shell Romanian makes the first render synchronous, so SSR and hydration produce identical text (FR-011).
- **Evidence**: `apps/web/project.json` build executor `@angular/build:application` (esbuild); `tsconfig.base.json` `moduleResolution: "bundler"` (JSON modules need `resolveJsonModule`, added).
- **Alternatives considered**: HttpClient loader from `public/i18n` (needs an absolute URL on the server and a TransferState hand-off); bundling every Romanian file (violates FR-009).

## R3 — Re-rendering on a language change without zone.js

- **Decision**: `t` is an impure pipe whose `transform` reads the service's signals; the template's reactive consumer tracks those reads and re-renders the view when the language or the texts change.
- **Rationale**: the app is zoneless (`apps/web/src/test-setup.ts` `setupZonelessTestEnv`; Angular 22 default); a pure pipe would skip `transform` when the key is unchanged.
- **Evidence**: `apps/web/src/test-setup.ts:1-6`.
- **Alternatives considered**: a `computed` per text in each component (noisy in every screen); a structural directive (more code, same effect).

## R4 — SSR waiting for area files

- **Decision**: `enter(area)` returns a Promise; routes will call it from a resolver, which SSR awaits. Language switches run outside rendering, in the browser. No `PendingTasks` wrapper is needed today.
- **Evidence**: `apps/web/src/app/app.ts:42-48` already uses `PendingTasks` for its own SSR fetch; resolvers are awaited by the router before render.

## R5 — The template check

- **Decision**: `parseTemplate` from `@angular/compiler` over every inline `template:` string and every `*.html` template under `apps/web/src` and `libs/*/src`; flag `Text` nodes, the literal parts of `BoundText`, and static `TextAttribute`s named `title`, `aria-label`, `placeholder`, `alt`, `label` whose trimmed text contains a letter (`/\p{L}/u`). Run as a Jest spec in `libs/i18n`.
- **Rationale**: Biome (the only linter, constitution IV) does not lint text inside Angular templates; a Jest spec runs in `npm test`, i.e. pre-commit and the release pipeline — the brief's "build check".
- **Evidence**: `biome.json` (no HTML/Angular template rules); `package.json` `@angular/compiler` 22.2.1; `.husky/pre-commit` runs `npm run test`.
- **Alternatives considered**: a regex over templates (misreads `{{ }}` and attributes); a custom Biome plugin (GritQL cannot see inside template strings).

## R6 — Plurals

- **Decision**: a count parameter selects `<key>.<category>` with `new Intl.PluralRules(lang).select(count)`; the parity check accepts a plural group whose categories differ between languages as long as each language has `other`.
- **Evidence**: CLDR Romanian categories one/few/other (`new Intl.PluralRules('ro').resolvedOptions().pluralCategories`, Node 24).
