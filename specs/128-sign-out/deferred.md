# Deferred — 128-sign-out

- (code-reviewer, LOW) `libs/domain/src/notifications/notifications.service.ts:350`: `announce()` writes the live fan-out message by hand and declares its own publisher type; use `publishLive` and `LivePublisher` from `libs/domain/src/events/live.hub.ts`, so the message shape lives in one place. Pre-existing; outside this story's change.
