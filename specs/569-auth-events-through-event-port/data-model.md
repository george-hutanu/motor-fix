# Data model: Auth events through the event port

No schema change. The feature writes one more row of an existing table and reuses one existing live message.

## Domain event `account.password_reset` (outbox row)

Written by the `outbox` `EventPort` into `outboxEvent` (`libs/domain/src/events/event.port.ts:23-35`), inside the reset's transaction.

| Field | Value | Rule |
| --- | --- | --- |
| `kind` | `'account.password_reset'` | new entry of `EVENT_KINDS` (`libs/contracts/src/events.ts`), `area.verb_past`, closed `EventKind` union |
| `subjectId` | the account id | the object a reader re-reads |
| `audience` | `account:<id>` (from `{ accountId, type: 'account' }` through `audienceOf`) | only the account's own streams receive it |
| `payload` | `{ accountId }` | ids only; never a password, hash, link or token (spec Edge Cases) |

**Lifecycle**: exists only after a completed reset's transaction commits (FR-001); a refused reset, a concurrent loser or a failing port leaves none (FR-002). Relayed by the worker as every other kind is; nothing consumes it yet.

## Live message `session.revoked` (transient, unchanged)

`{ at: ISO string, id: uuid, kind: 'session.revoked' }` on `live:events` for audience `[account:<id>]`, published after the commit by one `SignInService` method for both flows (FR-003). Not a catalogue kind (`events.ts:3-5`, `events.spec.ts:41-50`); no row, no retry: the deleted refresh tokens end a tab that missed it at its next renewal.

## Unchanged records

The `password_reset` audit entry, the taken `accountToken` (`usedAt`), the replaced `accountIdentity.passwordHash`, the deleted `refreshToken` rows and the `password_changed` e-mail job stay as ST-127 wrote them (FR-004).
