# Tasks: Keep the account on screen behind the gate dialog

- [X] T001 [US1] Unit tests in `apps/web/src/app/dashboard/session.gate.spec.ts`: `shown()` keeps the given account while the gate promise is pending after a failed renewal, lets it go when it settles, at sign-out, and never while the session holds its own account (FR-001)
- [X] T002 [US1] Unit test in `apps/web/src/app/sign-in/sign-in-dialog.spec.ts`: `gate()` keeps the account shown for as long as its dialog is open (FR-001)
- [X] T003 [US1] Unit test in `apps/web/src/app/dashboard/frame.spec.ts`: with the account kept and `current` null, the frame shows the name and every menu item (FR-001)
- [X] T004 [US1] `Session.shown` and `Session.keepShownWhile()` in `apps/web/src/app/dashboard/session.ts`; `drop()` lets the kept account go (FR-001)
- [X] T005 [US1] `SignInDialog.gate()` keeps the account on screen while its dialog is open; the interceptor is unchanged (FR-001)
- [X] T006 [US1] `Frame` reads `session.shown()` for what it displays; its redirect effect keeps reading `session.current()` (FR-001)
