# Feature Specification: Audit history specs without restatements

**Feature Branch**: `473-audit-history-spec-dedup`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-473 (tech debt from ST-391, PR #32): "The adversary spec `libs/domain/src/audit/audit-history.adversary.integration.spec.ts` restates several cases already in `audit-history.service.integration.spec.ts` (7-day default start, no entry written by reading, foreign cursor refused, nested key masking, system actor, cursor of the 20th entry) and re-declares the HTTP helpers of `audit-history.api.integration.spec.ts` (Nest app bootstrap with the API's ValidationPipe, account, bearer, get). Delete the restated cases from the adversary spec and share the helpers in one `libs/domain/src/audit/audit-history.testing.ts` used by both HTTP specs. Test-only refactor: no product behaviour, contract or route changes; every case that is not a restatement stays; the suites stay green." — https://app.notion.com/p/3ef607bff0d2811689dcd361b0febfc8

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The audit history suites say each thing once (Priority: P1)

A maintainer changing the audit history (`GET /audit-history`) runs its three integration suites and finds every behaviour asserted in one place: the service spec holds the rules, the API spec the HTTP edge, the adversary spec only what neither of them states. A rule that changes is fixed in one test, not in two that disagree, and the HTTP helpers (app bootstrap with the API's validation settings, an account, a bearer token, a call) are declared once and read the same in both HTTP specs.

**Acceptance Scenarios**:

1. **Given** the six cases the ticket names (7-day default start, no entry written by reading, foreign cursor refused, nested key masking, system actor, cursor of the 20th entry), **When** the adversary spec is read, **Then** none of them is there, and each is still asserted by the service spec.
2. **Given** the API spec and the adversary spec, **When** their helpers are read, **Then** the app bootstrap, `account`, `bearer` and `get` live in `libs/domain/src/audit/audit-history.testing.ts` and both specs import them; neither spec declares its own copy.
3. **Given** the three audit history suites before and after the change, **When** both are run, **Then** every case that is not one of the six restatements is still present under its name, and all three pass.
4. **Given** the change, **When** the product code is diffed, **Then** nothing outside test files and the new helper module changed: no behaviour, contract or route.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The adversary spec MUST NOT restate a case the service spec already asserts: the six cases the ticket names are removed from it.
- **FR-002**: The HTTP test helpers (Nest app bootstrap with the API's `ValidationPipe` options, `account`, `bearer`, `get`) MUST be declared once, in `libs/domain/src/audit/audit-history.testing.ts`.
- **FR-003**: Both HTTP specs (`audit-history.api.integration.spec.ts` and `audit-history.adversary.integration.spec.ts`) MUST take those helpers from that module and declare none of them themselves.
- **FR-004**: Every assertion that is not a restatement MUST remain: the non-restated cases of the adversary spec keep their names and assertions, and a distinct assertion inside one of the six (one the service spec does not make) is kept by moving it into the service case rather than deleted.
- **FR-005**: The change MUST be test-only: no file under `libs/domain/src/audit/` other than `*.spec.ts` and the new `*.testing.ts` changes, and the three audit history suites pass after it.

## Clarifications

### Session 2026-10-07

- Q: The two `get` helpers differ (the API spec's takes a query object; the adversary's also takes a raw query string for malformed input). Which does the shared one keep? → A: The union: a query object or a raw string, so the adversary's malformed-input cases keep their calls unchanged. (autonomous default)
- Q: Does the shared module own the app and database lifecycle (`beforeAll`/`afterAll`/`beforeEach` truncate) or only the functions? → A: It owns the lifecycle too, as the two copies are identical; each HTTP spec registers it with one call, as `serial-db.testing.ts` already does for the database. (autonomous default)
- Q: What if one of the six named cases asserts something the service spec does not (e.g. the admin also writing no entry, masking inside nested arrays)? → A: The case is still removed from the adversary spec, and that one assertion joins the matching service case (FR-004); coverage of distinct behaviours does not shrink. (autonomous default)

## Assumptions

- Restatement is judged by behaviour asserted, not by wording: the six named cases map to the service spec's `reads the last 7 days when no start is given`, `writes no entry`, `refuses a cursor outside the caller's scope`, `masks a key inside an object even when the field is not sensitive`, `gives empty optional fields as null` and `pages newest first, 20 at a time, with the total`. (autonomous default)
- The adversary spec's own fixtures (`garage`, `owner`, `admin`, `entry`, `minutesAgo`, `ids`) stay in it: the ticket shares only the four HTTP helpers the API spec also declares, and the API spec builds its world differently. (autonomous default)
- `audit.adversary.integration.spec.ts` (the write-side audit) is out of scope; the ticket names the history specs only. (autonomous default)

## Spec Delta

### Capability: `audit`

- **Adds**: none
- **Modifies**: none
- **Removes**: none

(Test-only refactor; the capability's behaviour is unchanged.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The adversary spec holds zero of the six named cases; the service spec still holds each of their behaviours.
- **SC-002**: `account`, `bearer`, `get` and the app bootstrap each appear once under `libs/domain/src/audit/`, in `audit-history.testing.ts`, and both HTTP specs import from it.
- **SC-003**: The count of adversary cases drops by exactly six; no other case name disappears from any of the three suites.
- **SC-004**: The three audit history integration suites pass, and the diff touches no product file.
