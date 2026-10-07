# Data Model: ST-160 admin dashboard and menu

No table, column, enum or migration changes. The story reads one existing table, adds two seed rows, and extends two in-memory shapes on the web.

## Read: `verification_file` (existing)

`libs/domain/prisma/schema/garages.prisma:112-146`; migration `20261007120000_verification_file`.

| Column | Type | Used here |
| --- | --- | --- |
| `id` | uuid | — |
| `garage_id` | uuid → `garage.id` | the seed joins on `garage.slug` |
| `status` | `verification_file_status`: `submitted`, `in_review`, `approved`, `more_requested`, `rejected` | `garagesWaiting` = count where status in (`submitted`, `in_review`) |
| `opened_by`, `decided_by`, … | nullable uuid | left null by the seed |

Invariant kept: at most one live file (`submitted`, `in_review`, `approved`) per garage, partial unique index `verification_file_one_live`. So `garagesWaiting` is also the number of garages waiting (one file each), which is what the header line counts.

## Seed rows (dev and test only)

`libs/domain/src/seed.ts`, after the garages (R7). Idempotent: inserted only when the garage has no file at all.

| Garage slug | `status` |
| --- | --- |
| `service-dobre` | `submitted` |
| `atelier-dinamo` | `in_review` |
| `atelier-test` | (none) |

Seeded `garagesWaiting` = 2.

## API shape

`AdminOverviewDto` (`libs/contracts/src/admin.dto.ts`, new): `{ garagesWaiting: number }`, an integer ≥ 0. See [contracts/admin-overview.md](./contracts/admin-overview.md).

## Web: `DashboardView` (`apps/web/src/app/dashboard/views.ts:12-22`)

| Field | Today | Change |
| --- | --- | --- |
| `path`, `label`, `tab`, `capability?`, `push?`, `staff?` | existing | unchanged |
| `unreleased?: true` | — | new; set on admin `users`, `reviews`, `catalogue`, `assistant`. Filtered out by `allowedViews` and `dashboardRoutes`. Deleting the line releases the view. |
| `counter?: 'garagesWaiting'` | — | new; set on admin `garages`. The frame and the tab bar show the named count as a chip when it is above 0. |

Admin view list, in order (FR-006): `''` Panou, `garages` Service‑uri (counter), `users` Utilizatori (unreleased), `reviews` Recenzii raportate / tab Raportate (unreleased), `catalogue` Mărci și lucrări / tab Mărci (unreleased), `assistant` Asistent AI / tab Asistent (unreleased, `admin.settings`), `settings` Setări (push, staff).

## Web: `AdminOverview` store (`apps/web/src/app/dashboard/admin-overview.ts`, new)

Built on `liveResource` (R5). States, derived from the resource:

| State | `loading()` | `garagesWaiting()` | Header count text | Chip |
| --- | --- | --- | --- | --- |
| first read in flight | true | undefined | skeleton | hidden |
| read ok, n = 0 | false | 0 | zero form | hidden |
| read ok, n > 0 | false | n | plural form with n | n |
| any read failed (first or background) | false | undefined | hidden | hidden |
| re-read after failure succeeds | false | n | as above | as above |

Re-read triggers: a `verification.submitted`, `verification.decided` or `verification.reopened` live message (a burst within 300 ms = one read); `Live.resync` (reconnect). `verification.opened` and `verification.check_recorded` do not change the count and are ignored.

## Texts (shell catalogue, `libs/i18n/src/shell/{ro,en}.json`)

| Key | ro | en |
| --- | --- | --- |
| `frame.area.admin` | Administrator (was Admin) | Administrator (was Admin) |
| `frame.admin.city` | MotorFix · București | MotorFix · Bucharest |
| `frame.admin.none` | niciun service nu așteaptă verificarea | no garage is waiting for verification |
| `frame.admin.waiting.one` | {count} service așteaptă verificarea | {count} garage is waiting for verification |
| `frame.admin.waiting.few` | {count} service‑uri așteaptă verificarea | — |
| `frame.admin.waiting.other` | {count} de service‑uri așteaptă verificarea | {count} garages are waiting for verification |
| `frame.counter` | {label}, {n} în așteptare | {label}, {n} waiting |
| `frame.nav.admin.assistant` | Asistent AI | AI assistant |
| `frame.tab.assistant` | Asistent | Assistant |

The zero form is a key of its own because `Intl.PluralRules('ro').select(0)` is `few`; the code picks `none` at 0 and `waiting` with `{ count }` above 0. "Service‑uri" uses U+2011 (`check.ts:21`).
