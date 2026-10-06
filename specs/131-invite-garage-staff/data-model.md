# Data model: invite a mechanic or receptionist

## StaffInvite (new, `garages.prisma`, table `staff_invite`)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid | primary key |
| garageId | uuid → garage | cascade on delete |
| kind | enum `staff_invite_kind` (`mechanic`, `receptionist`) | |
| name | text | the invitee's name as typed, trimmed |
| email | text | trimmed, lower-case |
| canMoveBookings, canAnswerQuotes, canRecordFinalPrice | boolean, default false | meaningful for `mechanic` only; stored false for a receptionist |
| tokenHash | text, unique | SHA-256 of the current token; replaced on resend |
| status | enum `staff_invite_status` (`sent`, `accepted`, `revoked`) | `expired` is never written |
| expiresAt | timestamptz(3) | 7 days from the send or the last resend |
| createdAt | timestamptz(3), default now | |

Index `(garageId, email)`: the open-invite check and the owner's later Team page. `Garage.invites StaffInvite[]`.

### Derived state

- **open**: `status = sent` and `expiresAt > now` — blocks a new invite to the same address; the only state `check` answers with the invite.
- **expired**: `status = sent` and `expiresAt <= now` — `check` answers `invite_expired`; resend allowed; does not block a new invite.

### Transitions

| From | Action | To | Side effects (same transaction unless noted) |
| --- | --- | --- | --- |
| — | send (owner) | sent | row created; audit `invite_sent`; outbox `invite.sent`; then the e-mail (outside the transaction, answered as `emailSent`) |
| sent (open or expired) | resend (owner) | sent | new `tokenHash`, `expiresAt` = now + 7 d; audit `invite_resent`; then the e-mail |
| sent | revoke (owner) | revoked | audit `invite_revoked`; outbox `invite.revoked` |
| sent (open) | accept (signed-in account) | accepted | role granted (`account_role`, audited by `grantRole`); mechanic row created or moved, or receptionist membership created; audit `invite_accepted`; outbox `invite.accepted` (+ `mechanic.updated` on a move); after commit: STAFF_JOINED to the owner, session switched to the role |
| accepted, revoked | resend, revoke, accept | — | 409 / 410 `invite_invalid` |

## Existing models touched

- **Mechanic**: `upsert` by `accountId` on acceptance — create `{ garageId, accountId, permissions }` or update `{ garageId, permissions }` (the move). No new column.
- **GarageMember**: create `{ garageId, accountId, role: receptionist }` on a receptionist acceptance; `@@unique([accountId, role])` already keeps an account receptionist at one garage.
- **AccountRole**: through `AccountsService.grantRole` (no duplicate, audited).
- **GarageFeature** `team_mechanics`: read only; a missing row is on.
- **ActivityLog**: entries with `subjectType: 'staff_invite'`, `subjectId: invite.id`, `garageId`, `kind: invite_sent | invite_resent | invite_revoked | invite_accepted`, `newValue: { kind, name, permissions }` (never the e-mail), `actorId`/`actorRole` the owner or the accepting account.
- **OutboxEvent**: `invite.sent`, `invite.revoked`, `invite.accepted` with `subjectId: invite.id`, `payload: { garageId, kind, inviteId, accountId? }`, audience `{ type: 'garage', garageIds: [garageId] }`; `mechanic.updated` with `subjectId: mechanic.id`, audience both garages.

## LiveSubject (events module)

`{ type: 'garage'; garageIds: readonly string[] }` → `garage:{id}` per garage.
