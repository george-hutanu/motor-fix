# Contract: admin audit entries

No route, DTO or response changes; `apps/api/openapi.json` and the generated client stay as they are. What this story promises is visible through the existing audit read.

## Routes that now leave an entry

| Route | Capability | Entry (see [data-model.md](../data-model.md)) | Answer |
| --- | --- | --- | --- |
| `POST /api/v1/admin/live/test` | `admin.users` | one, `kind: live.test`, subject the target account | 202 as before; 404 unknown target and 400 bad body write nothing |
| `POST /api/v1/admin/notifications/test` | `admin.settings` | one, `kind: notification.test`, subject the admin, written before any message is queued | 202 `{ queued }` as before; 400 `unknown_recipient` writes nothing; a failed send answers 5xx and keeps the entry |
| `POST /api/v1/admin/news` | `admin.settings` | unchanged (`subject_type: news_send`, written by ST-116's service) | unchanged |
| `GET /api/v1/admin/overview` | `admin.garages` | none | unchanged |

## Where the entries are read

`GET /api/v1/audit-history`, area `admin_actions`, to an admin (391-FR-008, unchanged): every entry whose `actor_role` is `admin`, the two new kinds included.

## The rule for later admin routes (FR-004)

Every `admin/*` route in the OpenAPI document is called by `apps/api/src/admin-audit.integration.spec.ts`:

- a `POST`, `PUT`, `PATCH` or `DELETE` route needs one row in the spec's fixture table, keyed `METHOD /api/v1/admin/<path>` as the document spells it, giving a known-good body for a seeded admin; the call must answer 2xx and raise the admin's entry count by at least 1;
- a `GET` route needs no row and must leave the count unchanged; a later logged read (the audit capability's two) is marked in the table by the story that adds it, with an expected delta of 1;
- a changing route without a row, a non-2xx answer (reported with its status) or an unchanged count fails one case titled with the route.

The story that adds an admin route adds its fixture row with it; nothing else in the spec changes.
