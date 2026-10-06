# Tasks: One reader for PUBLIC_WEB_URL

- [X] T001 [US1] Unit tests in `libs/domain/src/notifications/email-config.spec.ts`: a padded value reads as the bare address; unset, empty and malformed give no address without throwing (FR-001, FR-002)
- [X] T002 [US1] `webUrl()` in `libs/domain/src/notifications/email-config.ts` uses `publicWebUrl()` (FR-001, FR-002)
