---
capability: audit
updated: 2026-10-20
features:
  - 390-audit-history
  - 391-audit-history-api
  - 164-admin-audit-log
  - 365-mcp-oauth
  - 220-requests-quotes-bookings
  - 173-price-range-in-place
  - 304-request-garage-details
  - 176-price-change-activity-log
  - 1352-catalogue-job-visibility
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

### 220-FR-018 — (Replaces 390-FR-009.) Each audit entry MUST carry `is_key_change` and `internal` flags. `internal` is given by the caller. `is_key_change` is decided by the writer alone, from `subject_type.field`: `quote.from_bani`, `quote.to_bani` (a quote's range), `job.final_price_bani` (the final price and its correction), `booking.starts_at` (the start, and a move), `job.eta_at` (the estimated finish), `job.status` (the stage), `booking.mechanic_id` (a change of mechanic), and `booking.cancel_reason` (a cancellation, set once when a booking is cancelled).

_From 220-requests-quotes-bookings._

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

### 365-FR-011 — Each tool call MUST carry one request id on the actor, and the audit writer MUST store it in a new optional `request_id` column of the activity log next to `via_assistant` and `assistant_grant_id`. (D11; brief Request id)

_From 365-mcp-oauth._

### 176-FR-001 — Every successful change to a garage's price list through the existing writes (the row's range and duration, the labour range, a brand range added, changed or removed) MUST write its audit entries through the shared writer of ST-390, inside the same transaction as the change: when the change commits the entries exist, and when the transaction rolls back for any reason, the entry write included, none of them does.

_From 176-price-change-activity-log._

### 304-FR-010 — Every change the panel lists MUST exist as an audit entry: where a garage write of a profile field, price, brand, photo or legal document writes no audit entry today, this story MUST add that entry through the existing writer in the write's own transaction (390-FR-001, 390-FR-003), one per changed field with old and new values and one per photo or brand added or removed, and no more; the reach is the garage's own writers under `libs/domain/src/garages`, which the plan lists; a write outside them lacking an entry is a needs-confirmation question on the issue. Fields the garage never edits itself and operational fields (cache keys, counters, timestamps the system sets) are flagged internal or not written, so the panel never shows them.

_From 304-request-garage-details._

### 176-FR-002 — A change of a row's range MUST write exactly one entry: action `update`, subject type `garage_price`, subject id the row, field `range`, old value and new value each `{"from": <bani>, "to": <bani or null>}`. This replaces the two per-field entries (`from_bani`, `to_bani`) of 173-FR-008.

_From 176-price-change-activity-log._

### 176-FR-003 — A change of a row's duration MUST write exactly one entry: action `update`, subject type `garage_price`, subject id the row, field `duration_minutes`, old and new value the minutes (or null). A save that changes both the range and the duration writes two entries.

_From 176-price-change-activity-log._

### 176-FR-004 — A change of the garage's labour range MUST write exactly one entry: action `update`, subject type `garage`, subject id the garage, field `labour_range`, old and new value `{"from": <bani or null>, "to": <bani or null>}` (a null end only for a garage that never set its labour range). This replaces the two per-field entries (`labour_from_bani`, `labour_to_bani`) of 173-FR-008.

_From 176-price-change-activity-log._

### 176-FR-005 — A brand range MUST be recorded as one entry per step: `create` with the new value, `update` with old and new value, `delete` with the old value; subject type `garage_price`, subject id the brand row, field `brand_range`, each value exactly `{"brandId", "jobTypeId", "from", "to"}` with the prices in bani (no other keys).

_From 176-price-change-activity-log._

### 176-FR-006 — A save that changes no value MUST write no entry, whatever it answers. A value is unchanged when its stored and new content are equal (an absent end and a null end are the same; key order is not content).

_From 176-price-change-activity-log._

### 176-FR-007 — Every price-list entry MUST carry: the garage id, the actor's account id, actor role `owner`, the actor's first name, kind `price_list`, `is_key_change` = false, `internal` = false, no text, and the time of the write; values are stored in bani, never in lei.

_From 176-price-change-activity-log._

### 176-FR-008 — When the actor acts through an AI assistant, the price list writes MUST pass the actor's assistant grant id and request id to the writer, so the entry carries `via_assistant` = true, the grant id and the request id (390-FR-007, 365-FR-011); without a grant `via_assistant` is false. Both ids are passed as the actor carries them; the writer alone sets the flag.

_From 176-price-change-activity-log._

### 176-FR-010 — Reading a price list, the audit history or the public profile MUST write no entry.

_From 176-price-change-activity-log._

### 176-FR-011 — No price change table or log of its own MUST exist: the activity log is the only record, and the System status log receives none of these entries.

_From 176-price-change-activity-log._

### 176-FR-012 — The tests MUST cover, before the code (Principle II): in Jest (API, real PostgreSQL) — the `range` entry's exact values for the brief's 890 – 1.400 → 950 – 1.450 lei example; `range` and `duration_minutes` as two entries of one save; clearing the top; the `labour_range` entry; the three `brand_range` entries; no entry on an unchanged save; no entry when the save fails after the row was written; `via_assistant`, the grant id and the request id for an assistant actor; the entry readable by the owner, the receptionist, a mechanic and an admin, 404 for another garage's owner, a driver refused by the audit history read; `is_key_change` and `internal` false on every entry; reading the price list, the audit history and the public profile writes no entry; in Playwright — the seeded owner changes front brakes from the seeded 890 – 1.400 lei to 950 – 1.450 lei in the price list screen, then an admin signs in and the test reads `GET /api/v1/audit-history` with the admin's session and finds the entry with the old and new range (no admin screen exists for it yet).

_From 176-price-change-activity-log._

### 1352-FR-013 — Each write MUST record its audit entries through the shared writer, in the same transaction, in ST-176's format (kind `price_list`, actor role `owner`, the actor's first name, grant and request id as the actor carries them, `is_key_change` and `internal` false): an add, one `create` entry on `garage_price` (the default row) in the shape the listing's prices write already records for a new row, written through the same function; a hide or show, one `update` entry on the row, field `visible`, old and new boolean; a removal, one `delete` entry on the default row, its old value the same shape as the add's, plus one `brand_range` `delete` entry per brand row (176-FR-005) and one `garage_brand_job` `delete` entry per tick (412-FR-007's shape); a proposal, the catalogue row's `create` entry on `job_type` as the listing writes it and the price row's `create` entry as the add writes it. A write that changes nothing writes no entry.

_From 1352-catalogue-job-visibility._

## Retired

- `390-FR-009` — superseded by `220-FR-018` (2026-10-08)
- `173-FR-008` — superseded by `176-FR-001` (2026-10-19)
