# Implementation Plan: A distinct name for the confirmation's button, and an error line that holds until the answer

**Branch**: `496-task-done-close-name` | **Spec**: [spec.md](./spec.md)

## Summary

`TaskDone` in `libs/overlays/src/form-parts.ts` reads the new `shell.form.done` key ("Gata" / "Done") in place of `shell.form.close`, which has no other reader and is removed (FR-001). In `libs/overlays/src/form.ts`, `submit()` stops clearing `problem` at the press; it clears it only on the invalid branch, `succeed()` clears it, and `fail()` already replaces it (FR-002).

## Technical Context

**Language/Version**: TypeScript, Angular signals · **Testing**: Jest — `libs/overlays/src/form.spec.ts`, `apps/web/src/app/sign-in/sign-in.spec.ts` (unit), Playwright `apps/web-e2e/src/task-form.spec.ts` · **Projects**: `overlays`, `i18n`, `web` (a test only), `web-e2e` (a locator only) · **Constraints**: no new dependency, no contract or schema change.

## Constitution Check

Principle I: one key renamed, one line moved; nothing added. Principle II: the two form.spec.ts tests fail first. Principle V: the rule stays in the shared helper, so every task gets it. Pass.
