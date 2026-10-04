# Research: 253-live-connection

## Reader in the browser
- Decision: `fetch` with `Authorization: Bearer`, `Accept: text/event-stream` and `ngsw-bypass: true`, the body read through `TextDecoderStream` and split into SSE blocks by a small local parser.
- Rationale: the access token lives in memory (`apps/web/src/app/dashboard/session.ts:8-14`); `EventSource` cannot send headers and the token never goes in the address (Build brief). The service worker must stay out of the stream's path; `ngsw-bypass` makes it pass the request straight through.
- Alternatives: `EventSource` with the token in the query (forbidden by the brief); an SSE client package (a dependency for ~30 lines, Principle I).
- Evidence: Build brief "Rules and validation"; `apps/web/ngsw-config.json`.

## Streaming through the web app's edge
- Decision: no change; the edge pipes answers as they arrive and destroys the upstream when the browser goes.
- Evidence: `apps/web/src/server/edge.ts:6-7,30-41`.

## Holding the stream open in Nest
- Decision: `@Res()` Express response after `ActorGuard` (so 401/403 are ordinary problem answers), `res.writeHead(200, headers)` + `flushHeaders()`, a write per message, and `req.on('close')` releasing the connection.
- Evidence: `libs/domain/src/auth/actor.guard.ts:51-63` (the guard throws before the handler runs).

## Token expiry on the stream
- Decision: `verifyAccessToken` also returns `expiresAt` (ms, from `exp`); the controller reads it from the request's own header, and the hub ends the stream at that time with `bye` `expired`.
- Evidence: `libs/domain/src/auth/access-token.ts:37-68`.

## Fan-out
- Decision: one ioredis publisher and one subscriber connection per API copy; channel `live:events`; message `{ event, audience }`; ioredis `autoResubscribe` (default true) resubscribes after a Redis outage.
- Evidence: `node_modules/ioredis/built/redis/RedisOptions.d.ts:88-91`; Build brief "Redis".

## Channels
- Decision: from the Actor the guard builds: `account:<id>`, `system`; `garage:<garageId>` when `actor.garageId` is set (owner, receptionist, mechanic); `mechanic:<mechanic.id>` (one lookup by account) for the mechanic role; `admin` for the admin role.
- Evidence: `libs/domain/src/auth/actor.guard.ts:66-94`.
