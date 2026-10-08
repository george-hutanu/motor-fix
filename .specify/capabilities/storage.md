---
capability: storage
updated: 2026-10-08
features:
  - 422-private-file-storage
  - 110-workshop-photos
---

# Capability: Storage

Private object storage for every file MotorFix keeps: the rules per file purpose, signed upload and download addresses, the confirmation checks, the server write and the delete, and the browser upload helper.

## Requirements

### 422-FR-001 — The system MUST keep one table of file purposes and their rules, shared by the API, the worker and the web app: `garage_photo`, `message_photo` and `mechanic_photo` take JPEG, PNG or WebP up to 10 MB; `legal_document` and `repair_invoice` take PDF, JPEG or PNG up to 10 MB.

_From 422-private-file-storage._

### 422-FR-002 — Before issuing an upload address, storage MUST refuse a declared type the purpose does not allow (422, `file_type_not_allowed`) and a declared size above the purpose's limit (422, `file_too_large`), and MUST refuse with 400 (`validation_failed`) a size that is not a positive whole number of bytes, an unknown purpose and an owner id that is not 1 to 64 letters, digits, `_` or `-`.

_From 422-private-file-storage._

### 422-FR-003 — An upload address MUST be signed for 15 minutes, for one key under `incoming/`, and MUST let the store accept only that key, the declared content type and at most the declared size.

_From 422-private-file-storage._

### 422-FR-004 — Every key storage issues for an upload MUST be `incoming/<purpose>/<owner id>/<random id>`, and its final key `<purpose>/<owner id>/<random id>` with the same random id; neither MUST contain the original file name or any other personal data.

_From 422-private-file-storage._

### 422-FR-005 — Confirming an upload takes the key, the purpose and the owner id, and MUST check that the object exists (else 409, `file_missing`), that its size is within the purpose's limit (else delete it, 422, `file_too_large`) and that its first bytes match the JPEG, PNG, WebP or PDF signature of its stored content type (else delete it, 422, `file_type_mismatch`); then move exactly the object it checked (an object replaced at the same key during the checks is not moved, and the confirm answers `file_missing`) to its final key, remove the `incoming/` object, and return the final key. A key outside the given purpose and owner's `incoming/` prefix MUST be answered `file_missing` without touching any object. A key whose final key already holds a file (a form replayed after its confirmation) MUST be answered `file_missing`, and the confirmed file MUST NOT be replaced.

_From 422-private-file-storage._

### 422-FR-006 — A download address MUST be signed for the lifetime the owning use case passes (5 minutes for private files, 60 minutes for public images; a lifetime that is not a positive number of minutes is refused), for one key only, point at the storage provider's address, and make the store serve the file `inline` or as an `attachment` (any other disposition is refused), with a file name in RFC 6266 dual form (`filename="<ascii>"; filename*=UTF-8''<encoded>`) from which quotes, slashes, backslashes and control characters are removed.

_From 422-private-file-storage._

### 422-FR-007 — The server MUST be able to write a file straight to its final key without signing an upload address.

_From 422-private-file-storage._

### 110-FR-003 — Deleting a photo key MUST also delete the keys derived from it (its thumbnail and display copy), in one storage call, and succeed when any of them holds no object (422-FR-008); the storage rules for the `garage_photo` purpose stay JPEG, PNG and WebP with their signature check (422-FR-001, 422-FR-005), so a file whose bytes are not a photo is deleted and refused with `file_type_mismatch`. HEIC is not accepted: the worker's image library cannot decode it on the runtime image (`deferred.md`).

_From 110-workshop-photos._

### 422-FR-011 — The refusals in FR-002 and FR-005 MUST be raised as HTTP errors with status 422 or 409 whose body carries the stable `code`, so the owning endpoint answers with that status and code. (The API's error filter keeping a carried `code` is delivered by ST-79, not here.)

_From 422-private-file-storage._

### 422-FR-012 — The browser upload helper MUST post the file and the address's form fields straight to the store, report progress, retry a dropped connection up to 3 times, ask for a new address once when the store refuses an expired one, then call the owning confirm call and return its result, or fail with an error.

_From 422-private-file-storage._

## Retired

- `422-FR-008` — superseded by `110-FR-003` (2026-10-08)
