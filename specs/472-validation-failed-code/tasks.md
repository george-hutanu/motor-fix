# Tasks: validation_failed is asserted through the real API app

- [X] T001 [US1] Integration spec `apps/api/src/validation-problem.integration.spec.ts`: signed-in 400 cases for audit-history and role switch assert `code: validation_failed` (FR-001, FR-002)
- [X] T002 [US1] Prove the cases catch a missing filter: run them once with `ProblemFilter` left out of `configureApp`, then restore (FR-001, FR-002)
