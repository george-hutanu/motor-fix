# Data model: Staff notification settings (ST-198)

No schema change. Everything below is derived at read time from existing tables.

## Stored (ST-197, unchanged)

`NotificationPreference(accountId, garageId?, type, channel, enabled, consent columns)` (`libs/domain/prisma/schema/notifications.prisma:62-79`).

**Row rule** (Clarification 1): a row is a **driver choice** when `garageId` is null and the type has a driver group: one row per type, `channel` is the chosen one. Any other row (a garage, or a type with no group such as the admin types) is a **staff row**: one per `(accountId, garageId, type, channel)`.

## Inputs of the staff list

| Source | Fields read | For |
| --- | --- | --- |
| `GarageMember` (`garages.prisma:25-34`) | `garageId`, `role` (`owner`/`receptionist`), garage `name` | one entry per membership |
| `Mechanic` (`garages.prisma:38-48`) | `garageId`, `canAnswerQuotes`, garage `name` | one entry, role `mechanic` |
| `AccountRole` / actor role | admin | the admin entry (no garage) |
| `GarageFeature` (`garages.prisma:53-59`) | `whatsapp`, `day_sheets` (a missing row is on) | WhatsApp availability; the day-sheet types |
| `Account` (`auth.prisma:41-42`) | `phone`, `phoneVerifiedAt` | `phone_not_verified` |
| `NotificationPreference` | the caller's rows | `enabled` per channel through `mutedChannels` |

## Derived: StaffNotifications (one per entry)

- `garageId`, `garageName` (null for admin), `role`
- `whatsapp: { available, reason: 'garage_whatsapp_off' | 'phone_not_verified' | null }` (garage switch first, phone second; admin: phone only)
- `sections[]`: `key` in `requests_quotes | bookings | reviews | account | admin`, catalogue order, empty sections left out
  - `types[]`: `type`, `channels[]` of `{ channel: email|push|whatsapp, enabled, locked }`
  - `enabled` = not in `mutedChannels(type, rows of this garage)`: a missing row is on, except WhatsApp when the type has another channel (ST-197 opt-in)
  - `locked` = `alwaysSent && channel === 'email'`, or ADMIN_OUTAGE_ALERT's e-mail and push

## Validation of a staff choice (FR-008), in order

1. 400 `unknown_notification_type`, 422/400 `channel_not_allowed` (SMS; a channel the type lacks) — ST-197, kept
2. 404 `not_found` — a garage the caller is not staff of (`checkGarages`)
3. 422 `type_not_in_list` — type outside the caller's list for that garage (or not admin / not an admin type when `garageId` is null and the type has no driver group)
4. 422 `channel_locked` — `locked` and `enabled: false`
5. 422 `whatsapp_unavailable` — WhatsApp on while the entry's `whatsapp.available` is false
6. 422 `last_channel` — a `keepOne` type (DOCUMENT_DUE/OVERDUE) left with every channel off by the whole save

A refusal changes nothing (checks run before the transaction).

## Catalogue change

`DOCUMENT_DUE`, `DOCUMENT_OVERDUE`: kind `always` → `keep_one` (`alwaysSent: false`, `groupable: false`, `keepOne: true`).

## Send-time (FR-009/010)

`muted(input, accountId)` reads rows for `(accountId, input.garageId ?? null, type')` where `type' = REQUEST_RECEIVED` for REQUEST_REMINDER; `mutedChannels(kind, rows, garageId)` applies the row rule. A DOCUMENT_* type skips its muted channels like any staff type (`sendsEmail` no longer forces e-mail).
