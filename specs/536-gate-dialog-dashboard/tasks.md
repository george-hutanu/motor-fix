# Tasks: Keep the account on screen behind the gate dialog

- [ ] T001 [US1] Unit tests in `apps/web/src/app/dashboard/session.gate.spec.ts`: `shown()` keeps the given account while the gate promise is pending after a failed renewal, lets it go when it settles, at sign-out, and never while the session holds its own account (FR-001)
- [ ] T002 [US1] Unit test in `apps/web/src/app/auth.interceptor.gate.spec.ts` (or the existing gate spec): a refused call whose renewal fails keeps the account shown until the gate resolves (FR-001)
- [ ] T003 [US1] Unit test in `apps/web/src/app/dashboard/frame.gate.spec.ts`: with the account kept and `current` null, the frame shows the name and every menu item (FR-001)
- [ ] T004 [US1] `Session.shown` and `Session.keepShownWhile()` in `apps/web/src/app/dashboard/session.ts`; `drop()` lets the kept account go (FR-001)
- [ ] T005 [US1] `authInterceptor` keeps the account on screen while `dialog.gate()` is open (FR-001)
- [ ] T006 [US1] `Frame` reads `session.shown()` for what it displays; its redirect effect keeps reading `session.current()` (FR-001)
