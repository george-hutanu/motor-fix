# Tasks: The mark-sent write is retried without a delay

- [X] T001 [US1] Integration tests: e-mail mark-sent tried 3 times back to back in `libs/domain/src/notifications/send-claim.adversary.integration.spec.ts` (FR-001); push failed first write recorded later and not sent again in `libs/domain/src/notifications/push.processor.integration.spec.ts` (FR-002)
- [X] T002 [US1] Drop the wait between tries in `sent()` in `libs/domain/src/notifications/notifications.processor.ts` (FR-001)
