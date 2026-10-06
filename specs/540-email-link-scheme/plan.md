# Implementation Plan: E-mail links carry a safe scheme

**Branch**: `540-email-link-scheme` | **Date**: 2026-10-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/540-email-link-scheme/spec.md`

## Summary

`render()`'s email case (`libs/domain/src/notifications/templates.ts:168-189`) takes the button's and the stop link's `href` from a `link` value that `format()` only stringifies, and `emailHtml` (`email-layout.ts:26,40`) escapes it without checking its scheme. The change: in that email case, pass each href through one local check before `emailHtml` is called — parse it with `new URL(href)`, accept `https:`, or `http:` when the parsed `hostname` is exactly `localhost` or `127.0.0.1`, and otherwise call the existing `fail(...)` with a reason naming the link (`button link` or `stop link`), so the refusal is the `TemplateError` the worker (`notifications.processor.ts:208-212`, `template_failed`) and the self-check (`template-check.ts:59`) already handle. A value that does not parse (`not a url`, `/relative/path`, `motorfix.ro/x`, an empty string) is refused by the same path, as `new URL` throws. An absent stop link (`mail.stop` undefined) is not checked. Colocated specs in `templates.spec.ts` cover scenarios 1–5 for both links; nothing else changes.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:78`), Node >= 24 (`package.json:84-86`), target `es2023`, lib `es2024` (`tsconfig.base.json:8,38`); `URL` is the global WHATWG class, no import.

**Primary Dependencies**: none new. The notifications library is plain TypeScript inside `libs/domain` (NestJS 12.1.2, `package.json:19`, is not touched by this change).

**Storage**: N/A — no schema, no migration, no Redis.

**Testing**: Jest 30.5.2 (`package.json:66`), `libs/domain/jest.config.cts` (ts-jest, `testEnvironment: node`, preset `jest.preset.cjs`), specs matched by `libs/domain/tsconfig.spec.json` (`src/**/*.spec.ts`); run with `scripts/heavy.sh npx nx test domain` (affected run in the pre-commit hook). Biome 2.5.15 (`package.json:42`) for lint.

**Target Platform**: the `worker` app's render path and the `api`'s template self-check, both Node 24 servers; no browser code.

**Project Type**: library change in the Nx monorepo (Nx 23.2.1, `package.json:72`), lib `domain`.

**Performance Goals**: N/A — one `new URL` parse per e-mail link, two per render at most.

**Constraints**: `http:` must stay accepted on `localhost` / `127.0.0.1` because CI renders with `PUBLIC_WEB_URL: http://localhost:4200` (`.github/workflows/ci.yml:158`); the self-check renders every template with `https://motorfix.example` (`template-check.ts:14`) and must keep passing. The allowed set is fixed in code (FR-004, spec Assumptions). No contract, web or catalogue change.

**Scale/Scope**: two source lines' worth of behaviour in one function; one new helper of about ten lines in `templates.ts`; one spec file extended.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one private function in `templates.ts` (`new URL`, scheme and host test, `fail`); no new module, type, error class, dependency or configuration. The check is not placed in `emailHtml` because the error must carry template and channel, which only `render()`'s `fail` knows (spec Clarifications, Q2).
- [x] **II. Test Discipline**: `/speckit-tests` writes the scenario 3–5 specs red first in `libs/domain/src/notifications/templates.spec.ts` (colocated); scenarios 1–2 are regression guards there. No PostgreSQL, Redis or Playwright is involved: the processor and self-check paths are already covered by their own specs and are not changed.
- [x] **III. The Given Stack**: TypeScript in the domain library; nothing else.
- [x] **IV. One Repository, One Toolchain**: lib `domain`, root Jest and Biome.
- [x] **V. Rules Live in One Place**: the rule lives in `render()`, the one place every channel's e-mail is produced (worker, self-check); no API shape changes.
- [x] **VI. PostgreSQL Is the Truth**: no state change; the failed rows are written by the processor as today.
- [x] **Notion choices**: none relied on; `context.md` lists no open decision and no To-decide item is touched.

Post-design re-check: unchanged, no violation.

## Project Structure

### Documentation (this feature)

```text
specs/540-email-link-scheme/
├── plan.md              # This file
├── spec.md
├── context.md
├── design.md            # no screens
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (not created here)
```

`research.md`, `data-model.md`, `contracts/` and `quickstart.md` are not written: there is no NEEDS CLARIFICATION left (the spec's Clarifications fixed the parsing rule and the error path), no entity, no interface, and the validation steps fit in the section below.

### Source Code (repository root)

```text
libs/domain/src/notifications/
├── templates.ts         # render(): email case gains the href check through `fail` (modified)
├── templates.spec.ts    # scenarios 1–5 for the button and the stop link (modified)
├── email-layout.ts      # unchanged: still escapes an accepted href only
├── template-check.ts    # unchanged: already reports a TemplateError
└── notifications.processor.ts  # unchanged: already fails rows with template_failed
```

**Structure Decision**: all work stays in the existing `libs/domain/src/notifications/` module; no new file.

## Design

- Helper (private to `templates.ts`): `safeHref(href: string, which: 'button' | 'stop', fail)` — `let url: URL; try { url = new URL(href) } catch { fail(`${which} link is not a URL`) }`; accept when `url.protocol === 'https:'`, or `url.protocol === 'http:'` and `url.hostname` is `localhost` or `127.0.0.1`; else `fail(`${which} link must be https (http only on localhost)`)`. `URL` lower-cases the scheme and the host, so `HTTPS://` and `http://LOCALHOST/x` pass; `[::1]`, `localhost.evil.com`, `javascript:`, `data:` and a relative path do not (spec Edge Cases).
- The email case calls it on `value(mail.button.link)` and, when `mail.stop` is set, on `value(mail.stop.link)`, before `emailHtml`; push, SMS, WhatsApp and bell cases are untouched (FR-004).
- A failing spec for scenario 2 (`http://localhost:4200/x`) is in the regression set, so the CI URL stays covered.

## Validation

1. `scripts/heavy.sh npx nx test domain` (or Jest on `templates.spec.ts` alone through `post-edit-check.sh`): new scenario 3–5 specs red before the change, green after; scenarios 1–2 and the existing `template-check.spec.ts` green throughout (SC-001, SC-002).
2. `npm run typecheck` and `npm run lint` green (SC-003).

## Complexity Tracking

None — no violation to justify.
