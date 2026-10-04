# Implementation Plan: Give each language its own web address for search engines

**Branch**: `021-language-urls` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-language-urls/spec.md`; context.md; design.md

## Summary

A `:lang` parent route (`ro`, `en`) whose `canMatch` sets the language from the
address before the page renders — on the server and in the browser — and makes
it the remembered choice. `/` keeps rendering Romanian Home on the server; in
the browser its `canMatch` sends it to `/<remembered or current>`. One app
provider keeps the address in step with the language (a switch or another tab
moves `/ro/…` ↔ `/en/…` with `replaceUrl`) and writes the canonical, `hreflang`
and `noindex` tags into `<head>` after every navigation. A not-found page answers
404 for unknown addresses. The Express server answers `/sitemap.xml` and
`/robots.txt` and marks `/app/…` with `X-Robots-Tag: noindex`.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:70`), Node ≥24

**Primary Dependencies**: Angular 22.2.1 (`package.json:6,10`) standalone, zoneless; `@angular/ssr` 22.2.1 (`AngularNodeAppEngine`, `RESPONSE_INIT` in `@angular/core`); `@angular/router` `Router.currentNavigation` signal; Express 5.2.1 (`package.json:27`, `apps/web/src/server.ts`); ST-16/17 `libs/i18n` (`I18n`, `LanguageChoice`, `isLanguage`). No new package.

**Storage**: `localStorage['mf.lang']` (ST-17). No server state; no database read (no GARAGE/MECHANIC/BRAND table yet).

**Testing**: Jest 30.5.2 + jest-preset-angular 17.0.1 (`package.json:59,62`), zoneless (`apps/web/src/test-setup.ts`); server specs use `@jest-environment node` like `apps/web/src/server/edge.spec.ts`; Playwright in `apps/web-e2e` (`playwright.config.mts`, `BASE_URL` → port 4221 for this run).

**Target Platform**: Angular SSR web app (`apps/web/project.json`, `outputMode: server`).

**Project Type**: web app + Nx library.

**Constraints**: hydration — the address's language is loaded by the route guard before the page renders, so server and browser render the same language; `<head>` tags are plain DOM writes through `DOCUMENT` (no Angular API for `<link>`); the public origin is `PUBLIC_WEB_URL` on the server (Railway's proxy may not pass the scheme), else the document's origin; parallel ST-286 edits the app shell → `app.routes.ts`, `app.config*.ts` and `server.ts` get additive lines only.

**Scale/Scope**: 1 public page (Home) × 2 languages; 3 new files in `apps/web`, 1 method in `libs/i18n`.

## Constitution Check

- [x] **I. No Bloat**: no placeholder pages (the parent route covers EP-4's pages);
  no sitemap cache (no data behind it yet); no language cookie; one provider for
  the two browser-side behaviours that both read the routed address; `alternates()`
  has two call sites (head tags, sitemap).
- [x] **II. Test Discipline**: red specs first: `apps/web/src/app/addresses.spec.ts`,
  `apps/web/src/app/not-found/not-found.spec.ts`, `apps/web/src/server/search.spec.ts`,
  `libs/i18n/src/switch.spec.ts` (saved); Playwright `apps/web-e2e/src/addresses.spec.ts`.
- [x] **III. Given Stack**: Angular router + Express already in `apps/web`.
- [x] **IV. One Toolchain**: Biome, Jest, Playwright as configured.
- [x] **V. Rules in One Place**: languages from `LANGUAGES`/`isLanguage`; the public
  page list and the address rule live once in `addresses.ts`, used by the head tags
  and the sitemap.
- [x] **VI. PostgreSQL**: N/A — nothing stored.

## Project Structure

```text
libs/i18n/src/
├── switch.ts            # LanguageChoice.saved(); restore() uses it
├── index.ts             # + isLanguage export
└── shell/{ro,en}.json   # + notFound.*
apps/web/src/
├── app/addresses.ts(.spec)      # NEW: guards, alternates(), PUBLIC_PATHS, SITE_ORIGIN, provideLanguageAddresses()
├── app/not-found/not-found.ts(.spec)  # NEW: 404 page
├── app/app.routes.ts            # '' guard, ':lang' parent, '**' → NotFound
├── app/app.config.ts            # + provideLanguageAddresses()
├── app/app.config.server.ts     # + SITE_ORIGIN from PUBLIC_WEB_URL
├── server/search.ts(.spec)      # NEW: /sitemap.xml, /robots.txt, /app noindex header
└── server.ts                    # + mountSearch()
apps/web-e2e/src/
├── addresses.spec.ts            # NEW
├── language.spec.ts             # reload → reopen `/` (the address now keeps English)
└── dashboards.spec.ts           # signed-out landing is `/ro`
```

**Structure Decision**: the address rules are an app concern (routes, Express),
so they live in `apps/web`; the lib only gains `saved()` because `/` must read the
remembered language synchronously, before the first render.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|------------|--------------------------------------|
| `SITE_ORIGIN` token | canonical and `hreflang` must be absolute on the public origin on the server | the request URL inside Angular may carry `http:` behind the proxy; reading `process.env` in shared app code breaks the browser bundle |
| `/` rendered, not 302 | ST-17's remembered English must apply on `/` | a 302 to `/ro/` would pin a reopened `/` to Romanian (the server cannot read device storage) |
