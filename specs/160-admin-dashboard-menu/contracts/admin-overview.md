# Contract: admin overview

The one external interface this story adds. The OpenAPI document (`apps/api/openapi.json`) and the generated client (`libs/data-access`) are the authority once regenerated; this page is the agreed shape.

## `GET /api/v1/admin/overview`

- Tag: `admin`. Controller `AdminOverviewController` (`libs/domain/src/garages/admin-overview.controller.ts`), `@Requires('admin.garages')`, bearer session.
- Generated client: `AdminService.adminOverviewControllerOverview()` → `Observable<AdminOverviewDto>`.

### Response 200

```json
{ "garagesWaiting": 2 }
```

`AdminOverviewDto` (`libs/contracts/src/admin.dto.ts`): `garagesWaiting` integer ≥ 0, the number of verification files whose status is `submitted` or `in_review` at the moment of the call. No caching header; every call counts.

### Refusals (the guard's, shared by every `admin/*` route)

| Case | Status | `code` |
| --- | --- | --- |
| no or invalid token | 401 | `sign_in_required` |
| suspended account | 403 | `account_suspended` |
| session without `admin.garages` (driver, garage, receptionist, mechanic) | 404 | `not_found` |
| maintenance mode on | 200 | — (not refused) |

Problem bodies follow `libs/contracts/src/problem.ts`.

## Live re-read (no new event)

The web re-reads the overview on the existing live messages `verification.submitted`, `verification.decided`, `verification.reopened` (audience `admin`, `libs/domain/src/events/audience.ts`) and on the live service's `resync`. No message carries the count; the client always reads it back from the route.

## Route inventory under `admin/*` (what the 404 test must find)

| Route | Capability |
| --- | --- |
| `GET admin/overview` (new) | `admin.garages` |
| `POST admin/live/test` | `admin.users` |
| `POST admin/notifications/test` | `admin.settings` |
| `POST admin/news` | `admin.settings` |

`apps/api/src/admin-routes.integration.spec.ts` reads the list from the OpenAPI document and asserts these four are present, so a new `admin/*` route is tested without editing the spec.
