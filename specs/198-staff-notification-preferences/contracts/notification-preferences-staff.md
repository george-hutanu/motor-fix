# Contract: `staff` on the notification preferences (ST-198)

Routes unchanged: `GET` and `PUT /api/v1/notification-preferences` (session required). DTOs in `libs/contracts/src/notification-preferences.dto.ts`; `apps/api/openapi.json` and `libs/data-access` are regenerated, never edited.

## GET → `NotificationPreferencesDto` (ST-197 fields unchanged) + `staff`

```jsonc
{
  "groups": [...], "preferences": [...], "newsConsent": {...},
  "staff": [
    {
      "garageId": "uuid", "garageName": "Atelier Test", "role": "owner",
      "whatsapp": { "available": false, "reason": "phone_not_verified" },
      "sections": [
        { "key": "requests_quotes", "types": [
          { "type": "REQUEST_RECEIVED", "channels": [
            { "channel": "email", "enabled": true, "locked": false },
            { "channel": "push", "enabled": true, "locked": false },
            { "channel": "whatsapp", "enabled": false, "locked": false }
          ]}
        ]},
        { "key": "bookings", "types": [ { "type": "DAY_SHEET_OUTDATED", "channels": [] } ] }
      ]
    },
    { "garageId": null, "garageName": null, "role": "admin",
      "whatsapp": { "available": true, "reason": null },
      "sections": [ { "key": "admin", "types": [ { "type": "ADMIN_OUTAGE_ALERT", "channels": [
        { "channel": "email", "enabled": true, "locked": true },
        { "channel": "push", "enabled": true, "locked": true } ] } ] } ] }
  ]
}
```

Enums: `role` ∈ `owner | receptionist | mechanic | admin`; `sections[].key` ∈ `requests_quotes | bookings | reviews | account | admin`; `channel` ∈ `email | push | whatsapp`; `whatsapp.reason` ∈ `garage_whatsapp_off | phone_not_verified | null`. A person who is no staff and no admin: `"staff": []`.

## PUT body (unchanged shape)

`{ "preferences": [ { "garageId": "uuid" | null, "type": "REQUEST_RECEIVED", "channel": "push", "enabled": false } ] }` — a staff choice carries its garage (null for an admin type). Answer: the GET body after the save. Publishes `notification_preferences.updated` on `account:{accountId}`.

## Refusals (problem details `{ code, message }`)

| Status | code | When |
| --- | --- | --- |
| 400 | `unknown_notification_type` | type not in the catalogue (ST-197) |
| 400 | `channel_not_allowed` | the catalogue does not give the type this channel (ST-197) |
| 422 | `channel_not_allowed` | SMS from a non-driver (ST-197) |
| 404 | `not_found` | a garage the caller is not staff of (ST-197) |
| 422 | `type_not_in_list` | type outside the caller's list for that garage / not an admin |
| 422 | `channel_locked` | a locked channel switched off |
| 422 | `whatsapp_unavailable` | WhatsApp on while unavailable for that entry |
| 422 | `last_channel` | DOCUMENT_DUE / DOCUMENT_OVERDUE left with no channel on |

Live event consumed by the panel: `notification_preferences.updated` (account audience) and `garage.features_changed` (garage audience; `libs/contracts/src/events.ts:50`).
