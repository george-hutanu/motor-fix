# Data model: dashboard views (front end only, no storage)

`DashboardView` — one entry of a dashboard's ordered list (`apps/web/src/app/dashboard/views.ts`):

| Field | Type | Rule |
| --- | --- | --- |
| `path` | string | `''` for the dashboard view; otherwise a language-neutral segment, unique in its dashboard |
| `label` | translation key | the side menu's long label (`shell.frame.nav.*`) |
| `tab` | translation key | the bar's short label (`shell.frame.tab.*`) |
| `capability` | capability string, optional | absent: every role of the dashboard sees the view |

Lists (order is the menu order):

- driver: `''` Panou · `requests` (driver.requests) · `cars` (driver.cars) · `reviews` (driver.reviews) · `saved` (driver.saved_garages) · `settings` (driver.settings)
- garage: `''` · `requests` (garage.requests) · `schedule` (garage.schedule) · `team` (garage.team) · `prices` (garage.prices) · `reviews` (garage.reviews) · `profile` (garage.profile)
- admin: `''` · `garages` (admin.garages) · `users` (admin.users) · `reviews` (admin.reviews) · `catalogue` (admin.catalogue) · `settings` (admin.settings)

Allowed views of a session = the list of its landing's dashboard filtered by `capability ∈ session.capabilities`.
