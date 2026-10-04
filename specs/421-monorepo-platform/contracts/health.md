# Contract: health endpoints

In the OpenAPI document under tag `health` (api only; `worker`, `web` and `mcp` serve the same paths but are not in the document). Outside the `/api/v1` prefix.

## GET /health/live — api, worker, web, mcp

`200 application/json`

```json
{ "status": "ok" }
```

Touches no dependency.

## GET /health/ready — api, worker

Each check: PostgreSQL `SELECT 1`, Redis `PING`, run in parallel, each limited to 2 s.

`200` when both pass:

```json
{ "status": "ok", "checks": { "postgres": "ok", "redis": "ok" }, "version": "<RELEASE_SHA>" }
```

`503` when either fails or times out:

```json
{ "status": "error", "checks": { "postgres": "ok", "redis": "error" }, "version": "<RELEASE_SHA>" }
```

DTO: `HealthReadyDto { status: 'ok' | 'error'; checks: { postgres: 'ok' | 'error'; redis: 'ok' | 'error' }; version: string }` in `libs/contracts`. Both status codes return this shape, so the generated client types both.

## GET /health/ready — web

`200 { "status": "ok" }` once the server can render (it answers from the same process that renders, so being able to answer is the check).

## Errors (every API route)

`application/problem+json` (RFC 9457):

```json
{ "type": "about:blank", "title": "Bad Request", "status": 400, "code": "validation_failed", "detail": "property foo should not exist" }
```

Codes in this story: `validation_failed` (400), `not_found` (404), `service_unavailable` (503), `internal_error` (500, no stack, no detail). Every response carries `X-Request-Id`.
