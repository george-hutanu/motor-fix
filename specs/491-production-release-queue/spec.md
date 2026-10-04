# Feature Specification: Production deploys queue instead of cancelling, with no approval

**Feature Branch**: `fix-release-production-queue`
**Created**: 2026-10-04
**Status**: Draft
**Level**: 1 (one-session)
**Notion story**: none. A follow-up from the QA run of PR #47; no story owns it.
**Epic**: EP-1 Foundations

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A running production deploy is never cancelled (Priority: P1)

The owner decided that production needs no manual approval: a merge to `main`
deploys staging, then production, once CI and staging pass (PR #47). With no
approval to wait at, the `production` job's `cancel-in-progress: true` means
two quick merges cancel a production deploy that is already pointing services
at new images, and the deploy script never restores them. Production must
queue behind the running deploy instead, as staging already does.

**Independent Test**: read `release.yml` and check that the `production` job's
concurrency group does not cancel in progress.

**Acceptance Scenarios**:

1. **Given** a production deploy running for commit A, **When** commit B passes staging, **Then** B's production job waits for A's to finish and A is not cancelled.
2. **Given** A running and B waiting, **When** commit C passes staging, **Then** C replaces B as the one waiting job (GitHub keeps one pending run per group), so the latest proven commit is the next to deploy.

### User Story 2 - A cancelled deploy restores the previous images (Priority: P2)

A release can still be cancelled by hand. When the runner signals the deploy
script (SIGINT, then SIGTERM), the script stops waiting and puts every service
it touched back on the image it ran before, as it does when a deployment fails.

**Independent Test**: start a deploy against a fake Railway API, abort it while
a deployment is still in progress, and check the previous image is restored.

**Acceptance Scenarios**:

1. **Given** a deploy whose first service is still deploying, **When** the run is cancelled, **Then** the deploy fails with "cancelled", that service is pointed back at its previous image and redeployed (its in-progress deployment may still go live on the new one), and no later service is touched.
2. **Given** a deploy whose first service already went live, **When** the run is cancelled during the second, **Then** both services are pointed back at their previous images and the first is redeployed.

### Edge Cases

- A cancel that arrives before any service was touched: nothing to restore; the run fails with "cancelled".
- A Railway call already in flight when the cancel arrives is aborted, so the restore starts at once; the restore's own calls are not tied to the cancel.
- A runner that kills the process before the restore finishes (SIGKILL) cannot be handled; the next release, or a manual redeploy, puts the services right.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every merge into `main` the pipeline MUST run every check on every project, build one image per app tagged with the commit SHA, push it to GitHub's container registry, migrate and deploy staging, wait for `/health/ready`, run the end-to-end suite against staging, and then promote to production with no manual approval. The staging wait for `/health/ready` is limited to 5 minutes; on expiry the run fails and nothing is promoted. Migrations run as `prisma migrate deploy` in the `api` pre-deploy command and MUST be backwards compatible, because the previous images may be restored.
- **FR-002**: Once staging and its end-to-end suite pass, the pipeline MUST deploy the same image digests to production after the production migrations, wait for `/health/ready`, and restore the previous images and fail the run if the check does not pass within 5 minutes.
- **FR-003**: Staging deploys and production deploys MUST each run one at a time, in commit order, and a deploy already running MUST NOT be cancelled by a newer commit: the newer one waits, and of several waiting only the latest proven commit runs next. There MUST be no path that deploys a branch or an unproven commit to production.
- **FR-004**: The by-hand checks of the pipeline (a lint error blocks a merge; a stale client fails the contract check; a broken migration stops the run before staging; production deploys only after staging and its end-to-end suite pass; a production deploy is not cancelled by a newer merge; a failing production health check restores the previous images) MUST be listed in `specs/421-monorepo-platform/quickstart.md`, with a place to record the date and result of each.
- **FR-005**: When the deploy script receives SIGINT or SIGTERM it MUST stop waiting, restore every service the run touched to its previous image (redeploying the ones already live on the new one), and exit non-zero.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-005
- **Modifies**: `421-FR-028` → `FR-001`, `421-FR-029` → `FR-002`, `421-FR-030` → `FR-003`, `421-FR-034` → `FR-004`

## Success Criteria *(mandatory)*

- **SC-001**: No configuration in `release.yml` lets a newer commit cancel a production deploy in progress, and a test fails if one is reintroduced.
- **SC-002**: A cancelled deploy leaves every service on the image it ran before the run, shown by a test against a fake Railway API.

## Assumptions

- GitHub Actions cancels a job by sending SIGINT, then SIGTERM after about 7.5 s, then SIGKILL; the restore is a few Railway calls and fits in that window.
- The readiness 503 seen locally (no object store) is already tracked by ST-450 and is out of scope.
