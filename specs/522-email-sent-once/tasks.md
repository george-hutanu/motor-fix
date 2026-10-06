# Tasks: A message the provider accepted is never sent twice

- [ ] T001 [US1] Integration tests in `libs/domain/src/notifications/sent-once.integration.spec.ts`: first sent-write fails (e-mail, SMS, WhatsApp), every sent-write fails, claim release fails — prove red (FR-001, FR-002, FR-003)
- [ ] T002 [US1] Retry the sent write 3 times and log on exhaustion in `notifications.processor.ts` `sent()` (FR-001, FR-002)
- [ ] T003 [US1] Catch and log a failed claim release in `send()` (FR-003)
