# Feature Specification: Close the PR tester's two environment gaps: file storage and API calls

**Feature Branch**: `450-pr-tester-env-gaps`
**Created**: 2026-10-05
**Status**: Archived (2026-10-05)
**Level**: 1 (one-session)
**Notion story**: ST-450 — https://app.notion.com/p/3ef607bff0d281deb5fdc1c96d6d9d46
**Epic**: EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
**Overlaps**: ST-459 (storage down filed as debt, https://app.notion.com/p/3ef607bff0d281ecbb44fc5da02a7194) and ST-460 (affected tests from the Nx cache, https://app.notion.com/p/3ef607bff0d281f0a1c4ee4c31feb5af); this change resolves both.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - QA has file storage without Docker (Priority: P1)

A PR tester lap on a machine without Docker starts PostgreSQL and Redis as
private processes but no object store, so the api and worker readiness checks
report `storage` down and the review files the same medium debt on every
backend PR. After this change the lap starts a standalone MinIO on a free port
when the binary is installed, creates the bucket and tears it down with the
rest; and when no object store can be started, "storage down" is a note in the
review, never a finding.

**Independent Test**: build the local plan with and without a MinIO binary;
feed a 503 readiness answer whose only failed check is `storage` to the
readiness rule with no object store; it gives a note and no finding.

**Acceptance Scenarios**:

1. **Given** no Docker and a `minio` binary, **When** a lap boots its services, **Then** MinIO runs on the lap's own ports inside the run directory, the `motorfix` bucket exists before the apps start, and teardown stops it.
2. **Given** no object store, **When** api readiness fails only on `storage`, **Then** the review carries a note saying so and no finding.
3. **Given** an object store, **When** readiness fails on `storage`, **Then** it is a blocking finding as before.

### User Story 2 - QA calls the changed endpoints (Priority: P1)

The tester only called changed GET endpoints without path parameters, signed
out. After this change it calls every changed operation (GET, POST, PUT, PATCH,
DELETE, with or without path parameters) on a seeded private database, signed
in as a seeded account of the right role, and names each endpoint it could not
call with the reason.

**Independent Test**: against a fake API, a changed `POST /api/v1/notifications/{id}/read`
is called with the id taken from `GET /api/v1/notifications`, with the driver's
bearer token; a changed `POST /api/v1/admin/news` is called as admin with a
body built from its schema; a changed operation whose id cannot be found is
listed with that reason.

**Acceptance Scenarios**:

1. **Given** a PR that changes a POST endpoint, **When** the lap runs, **Then** the endpoint is called with a body built from its OpenAPI schema and its answer is in the review.
2. **Given** a secured endpoint under `/api/v1/admin/`, **When** it is called, **Then** the call carries an admin's access token from a seeded account.
3. **Given** an endpoint with a path parameter, **When** its parent collection lists an item, **Then** the parameter is that item's id; **When** it lists none, **Then** the endpoint is named in the review as not called, with the reason.
4. **Given** any changed endpoint answering 5xx, **Then** it is a high finding.

### User Story 3 - A lap always ends with a status (Priority: P1)

A lap killed by SIGTERM left no report, no `agent-review` status and a 982 MB
test worktree behind (PR #12). After this change a signal writes a failure
report before teardown, a lap with no report at all can be posted as a failure
with its reason, and the next lap removes what a killed lap left.

**Independent Test**: build the missing-report verdict and check its status is
failure with the reason; create a fake stale run directory whose pid is dead
and one whose pid is alive; the cleanup removes only the first, stopping its
services.

**Acceptance Scenarios**:

1. **Given** a lap receiving SIGTERM, **When** it stops, **Then** `report.json` holds a blocker finding naming the signal and the phase, and teardown still runs.
2. **Given** a lap that left no report, **When** `post.mjs --missing "<reason>"` runs, **Then** `agent-review` on the head is failure with that reason.
3. **Given** a run directory of a dead lap, **When** a new local lap starts, **Then** its services are stopped, its compose project removed, the directory deleted and `git worktree prune` run; a live lap's directory is left alone.

### User Story 4 - The sweep knows expected statuses and signed-in screens (Priority: P2)

From the Build brief's "Found on PR #24" and "Found on PR #31": a route that
must answer 404 was a blocker, and a dashboard route swept signed out reported
a 401 console error as high on every dashboard PR.

**Acceptance Scenarios**:

1. **Given** `--routes /de:404`, **When** the page answers 404, **Then** no load, HTTP or console finding is raised for that 404; **When** it answers 200, **Then** that is a load finding.
2. **Given** `--routes /app/driver@driver`, **When** the sweep opens it, **Then** the browser holds a real session of the seeded driver.
3. **Given** the PR QA workflow, **When** routes carry `@role` or `:status`, **Then** its input check accepts them.

### Edge Cases

- A PR from before the seed existed: no seed step, secured endpoints listed as not called (cannot sign in).
- An OpenAPI document missing at the base: every operation at the head counts as changed.
- A route marked with a role that is not seeded: the sweep's run is a load finding naming the role.
- A stale run whose pid was reused by another process: left alone (safe side).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Without Docker, when a `minio` binary is on the PATH, the local plan MUST start MinIO on the lap's own API and console ports with its data inside the run directory and the apps' storage credentials, wait for it to answer, create the `motorfix` bucket (an existing bucket is fine), and stop it at teardown; the lap then reports storage booted.
- **FR-002**: When the plan has no object store and readiness fails only on `storage`, the review MUST carry that as a note and MUST NOT raise a finding; with an object store, or with any other check failing, readiness failure stays a blocking finding.
- **FR-003**: The tester MUST call every operation (GET, POST, PUT, PATCH, DELETE) of `apps/api/openapi.json` at the PR head that is new or different from the base, including operations with path parameters.
- **FR-004**: After migrating, the tester MUST run the PR's seed; a secured operation MUST be called with the access token of a seeded account signed in through the API: the role named by a path segment (`admin`, `garage`, `mechanic`, `receptionist`, `driver`), otherwise the driver. An operation under `/api/v1/auth/` also gets that account's refresh cookie.
- **FR-005**: A path parameter MUST be taken from the first item of the parent collection's GET (its `id`, or the field named like the parameter); a request body MUST be built from the operation's JSON schema: every required field, from its `example`, `default`, first `enum` value, `format` or type, honouring `minLength`, `minimum` and `minItems`; a required query parameter likewise.
- **FR-006**: Operations whose path names a sign-out MUST be called last; an answer of 500 or more MUST be a high finding; every call MUST be listed in the notes with its answer; every changed operation that could not be called MUST be listed by method and path with the reason; the note "No changed GET endpoint without path parameters" MUST be gone.
- **FR-007**: On SIGINT, SIGTERM or SIGHUP the run MUST write `report.json` and `report.md` with a blocker finding naming the signal and the phase it was in, then tear down.
- **FR-008**: `post.mjs --missing "<reason>" --pr <n> --sha <sha>` MUST post a failure verdict whose summary and blocker finding carry the reason, so `agent-review` on the head is failure.
- **FR-009**: A local lap's run directory MUST carry its process id; before a local lap boots, every PR-tester run directory and compose project whose process is gone MUST have its PostgreSQL, Redis and MinIO stopped, its compose project removed with volumes, its directory deleted, and `git worktree prune` run. A run whose process is alive MUST be left alone.
- **FR-010**: A sweep route MAY be written `path[@role][:status]`; with a status, an answer of that status MUST NOT raise a load, HTTP or console finding for that page, and any other status MUST raise a load finding.
- **FR-011**: A route with `@role` MUST be opened with a real session of that role's seeded account: signed in through the API for each browser context, its refresh cookie set on the web origin.
- **FR-012**: The PR QA workflow's routes check MUST accept `@` and `:` in routes and still refuse anything else outside paths.
- **FR-013**: `--tests` MUST run the affected unit tests with `--skip-nx-cache`, so they never come from the Nx cache.
- **FR-014**: The pr-tester agent definition MUST describe the storage note, running a `--local` lap in the background, posting `--missing` when a lap left no report, the route syntax and the endpoint calls.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

- **SC-001**: A local lap without an object store raises no finding about storage.
- **SC-002**: Every changed operation in a PR is either called (its answer in the review) or named with the reason it was not.
- **SC-003**: No lap ends with neither a report nor an `agent-review` status, and no killed lap's run directory survives the next lap.
- **SC-004**: `npm run test:harness` green, with a test for each FR written before the code.

## Assumptions

- (autonomous default) MinIO comes from a binary on the PATH (`brew install minio`), never Docker; without the binary the lap boots as today and storage is the note of FR-002. The bucket is created through `@aws-sdk/client-s3`, already a dependency, so `mc` is not needed.
- (autonomous default) "Test data it creates" is the PR's own seed (`prisma db seed` in `libs/domain`, as CI's E2E job runs it) plus the parent-collection lookup; the tester creates no rows of its own beyond the calls themselves.
- (autonomous default) The seeded accounts and their test password are the seed's (`parola-de-test`, or `SEED_PASSWORD`): admin `admin@example.test`, driver `sofer@example.test`, garage `service@example.test`, mechanic `mecanic@example.test`, receptionist `receptie@example.test`.
- (autonomous default) A 4xx answer is not a finding: a generated body may be refused by validation, and the reviewer reads the answer in the notes.
- (autonomous default) Each sweep context signs in afresh: refresh tokens rotate, and a reused one closes its family. Successful sign-ins do not count against the attempt limit.
- (autonomous default) A stale run is recognised by the process id in its run directory name (`mf-prtest-<pr>-<pid>-…`) or in its worktree name (`mf-prtest-<pr>-<sha7>-<pid>`); a directory with neither is left alone.
- (autonomous default) The tree mode (PR QA workflow on a runner) needs no stale cleanup: the runner is fresh each time.
