---
capability: audit
updated: 2026-10-07
features:
  - 390-audit-history
  - 391-audit-history-api
  - 164-admin-audit-log
---

# Capability: Audit history

The audit history (ACTIVITY_LOG): one append-only entry per change, written by every module through one writer inside the change's own transaction, with the actor, the scope ids and the key-change and internal flags.

## Requirements

### 390-FR-001 — The system MUST provide one writer that every module calls inside its own database transaction; the entry is written through that transaction, so an entry exists only if its change commits, and a failed entry write fails the change.

_From 390-audit-history._

### 390-FR-002 — Each entry MUST store: the action (`create`, `update`, `delete`, `open`), subject type, subject id, field (when one field), old value and new value as JSON, the actor id, actor role, actor name, and the time it was written (UTC).

_From 390-audit-history._

### 390-FR-003 — The system MUST turn an update into one entry per changed field, comparing values by content; unchanged fields write nothing.

_From 390-audit-history._

### 390-FR-004 — A whole-subject create MUST be one entry holding the new values, and a delete one entry holding the old values (a caller may instead record single fields, as ST-79's role entries do).

_From 390-audit-history._

### 390-FR-005 — The actor role MUST be one of `driver`, `owner`, `receptionist`, `mechanic`, `admin`, `system`; the account model's `garage` role is stored as `owner`.

_From 390-audit-history._

### 390-FR-006 — The actor name MUST be the name shown to others: for a person, their first name (the trimmed text before the first whitespace, whether the caller gave the name or the writer looked it up); for `system`, always "MotorFix". When the caller gives no name, the writer takes it from the account inside the same transaction; no account and no name gives an empty name.

_From 390-audit-history._

### 390-FR-007 — An entry made through an AI assistant MUST store `via_assistant` = true and the assistant grant id.

_From 390-audit-history._

### 390-FR-008 — Each entry MUST carry the scope ids it belongs to: garage id, car id and job id, each optional.

_From 390-audit-history._

### 390-FR-009 — Each entry MUST carry `is_key_change` and `internal` flags. `internal` is given by the caller. `is_key_change` is decided by the writer alone, from `subject_type.field`: `quote.from_bani`, `quote.to_bani` (a quote's range), `job.final_price_bani` (the final price and its correction), `booking.starts_at` (the start, and a move), `job.eta_at` (the estimated finish), `job.status` (the stage), `booking.mechanic_id` (a change of mechanic). A cancellation is added when its column is named.

_From 390-audit-history._

### 390-FR-010 — Each entry MAY carry a kind and a text (an optional reason or note); display text is not stored.

_From 390-audit-history._

### 390-FR-011 — The history MUST be append-only: the database refuses any update, delete or truncate of an entry, whoever asks.

_From 390-audit-history._

### 390-FR-012 — The history MUST be stored apart from the System status log; this writer never writes technical events or errors.

_From 390-audit-history._

### 390-FR-013 — The account model's use cases (ST-79) MUST write through this writer in the running application, replacing the no-op.

_From 390-audit-history._

### 390-FR-014 — A test MUST fail, naming the use case as `File#method`, when a method of a domain library service class writes through Prisma and does not call the writer; the writer itself is the only exemption.

_From 390-audit-history._

### 390-FR-015 — The history MUST be indexed by garage, car, job and actor, each with the time (no read API in this story). The time is the database clock at the insert, so entries of one change keep the order they were written.

_From 390-audit-history._

### 391-FR-001 — The system MUST serve `GET /api/v1/audit-history` to signed-in callers; without a valid token it answers 401 `sign_in_required`.

_From 391-audit-history-api._

### 391-FR-002 — The capabilities table MUST grant `garage.audit_history` to the garage owner, the receptionist and the mechanic (whatever their permissions), and `admin.audit_history` to the admin; no other role holds either, and `/me` lists them.

_From 391-audit-history-api._

### 391-FR-003 — For the owner, a receptionist or a mechanic, the system MUST return only entries whose garage id is the caller's own garage; entries of another garage or without a garage are never returned.

_From 391-audit-history-api._

### 391-FR-004 — For the admin, the system MUST return entries of every garage and entries without a garage.

_From 391-audit-history-api._

### 391-FR-005 — A caller without either capability (a driver), or a garage role with no garage, MUST get 404; a garage role passing a `garageId` that is not its own MUST get 404.

_From 391-audit-history-api._

### 391-FR-006 — The system MUST filter by `garageId`, `actorId`, `jobId`, `area`, `from` and `to` (both inclusive, ISO 8601 date-times with a zone), combined with AND.

_From 391-audit-history-api._

### 391-FR-007 — When `from` is absent, the system MUST use 7 days before the time of the call; `to` has no default.

_From 391-audit-history-api._

### 391-FR-008 — The `area` filter MUST be one of `requests`, `quotes`, `bookings`, `jobs`, `prices`, `repair_history`, `photos`, `garage_profile`, `team`, `settings`, `admin_actions`, each matching a fixed set of subject types (Data model table names), and `admin_actions` matching entries made by an admin.

_From 391-audit-history-api._

### 391-FR-009 — The system MUST order entries newest first, equal times by entry id (descending), and return 20 per page with `nextCursor` (null on the last page) and `total`, the number of entries matching the filters.

_From 391-audit-history-api._

### 391-FR-010 — A `cursor` MUST be the id of the last entry of the previous page; one that is not an existing entry inside the caller's scope and matching the current filters MUST answer 400 `invalid_cursor`.

_From 391-audit-history-api._

### 391-FR-011 — Each entry MUST carry id, time (UTC), action, subject type and id, field, old and new value as stored, the actor (id, first name, stored role), `viaAssistant`, garage, car and job ids, `internal`, kind and text; absent values are null.

_From 391-audit-history-api._

### 391-FR-012 — Internal entries MUST be returned to garage staff and the admin.

_From 391-audit-history-api._

### 391-FR-013 — For the owner, the receptionist and the mechanic, a non-null value of a field named `phone` or `plate`, and the value of any `phone` or `plate` key inside an object or array value (names compared without case), MUST be returned masked; `text` is not masked; the admin gets them as stored.

_From 391-audit-history-api._

### 391-FR-014 — Invalid parameters (unknown name, malformed id, a date without time or zone, unknown area, a given `from` after a given `to`) MUST answer 400 `validation_failed`.

_From 391-audit-history-api._

### 391-FR-015 — Reading the history MUST NOT write an audit entry, and the endpoint offers no way to change an entry.

_From 391-audit-history-api._

### 391-FR-016 — The OpenAPI document MUST describe the endpoint, its parameters and its answer, and the generated Angular client MUST include it.

_From 391-audit-history-api._

### 164-FR-001 — Every `admin/*` route whose method is `POST`, `PUT`, `PATCH` or `DELETE` MUST write, inside the same transaction as its change, at least one audit entry whose actor is the calling admin: `actor_id` the admin's account, `actor_role` `admin`, `actor_name` the admin's first name, with the action, the subject, the old and new values, and the time, as the audit capability stores them. When the entry cannot be written the whole request fails and nothing of the change is saved.

_From 164-admin-audit-log._

### 164-FR-002 — `POST /api/v1/admin/live/test` MUST write one entry per successful call: action `create`, subject the target account (`subject_type` `account`, `subject_id` the account), kind `live.test` (decided), no old value, and as new value the validated request body as stored JSON (`{ "accountId": … }`).

_From 164-admin-audit-log._

### 164-FR-003 — `POST /api/v1/admin/notifications/test` MUST write one entry per successful call: action `create`, subject the calling admin's account, kind `notification.test` (decided), and as new value the validated request body as stored JSON (`{ "accountIds": [...] }`, the accounts the test message was queued for). The route's change is a set of queued messages written one account at a time, so the entry commits first, in its own transaction, before any message is written: when the entry fails nothing is queued; when a send fails afterwards the request answers 5xx and the entry stays, recording the attempt.

_From 164-admin-audit-log._

### 164-FR-004 — A guard test MUST take every `admin/*` route and method from the API's own route list (the OpenAPI document, as the admin routes test does), call each `POST`, `PUT`, `PATCH` or `DELETE` route once, one call at a time (so the count is the call's own), as a seeded admin with a known-good request from a table keyed by `METHOD /path`, and fail, naming every such route, when the call answered anything but 2xx (with its status), when the number of entries whose `actor_id` is that admin did not grow across that one call (counted before and after each call), or when the table holds no request for the route. Each `GET` route is called the same way and MUST leave the count unchanged; a later `GET` that is one of the audit capability's two logged reads is marked as such in the table by the story that adds it, and must then add exactly one entry. After this story the test names no route; a route added later joins the test without the test being edited beyond its fixture table.

_From 164-admin-audit-log._
