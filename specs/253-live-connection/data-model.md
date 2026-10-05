# Data model: 253-live-connection

No table changes. In memory, per API copy:

- **Connection**: `id` (uuid), `accountId`, `channels` (string set), `openedAt`, `expiresAt`, its response, its heartbeat and expiry timers. Created when a stream opens; removed when it ends (client gone, or after `bye`).
- **Live event** (wire): `{ kind, id, at }`: `kind` the SSE event name, `id` a fresh event id (the connection id for `hello` / `bye`), `at` an ISO time; `bye` adds `reason` (`expired` | `evicted` | `shutdown`).
- **Fan-out message** (Redis `live:events`): `{ event: LiveEvent, audience: string[] }`.
