# Deferred findings — 198-staff-notification-preferences

- [ ] `NotificationsService.notify` reads a recipient's garage membership (two counts) and their preference rows one recipient at a time, 2N round trips for N recipients; read every recipient's membership and rows in one query each. Source: code-reviewer, LOW. `libs/domain/src/notifications/notifications.service.ts` (`staffGarage`, `muted`). — Notion: PENDING
- [ ] A staff choice for a garage on a type that is a driver's only answers 400 `garage_not_allowed` with a message about the garage, where 422 `type_not_in_list` names the real cause. Source: spec-reviewer, LOW. `libs/domain/src/notifications/preferences.service.ts` (`checkGarages`). — Notion: PENDING
