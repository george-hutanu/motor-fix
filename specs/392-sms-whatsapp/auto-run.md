# Auto run — 392-sms-whatsapp

**Description**: ST-392 Send SMS and WhatsApp through Brevo with the monthly SMS cap (https://app.notion.com/p/3ee607bff0d281e088cadac726138cc5), EP-1 Foundations.
**Start commit**: e69f6c06f917ca8c315c3dd1026c168c61bc98e2 (origin/main) · branch `392-sms-whatsapp` · PR #73

## 0. Size
- Level 2 (feature): 8 points, one library, a migration, worker wiring; no screens.

## 1. Constitution
- Read `.specify/memory/constitution.md`; Principle I carried into every choice (no reset job, no channel interface, no Redis cache).

## Preflight
- `npm run typecheck && npm run lint && npm run test:unit` green in a heavy slot; the start commit's pre-commit (`typecheck && lint && test`) green.

## 2. Specify / 3. Context / 4. Clarify
- Story page and build-timeline row read directly from Notion (blockers ST-194, ST-195, ST-197 all Merged). Clarifications and autonomous defaults in `spec.md` › Clarifications and Assumptions:
  - Above the cap → WhatsApp (owner decision 2026-10-03).
  - A failed SMS gives its count back; the count is taken before the call (brief *(proposed)*).
  - The shipped 400 `channel_not_allowed` stays for a type that does not allow SMS; the new role refusal is 422 `channel_not_allowed` (brief code *(proposed)*, repo lower-case style).
  - No reset job and no `sms-counter` queue: the count is a month-keyed PostgreSQL row (the brief makes the queue conditional on a Redis cache).
  - Staff WhatsApp is off until the person turns it on.
  - "Push, else e-mail" is e-mail until ST-196 adds push.
  - The Playwright check becomes an integration test against the Brevo mock (no reminder job, no screen); the proof uses DUE_ITP's own SMS and WhatsApp texts.
  - Brevo's WhatsApp call carries the template id and `params`; checked on staging when the first template is approved.

## 5–8. Plan, checklist, tasks, analyze
- `plan.md`, `tasks.md` written; no checklist items left open; artifacts consistent (FR → test table in `tasks.md`).

## 9. Tests (red first)
- New and changed specs before code: `npx jest sms-counter phone-config routing brevo preferences` → 5 suites failed (3 do not compile, 2 tests failing), 20 passed.

## 10. Implement
- T001–T009 done; `npx jest libs/domain/src/notifications` → 23 suites, 652 tests passed (integration included, local PostgreSQL and Redis).
