# Data model: Message templates

Nothing is stored. Templates are code; the `notification` table is unchanged and its `params` (Json) supply the values.

## Template (code)

| Field | Type | Rule |
| --- | --- | --- |
| audience | `driver` \| `garage` \| `mechanic` \| `admin` \| `any` | `plate` only in `driver` templates and DAY_SHEET; `phone` in none |
| values | `{ [name]: 'text' \| 'link' \| 'count' \| 'num' \| 'lei' \| 'when' }` | every `{name}` used must be declared |
| example | `{ [name]: unknown }` | renders every channel in both languages within the limits |
| email | `{ ro, en }` of `{ subject, lines[], button: { label, link }, reason }` | `link` names a declared `link` value |
| bell | `{ ro, en }` of string | |
| push | `{ ro, en }` of `{ title, body, link }` | title ≤ 50, body ≤ 120 |
| sms | `{ ro, en }` of string | ≤ 70, link included |
| whatsapp | `{ ro, en }` of `{ name, slots[] }` | name non-empty, every slot non-empty |

Registry key: the notification type, or `<TYPE>.<variant>` (`ACCOUNT_EMAIL.email_check`, `ACCOUNT_EMAIL.password_reset`, `QUOTE_RECEIVED.grouped`), plus `GENERIC` and `GENERIC.grouped`. The part before the dot must be a catalogue type (or `GENERIC`).

Built-in value: `app` (`link`), the web app's URL from `PUBLIC_WEB_URL`, offered by the worker.

## Notification row (unchanged)

New failure reason: `template_failed` (row `failed`, no fallback hook).
