# Tasks: E-mail links carry a safe scheme

**Input**: `specs/540-email-link-scheme/` (spec.md, plan.md). No research, data model or contracts.
**Tests**: required (Constitution II, red first). Format: `[ID] [P?] [Story] Description`.

## Phase 1: Setup / Foundational

None: the work is one function and one spec file in the existing `libs/domain/src/notifications/` module; no new file, dependency or configuration.

## Phase 2: User Story 1 - An e-mail never carries a link of an unsafe scheme (P1) MVP

**Goal**: `render()`'s email case refuses a button or stop link that is not `https:` (or `http:` on `localhost` / `127.0.0.1`) with a `TemplateError`.

**Independent Test**: render the e-mail channel with each link value of scenarios 1-5; it renders or refuses as the spec says.

### Tests (write first, scenarios 3-5 must fail before T003)

- [X] T001 [US1] Extend `libs/domain/src/notifications/templates.spec.ts` with a table of link values run against both the button link and the stop link (FR-001, FR-003): accepted (scenarios 1-2, regression guards) `https://motorfix.test/x?t=a&b=<x>` (href still escaped), `HTTPS://motorfix.ro`, `http://localhost:4200/x`, `http://127.0.0.1/x`, `http://LOCALHOST/x`; refused (scenarios 3-4, red first) `http://motorfix.ro/x`, `javascript:alert(1)`, `data:text/html,x`, `/relative/path`, `motorfix.ro/x`, `not a url`, empty string, `http://localhost.evil.com/x`, `http://127.0.0.1.evil.com/x`, `http://[::1]/x`.
- [X] T002 [US1] In the same spec, assert (scenario 5, FR-002) a refused stop link with a valid button link throws `TemplateError` whose message names `stop link` (and `button link` for the button), and that an absent stop link still renders.

### Implementation

- [X] T003 [US1] In `libs/domain/src/notifications/templates.ts` add the private `safeHref(href, which, fail)` helper per plan.md Design (`new URL(href)` in try/catch; accept `https:`, or `http:` with `hostname` exactly `localhost` or `127.0.0.1`; otherwise `fail` with a reason naming the link) and call it in `render()`'s email case on `value(mail.button.link)` and, only when `mail.stop` is set, on `value(mail.stop.link)`, before `emailHtml` (FR-001 to FR-004). Push, SMS, WhatsApp and bell cases stay untouched.

**Checkpoint**: T001-T002 green; existing `templates.spec.ts`, `templates.adversary.spec.ts` and `template-check.spec.ts` still green (SC-002).

## Phase 3: Validation

- [X] T004 Run `scripts/heavy.sh npx nx test domain`, `npm run typecheck` and `npm run lint`; all green (SC-001, SC-003).

## Dependencies and order

T001, T002 (same file, sequential) -> T003 -> T004. No parallel tasks: one source file and one spec file. MVP is the whole feature.
