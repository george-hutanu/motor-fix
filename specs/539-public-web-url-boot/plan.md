# Implementation Plan: A bad PUBLIC_WEB_URL is named at start

**Branch**: `539-public-web-url-boot` | **Spec**: [spec.md](./spec.md)

## Summary

`NotificationsProcessor.ready()` returns false with an error log when e-mail sending is on and `config.webUrl` is unset (`emailConfig` already turns a non-URL into unset) (FR-001, FR-002). A new `publicWebUrl(source)` in `libs/contracts/src/env.ts` parses the variable or throws a named error; `apps/web/src/server.ts` and `app.config.server.ts` use it (FR-003).

## Technical Context

**Language/Version**: TypeScript · **Testing**: Jest — `env.spec.ts` (unit), `notifications.processor.integration.spec.ts` (worker start) · **Projects**: `contracts`, `domain`, `web` · **Constraints**: no new dependency, no schema change.

## Constitution Check

Principle I: one condition in an existing check, one small reader. Tests first. Pass.
