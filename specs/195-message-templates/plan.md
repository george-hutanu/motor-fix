# Implementation Plan: Message templates in Romanian and English

**Branch**: `195-message-templates` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/195-message-templates/spec.md`

## Summary

Replace the notifications module's hard-coded message table (`libs/domain/src/notifications/messages.ts`) with a small template system: one TypeScript template per notification type (plus the generic and grouped texts), each declaring its audience, the values it uses with their format, example values, and its texts per channel and language. One renderer turns a template, a language and params into the channel's shape (e-mail subject/text/HTML, bell text, push title/body/link, SMS text, WhatsApp name/slots), formatting prices and dates with the shared formatters of `libs/i18n/src/formats.ts`. A pure check function, run by a unit spec in CI, enforces the content rules. The worker renders the e-mail, sends the HTML part beside the text part through Brevo, and fails the row with `template_failed` when a template cannot render.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node v24.21.0 (local `node -v`); `libs/domain` compiles as CommonJS with bundler resolution (`libs/domain/tsconfig.json`, `tsconfig.base.json`), relative imports without extension (as `libs/domain/src/notifications/*.ts` do).

**Primary Dependencies**: NestJS 12.1.2, BullMQ 6.3.11 (`package.json`); the existing `Brevo` client (`libs/domain/src/notifications/brevo.ts`, plain `fetch`); the shared formatters `formatLeiRange`, `formatLei`, `formatDay`, `formatClock`, `formatNum` (`libs/i18n/src/formats.ts`). No new dependency.

**Storage**: PostgreSQL via Prisma, unchanged: `notification.params` (Json) is read, nothing new is written (`libs/domain/prisma/schema/notifications.prisma`).

**Testing**: Jest 30.5.2 with ts-jest 29.4.14 from the root preset (`jest.preset.cjs`, `libs/domain/jest.config.cts`); unit specs colocated; the processor integration spec against PostgreSQL, Redis and the recorded Brevo mock (`brevo-mock.testing.ts`).

**Target Platform**: the `worker` app (Node, webpack via `@nx/webpack`, `apps/worker/webpack.config.cjs`), which resolves `tsconfig.base.json` paths.

**Project Type**: Nx monorepo library (`libs/domain`) used by `apps/worker` and `apps/api`.

**Performance Goals**: rendering is string work per message; no target beyond the existing "sent within 60 seconds" of ST-194.

**Constraints**: Build brief rules (context.md › Decisions): Romanian and English; ș/ț with the comma below; no other person's phone or plate (DAY_SHEET exception); push 50/120, SMS 70; WhatsApp approved-template slots (ST-392 registers them); only NEWS has an unsubscribe link; templates are code, nothing stored.

**Scale/Scope**: 79 catalogue types exist (`catalogue.ts`); this story writes templates for TEST_MESSAGE, ACCOUNT_EMAIL (two purposes), the generic text and two grouped e-mails.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no MJML or template engine; one renderer, one check function, one layout. Push/SMS/WhatsApp shapes exist because the Build brief's scenarios 8–10 require their rules now; they are a few fields each, not a plug-in layer. `messages.ts` is deleted, not kept beside the new code.
- [x] **II. Test Discipline**: failing specs first: renderer, formats in templates, check (real templates + fixtures), processor integration (HTML part, `template_failed`). Playwright end-to-end not possible yet (no bell screen or inbox; spec Assumptions); recorded as a deviation.
- [x] **III. The Given Stack**: NestJS worker, PostgreSQL, Redis; nothing added.
- [x] **IV. One Repository, One Toolchain**: lives in `libs/domain`; one new `tsconfig.base.json` path `@motor-fix/i18n/formats` so the backend reuses the formatters without importing the Angular pipes of the i18n index (precedent: `@motor-fix/contracts/env`).
- [x] **V. Rules Live in One Place**: the formatters stay the single source of number/price/date formats for the screens and the messages; content rules live in one check.
- [x] **VI. PostgreSQL Is the Truth**: unchanged; a failed render is recorded on the row.
- [x] **Notion choices**: MJML/JSON (*proposed*) replaced by TS modules — Build brief › Rules and validation; push/SMS limits (*proposed*) adopted. No T1–T10 item touched.

## Project Structure

### Documentation (this feature)

```text
specs/195-message-templates/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/templates.md
└── tasks.md
```

### Source Code (repository root)

```text
tsconfig.base.json                                   # + "@motor-fix/i18n/formats" path
.env.example                                         # PUBLIC_WEB_URL now read by the worker too
libs/domain/src/notifications/
├── templates.ts                 (new)  template types, render(), TemplateError, bellText()
├── templates.spec.ts            (new)
├── template-check.ts            (new)  check(templates) → problems
├── template-check.spec.ts       (new)  real templates pass; one fixture per rule fails
├── email-layout.ts              (new)  HTML part: wordmark, amber button, footer
├── templates/                   (new)  one file per type
│   ├── registry.ts                     the registry
│   ├── test-message.ts
│   ├── account-email.ts
│   ├── quote-received.ts               grouped e-mail
│   └── generic.ts                      generic + grouped generic
├── messages.ts                  (deleted, with messages*.spec.ts)
├── brevo.ts                     sends htmlContent
├── email-config.ts              webUrl from PUBLIC_WEB_URL
└── notifications.processor.ts   renders; template_failed
```

**Structure Decision**: everything stays inside the existing notifications module of `libs/domain`; the templates folder gives "one file per type" from the Build brief.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Push, SMS and WhatsApp shapes with no sender yet | Build brief scenarios 8–10 and the check rules must hold before ST-196/ST-392 add texts | Leaving them out makes those stories invent the shapes and the rules separately |
| `bellText()` with no production caller yet | FR-011: the generic bell text; ST-199's bell reads it | Writing it in ST-199 would split the template rules across two stories |
