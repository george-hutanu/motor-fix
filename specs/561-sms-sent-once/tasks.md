# Tasks: An SMS that may have gone is never sent twice

- [X] T001 [US1] Integration tests in `phone.processor.integration.spec.ts`: mark set before the call, a marked row is not sent again nor counted and falls back, a hanging Brevo keeps the count and falls back without a retry, a 503 clears the mark — prove red (FR-001..FR-004)
- [X] T002 [US1] `sending_at` column and migration (FR-001)
- [X] T003 [US1] Mark, skip and settle in `notifications.processor.ts` `sendSms()` (FR-001..FR-004)
