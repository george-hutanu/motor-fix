---
capability: audit
updated: 2026-10-04
features:
  - 390-audit-history
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
