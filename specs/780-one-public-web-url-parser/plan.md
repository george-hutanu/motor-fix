# Implementation Plan: One reader for PUBLIC_WEB_URL

**Branch**: `780-one-public-web-url-parser` | **Spec**: [spec.md](./spec.md)

## Summary

`webUrl()` in `libs/domain/src/notifications/email-config.ts` calls `publicWebUrl(source)` from `@motor-fix/contracts/env`, drops the trailing slash from its `href`, and turns the reader's error into no address (FR-001, FR-002). The processor's `ready()` check from ST-539 stays the one place a missing address is reported.

## Technical Context

**Language/Version**: TypeScript · **Testing**: Jest — `email-config.spec.ts` (unit) · **Projects**: `domain` · **Constraints**: no new dependency, no schema, no contract change; `domain` already imports `@motor-fix/contracts`.

## Constitution Check

Principle I: removes a parser, adds none. Principle II: the padded-value test fails first. Principle V: the rule lives in one place. Pass.
