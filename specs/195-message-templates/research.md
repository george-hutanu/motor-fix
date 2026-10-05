# Research: Message templates in Romanian and English

## R1 — Template format: TypeScript modules, not MJML/JSON
- **Decision**: one TS module per type under `libs/domain/src/notifications/templates/`, typed by a `Template` interface; e-mail HTML from one hand-written layout.
- **Rationale**: Principle I (no new dependency; MJML pulls a large tree for two e-mails); the check reads plain objects; no file loading or asset copying in the webpack worker build; types catch most mistakes before the check.
- **Alternatives**: MJML + JSON (Build brief, *proposed*) — rejected for the dependency and the runtime file reading; Handlebars — same.
- **Evidence**: `package.json` has no template engine; `apps/worker/webpack.config.cjs` bundles TS only.

## R2 — Formats reuse the shared formatters
- **Decision**: import `formatLeiRange`, `formatLei`, `formatDay`, `formatClock`, `formatNum` through a new path `@motor-fix/i18n/formats` → `libs/i18n/src/formats.ts`.
- **Rationale**: one source of formats for screens and messages (Principle V); `formats.ts` imports only `./languages` (pure TS), while the i18n index exports Angular pipes the worker must not load.
- **Evidence**: `libs/i18n/src/formats.ts:1`; `tsconfig.base.json` path `@motor-fix/contracts/env` sets the precedent. `new Intl.NumberFormat('ro-RO').format(1250)` gives "1.250" and `en-GB` "1,250" on Node 24 (checked locally); `formatDay` writes "3 nov. 2026" / "3 Nov 2026" and `formatClock` "14:30" in Europe/Bucharest.

## R3 — The build-time check is a unit spec
- **Decision**: `checkTemplates(templates)` returns problem strings; `template-check.spec.ts` asserts the registry gives none and each fixture gives its one problem.
- **Rationale**: CI's Unit tests job runs every unit spec on each PR, so a failing check fails the build; same shape as `libs/i18n/src/check.ts`.
- **Evidence**: `.github/workflows/ci.yml` Unit tests job; `package.json` `test:unit`.

## R4 — Placeholders
- **Decision**: `{name}` in a text; each template declares `values: { name: format }` with formats `text`, `link`, `count`, `num`, `lei` (a number, or `[from, to]` for a range), `when` (day and clock, "3 nov. 2026, 14:30"). A placeholder not declared, or a value `undefined`/`null` at render, is an error. Text values are HTML-escaped in the HTML part only.
- **Rationale**: the declaration is what lets the check find `plate`/`phone` and undeclared names without parsing intent.

## R5 — Romanian "de" plural for counts
- **Decision**: `count` renders `n` in English, and `n de` in Romanian when `n % 100` is 0 (and n > 0) or ≥ 20.
- **Evidence**: Romanian grammar (numerals from 20 take "de": "20 de oferte", "101 oferte", "120 de oferte"); spec Clarifications.

## R6 — Lengths
- **Decision**: push title ≤ 50 and body ≤ 120, SMS ≤ 70 characters (counted as JS string length; Romanian diacritics force UCS-2, whose single-SMS limit is 70). Checked with example values by the check and again at render.

## R7 — HTML part through Brevo
- **Decision**: `Brevo.send` adds `htmlContent` beside `textContent`.
- **Evidence**: Brevo `POST /v3/smtp/email` accepts `htmlContent` and `textContent` together (used by `brevo.ts:39` for `textContent`; Brevo API reference, transactional e-mail).

## R8 — The app link for the test message
- **Decision**: the worker reads `PUBLIC_WEB_URL` into `EmailConfig.webUrl`; the renderer offers it as the value `app`, which the test message's button and every layout's wordmark use. Unset → `app` missing → the test message fails `template_failed` (visible), never a broken link.
- **Rationale**: the variable already exists for the web app (`.env.example:12`); the owner must set it on the worker in Railway (recorded for the PR).
