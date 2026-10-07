# Tasks: A distinct name for the confirmation's button, and an error line that holds until the answer

- [X] T001 [US1] Unit test in `libs/overlays/src/form.spec.ts`: the confirmation's button reads `shell.form.done` and differs from the overlay's close name; end-to-end `apps/web-e2e/src/task-form.spec.ts` finds it by "Gata" (FR-001)
- [X] T002 [US2] Unit tests in `libs/overlays/src/form.spec.ts`: after a failure, a retry keeps `errors()` while sending, success clears it, an invalid press clears it; `apps/web/src/app/sign-in/sign-in.spec.ts` "clears the message at the next try" becomes "keeps the message while the next try is sending" (FR-002)
- [X] T003 [US1] `shell.form.done` in `libs/i18n/src/shell/{ro,en}.json` ("Gata" / "Done"); `TaskDone` in `libs/overlays/src/form-parts.ts` uses it (FR-001)
- [X] T004 [US2] `submit()` in `libs/overlays/src/form.ts` clears the problem on an invalid press or on success, not at the press (FR-002)
