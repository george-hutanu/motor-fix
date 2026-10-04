# Tasks: Message templates in Romanian and English

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/templates.md, context.md, design.md
**Tests**: required (constitution II, Build brief "Tests"); written first by `/speckit-tests`.

## Phase 1: Setup

- [X] T001 `tsconfig.base.json`: path `@motor-fix/i18n/formats` → `./libs/i18n/src/formats.ts` (R2, FR-003)

## Phase 2: Foundational

- [X] T002 `libs/domain/src/notifications/templates.ts` (new): `Template` and channel text types, `TemplateError`, `render(name, channel, language, params)` (placeholders, formats `text`/`link`/`count`/`num`/`lei`/`when`, Romanian "de" counts, unknown language → ro, GENERIC for a missing e-mail/bell template, push/SMS limits, WhatsApp name and slots), `templateName(kind, params)`, `bellText(kind, language, params)` (FR-001, FR-002, FR-003, FR-006, FR-007, FR-008, FR-011)
- [X] T003 [P] `libs/domain/src/notifications/email-layout.ts` (new): the HTML part — wordmark linking to `app`, lines, one amber button, footer with the template's reason; values escaped (FR-004)
- [X] T004 [P] `libs/domain/src/notifications/template-check.ts` (new): `checkTemplates(registry)` — both languages per channel, declared values only, known type, `plate`/`phone` rule by audience (DAY_SHEET exception), no ş/ţ cedilla, example values render within the push/SMS limits, WhatsApp name and slots (FR-009)

## Phase 3: User Story 1 + 2 — texts in both languages, complete e-mails (P1)

Independent test: render the real templates in both languages and send the test message through the recorded Brevo mock.

- [X] T005 [US1] `libs/domain/src/notifications/templates/` (new): `test-message.ts`, `account-email.ts` (email_check, password_reset), `quote-received.ts` (grouped), `generic.ts` (GENERIC, GENERIC.grouped), `index.ts` (registry) — ro and en e-mail and bell texts, per-template footer reason (FR-010, FR-004)
- [X] T006 [US2] `libs/domain/src/notifications/brevo.ts`: `send` carries `html` as `htmlContent` (FR-005)
- [X] T007 [US2] `libs/domain/src/notifications/email-config.ts`: `webUrl` from `PUBLIC_WEB_URL`; `.env.example` notes the worker reads it (R8)
- [X] T008 [US1] `libs/domain/src/notifications/notifications.processor.ts`: render the e-mail with `{ app: webUrl, ...params }` in the account's language (single and grouped); delete `messages.ts`, `messages.spec.ts`, `messages.adversary.spec.ts` (FR-002, FR-005, FR-010)

## Phase 4: User Story 3 — the CI check (P1)

- [X] T009 [US3] `libs/domain/src/notifications/template-check.spec.ts` runs the check over the registry in the unit suite (FR-009)

## Phase 5: User Story 4 — a message that cannot be written (P2)

- [X] T010 [US4] `notifications.processor.ts`: a `TemplateError` fails the row(s) `template_failed` without the fallback hook and logs type, channel and reason (FR-011)

## Phase 6: Polish

- [ ] T011 Mark tasks, update `auto-run.md`; `npm run typecheck`, `npm run lint`, the domain Jest project

## Dependencies

T001 → T002 → T003, T004 (parallel) → T005 → T006, T007 (parallel) → T008 → T009, T010 → T011.

## Tests (written first by `/speckit-tests`; FR → test)

| FR | Test file |
|----|-----------|
| FR-001, FR-002, FR-003, FR-006, FR-007, FR-008, FR-011 | `libs/domain/src/notifications/templates.spec.ts` |
| FR-004, FR-010 | `libs/domain/src/notifications/templates.spec.ts` (real templates, both languages) |
| FR-009 | `libs/domain/src/notifications/template-check.spec.ts` |
| FR-005 | `libs/domain/src/notifications/brevo.spec.ts` |
| FR-002, FR-005, FR-010, FR-011 | `libs/domain/src/notifications/notifications.processor.integration.spec.ts` |
