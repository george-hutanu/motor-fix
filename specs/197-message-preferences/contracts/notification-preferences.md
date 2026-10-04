# Contract: /api/v1/notification-preferences

Any signed-in person, for their own preferences only (no account id is taken); 401 without a session.

## GET → 200 NotificationPreferencesDto

```json
{
  "groups": [
    { "key": "offers", "enabled": true, "types": ["QUOTE_RECEIVED", "…"] },
    { "key": "bookings", "enabled": true, "types": ["…"] },
    { "key": "due_dates", "enabled": true, "types": ["DUE_ITP", "…"] },
    { "key": "news", "enabled": false, "types": ["NEWS"] },
    { "key": "reviews_history", "enabled": true, "types": ["…"] }
  ],
  "preferences": [
    { "type": "QUOTE_RECEIVED", "channel": "email", "enabled": true, "alwaysSent": false, "garageId": null },
    { "type": "REQUEST_RECEIVED", "channel": "push", "enabled": false, "alwaysSent": false, "garageId": "<uuid>" }
  ]
}
```

Driver types first (every one, defaults filled in), then the saved rows of other types.

## PUT ← UpdateNotificationPreferencesDto → 200 NotificationPreferencesDto

```json
{
  "groups": [{ "key": "due_dates", "enabled": false }],
  "preferences": [{ "type": "QUOTE_RECEIVED", "channel": "whatsapp", "enabled": true, "garageId": null }]
}
```

Both arrays optional (groups ≤ 5, preferences ≤ 200); every field of an item is required (`garageId` may be null). Errors, nothing changed:

| Status | code | When |
|--------|------|------|
| 400 | `validation_failed` | body shape |
| 400 | `unknown_notification_type` | type not in the catalogue |
| 400 | `channel_not_allowed` | channel not allowed for the type |
| 400 | `garage_not_allowed` | garage given for a driver type |
| 404 | `not_found` | a garage the caller does not belong to |
| 422 | `notification_type_always_sent` | an always-sent or transactional type switched off |

## Live

After a save: `{ audience: ["account:<id>"], event: { id, at, kind: "notification_preferences.updated" } }` on the live channel.
