# Implementation Plan: Translation files and runtime language switching

**Branch**: `016-i18n-runtime` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-i18n-runtime/spec.md`

## Summary

A new library `libs/i18n` holds the runtime and the texts: one `ro.json` /
`en.json` pair per area (shell, public, driver, garage, mechanic, admin), a
root `I18n` service whose current language is a signal, a `t` pipe, and plural
keys chosen with `Intl.PluralRules`. The shell's Romanian file is bundled; every
other file is a dynamic `import()` the bundler splits into its own chunk, loaded
when an area is entered or a language is set. Missing English texts and failed
English loads fall back to Romanian. The checks (key parity, empty values,
cedilla diacritics, typed-in template text) run as a Jest spec in the library.
The skeleton page moves its texts onto `shell.*` keys and `index.html` declares
`lang="ro"`. No npm dependency is added.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node ≥24 (`package.json` engines)

**Primary Dependencies**: Angular 22.2.1 standalone + zoneless (`package.json`; `apps/web/src/test-setup.ts` uses `setupZonelessTestEnv`), `@angular/ssr` 22.2.1 with `RenderMode.Server` for every route (`apps/web/src/app/app.routes.server.ts:4`), `@angular/compiler` 22.2.1 (already a dependency; used by the template check). No new package.

**Storage**: N/A (texts are JSON files in the repository)

**Testing**: Jest 30.5.2 + jest-preset-angular 17.0.1 through `@nx/jest/plugin` (`nx.json` plugins, `jest.config.ts`); Playwright 1.63.0 in `apps/web-e2e` (`apps/web-e2e/playwright.config.mts`)

**Target Platform**: Angular SSR web app (`apps/web/project.json` build `outputMode: "server"`), browsers

**Project Type**: web app + Nx library

**Performance Goals**: language change applies in the same frame its files resolve; no page reload (SC-002)

**Constraints**: the shell's Romanian texts must be available synchronously on server and browser so SSR output and hydration agree (FR-011); area files must be separate chunks (FR-009); Biome `useSortedKeys` applies to JSON (`biome.json` assist.actions.source.useSortedKeys), so translation keys are kept sorted.

**Scale/Scope**: 6 areas × 2 languages = 12 files; ~4 shell keys today.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one service, one pipe, one constants
  file, one check module. No dependency: Transloco (Notion *Proposed*) is
  replaced — see research R1. No provider function (the service is
  `providedIn: 'root'`), no route helper (areas are entered with one call from
  a route resolver once routes exist). Empty file pairs for the five areas
  without screens are required by the brief and by lane ownership (Complexity
  Tracking).
- [x] **II. Test Discipline**: red specs first, colocated in `libs/i18n/src`
  and `apps/web/src/app`; Playwright check of the server-rendered Romanian page
  in `apps/web-e2e`. No API/DB involvement.
- [x] **III. The Given Stack**: Angular signals; no second i18n framework
  (Angular build-time i18n is not used — it cannot switch at run time).
- [x] **IV. One Repository, One Toolchain**: a new lib in the Nx workspace,
  Jest from the root config; checks are Jest specs, not a second linter (Biome
  cannot lint Angular template text).
- [x] **V. Rules Live in One Place**: the language list, the area list and the
  fallback rule live once in `libs/i18n`. No API shape touched.
- [x] **VI. PostgreSQL Is the Truth**: N/A — no state stored.
- [x] **Notion choices**: Transloco is Proposed on Architecture › Technology
  stack (https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2, 2026-10-03)
  and in the ST-16 Build brief; this plan replaces it (R1). Rendering SSR for
  public pages (A10, Proposed) is respected. No T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/016-i18n-runtime/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/i18n-api.md
└── tasks.md
```

### Source Code (repository root)

```text
libs/i18n/                         (new)
├── project.json                   (new) name i18n, typecheck target
├── jest.config.cts                (new) test target inferred by @nx/jest/plugin
├── tsconfig.json / tsconfig.lib.json / tsconfig.spec.json   (new)
└── src/
    ├── index.ts                   (new) public API: I18n, TranslatePipe, LANGUAGES, Language, AREAS, Area
    ├── languages.ts               (new) LANGUAGES, AREAS, isLanguage
    ├── files.ts                   (new) the loader map: shell/ro static, all else import()
    ├── i18n.ts / i18n.spec.ts     (new) the service
    ├── translate.pipe.ts / translate.pipe.spec.ts   (new) the `t` pipe
    ├── check.ts / check.spec.ts   (new) file and template checks, run on the workspace
    └── {shell,public,driver,garage,mechanic,admin}/{ro,en}.json   (new)
apps/web/src/index.html            lang="en" → lang="ro"
apps/web/src/app/app.ts            texts → `t` pipe (moves to home/home.ts after ST-79)
apps/web/src/app/app.spec.ts       expectations in Romanian, plus a switch test
apps/web-e2e/src/skeleton.spec.ts  server-rendered page is Romanian with lang="ro"
tsconfig.base.json                 paths @motor-fix/i18n; resolveJsonModule
```

**Structure Decision**: one Nx library `libs/i18n` (Build brief: "the
`libs/i18n` library of `apps/web`"; ST-19 puts its format pipes there too).
Area files live inside the library so the loader map can name them with static
`import()` paths the bundler can split.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Five area file pairs with no keys yet | Brief scope; parallel lanes each own a file from day one (orchestrator) | Creating them on first use makes the first two lanes to touch an area collide on creating it |
