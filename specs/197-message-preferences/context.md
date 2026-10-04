# Context: Store each person's message choices and check them before sending (ST-197)

Gathered: 2026-10-05 · Source: Notion space "MotorFix — Product documentation" only; the latest source wins.

## Story
- ST-197, Task, High, 3 points, Status To do → Planning (2026-10-05), Ready to work ticked. https://app.notion.com/p/3ee607bff0d2813a8daaf36ef87fada9
- Feature: Notifications (https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1). Epic: EP-1 Foundations, In progress.
- Build brief (current as of 2026-10-03) — scope: NOTIFICATION_PREFERENCE, its API and the send-time check; reading and saving for drivers, garage staff and admins; defaults; the check that skips a muted type but never an always-sent one; driver group keys and their type map as data.
- Acceptance scenarios 1–9 (defaults; due_dates off; bookings off but always-sent still go; 422 for always-sent; channel per type for drivers; staff per channel with garage_id; driver and garage rows separate; 404 for another account; saved values come back).
- Rules: five driver groups with their types (the catalogue's `group` column already matches); driver one row per type; staff one row per type and channel with garage_id; group switch skips always-sent types; missing row = default (on except NEWS; push if subscribed else e-mail, *proposed*); pipeline order always-sent → off → chosen channels, then quiet hours [X25].
- States: one transaction; last save wins per row (*proposed*); a failed read at send time sends on the default channel (*proposed*).
- Audit: each change — who, type or group, channel, old and new [27].
- Live: `notification_preferences.updated` on `account:{accountId}` (*proposed*).
- Screens: none (ST-138 driver panel, ST-198 staff panels).
- Who: any signed-in person for their own preferences; another account's → 404; an AI assistant cannot change them (*proposed*).

## Build timeline
- Row https://app.notion.com/p/3ee607bff0d281e48220fab7c5230a80: lane D · Messaging, W3, blocked by ST-194 (Merged) and ST-79 (Merged). Note: "API and preferences only; the Setari panel is ST-138. A fifth group reviews_history is open; default yes." The brief records it as decided 2026-10-03 [X26a].

## Epic decisions that bear on it
- A garage can mute new quote request notifications on any channel; verification results and job-completing messages are always sent (EP-1 Risks, decided 2026-10-03).
- Launch channels e-mail, push, SMS, WhatsApp through Brevo (A18); only e-mail is built (ST-194).
- Quiet hours 22:00–08:00 for non-urgent types [X25] (built in ST-194).

## Contradictions
- The brief's code `NOTIFICATION_TYPE_ALWAYS_SENT` vs the API's lower-snake convention → resolved in spec Clarifications.
- Default channel "push if subscribed": no push subscription exists until ST-196 → resolved in spec Clarifications.

## Constraints
- Builds on the merged ST-194 module (`libs/domain/src/notifications`); ST-195 (templates) is in QA on PR #67 and touches the processor and messages, not the service or the catalogue.
