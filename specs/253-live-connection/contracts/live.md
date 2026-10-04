# Contract: live connection

## GET /api/v1/live
- Auth: `Authorization: Bearer <access token>`; 401 `sign_in_required` without a valid one, 403 `account_suspended`.
- 200 `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- Messages: `event: <kind>` + `data: {"kind","id","at"[,"reason"]}`; first `hello`; a `: ping` comment after 25 s of silence; `bye` (`expired` | `evicted` | `shutdown`) before the server ends the stream.

## POST /api/v1/admin/live/test
- Body `{ "accountId": "<uuid>" }` (`LiveTestDto`); 202 when published.
- 401 without a token; 404 for a signed-in non-admin or an unknown account; 400 for a bad body; 503 `live_unavailable` when Redis does not answer.
