# Contract: GET /api/v1/me

Auth: `Authorization: Bearer <access token>` (HS256; `sub`, `role`, `iat`, `exp`).

200 `MeDto`:
```json
{
  "id": "uuid", "name": "Mihai", "email": "mihai@example.ro", "language": "ro",
  "roles": ["driver", "garage"], "role": "garage", "garageId": "uuid",
  "capabilities": ["garage.requests", "garage.schedule", "..."],
  "landing": "/app/garage"
}
```

Errors (application/problem+json): 401 `sign_in_required` (no, bad or expired token; unknown or deleted account); 403 `account_suspended`.

## Internal contracts (libs/domain)
- `AuditPort.record(tx, { actorId, actorRole, action: 'create'|'update'|'delete', subjectType, subjectId, field?, oldValue?, newValue? })`
- `EventPort.record(tx, { kind: 'account.created', subjectId, payload: { accountId, roles, method } })`
- `signAccessToken({ accountId, role }, secret, minutes)`, `verifyAccessToken(token, secret)`
- `@UseGuards(ActorGuard)`, `@Requires(capability)`, `@CurrentActor()`; `assertOwner(actor, accountId)`, `assertGarage(actor, garageId)` throw 404.
