# Feature Specification: validation_failed is asserted through the real API app

**Feature Branch**: `472-validation-failed-code`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-472 (from ST-391): "the 400 cases assert only the status in a test app without ProblemFilter, so code: validation_failed is untested" — https://app.notion.com/3ef607bff0d281468c87db57d36586a4. ST-548 (from ST-394): the same gap in `role-switch.api.integration.spec.ts` — https://app.notion.com/3ef607bff0d2819e9392c582f5aa9205

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A malformed request to a signed-in route answers validation_failed (Priority: P1)

The domain specs run their routes in a test app without `ProblemFilter` (it lives in `apps/api`, which `libs/domain` cannot import), so their 400 cases check only the status. One spec in `apps/api` boots `AppModule` with `configureApp`, signs in, and checks the problem body for both routes.

**Acceptance Scenarios**:

1. **Given** a signed-in garage account, **When** it calls `GET /api/v1/audit-history` with an unknown parameter, **Then** the answer is 400 with `code: validation_failed`.
2. **Given** a signed-in account with the garage and driver roles, **When** it posts `POST /api/v1/auth/roles/switch` with a role that is not one of the five, **Then** the answer is 400 with `code: validation_failed`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A class-validator failure on `GET /api/v1/audit-history` from a signed-in caller MUST answer 400 with `code: validation_failed` through the production app setup.
- **FR-002**: A class-validator failure on `POST /api/v1/auth/roles/switch` from a signed-in caller MUST answer 400 with `code: validation_failed` through the production app setup.

## Clarifications

### Session 2026-10-07

- Q: Mount `ProblemFilter` in the domain test apps instead? → A: No: the filter belongs to `apps/api`, and the story asks for a case through `AppModule` + `configureApp`, which also covers the pipe and guard order. (autonomous)
- Q: Tests first, when the behaviour already exists? → A: The change is tests only; they are proved to catch a regression by running them against a copy of `configureApp` without the filter. (autonomous)

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both cases pass through `AppModule` + `configureApp`, and both fail when the filter is not registered.
