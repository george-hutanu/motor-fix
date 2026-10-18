---
capability: storage
updated: 2026-10-18
features:
  - 422-private-file-storage
  - 110-workshop-photos
  - 1191-resilient-uploads
---

# Capability: Storage

Private object storage for every file MotorFix keeps: the rules per file purpose, signed upload and download addresses, the confirmation checks, the server write and the delete, and the browser upload helper.

## Requirements

### 1191-FR-005 — The one table of file purposes and their rules, shared by the API, the worker and the web app (`libs/contracts/src/files.ts`), MUST read: `garage_photo` takes JPEG, PNG, WebP, HEIC and HEIF; `message_photo` and `mechanic_photo` take JPEG, PNG or WebP; `legal_document` and `repair_invoice` take PDF, JPEG or PNG; every purpose up to 10 MB (supersedes 422-FR-001 by adding `image/heic` and `image/heif` to `garage_photo`). The confirm's signature check MUST recognise a HEIC/HEIF file by its `ftyp` box brand (`heic`, `heix`, `hevc`, `hevx`, `mif1`, `msf1`, `heif`); a declared HEIC whose bytes are not one, or a HEIC declared as another type, is refused as `file_type_mismatch` and deleted (422-FR-005). The worker MUST decode a HEIC/HEIF original (a HEIC decoder dependency in the worker, the one new dependency of this story) and write a JPEG thumbnail and a JPEG display copy with the same sizes and metadata stripping as today (110-FR-010). `legal_document` and the other purposes do not change. Integration tests MUST cover a real HEIC accepted and processed, and both mismatch cases. This supersedes the closed ST-936 decision "HEIC photos are not accepted" (context.md, Contradictions), which rested on sharp's binary not decoding HEIC; the worker's decoder removes that reason.

_From 1191-resilient-uploads._

### 422-FR-002 — Before issuing an upload address, storage MUST refuse a declared type the purpose does not allow (422, `file_type_not_allowed`) and a declared size above the purpose's limit (422, `file_too_large`), and MUST refuse with 400 (`validation_failed`) a size that is not a positive whole number of bytes, an unknown purpose and an owner id that is not 1 to 64 letters, digits, `_` or `-`.

_From 422-private-file-storage._

### 1191-FR-006 — Every upload address storage issues (every caller of `createUpload`: listing photos and listing documents today) MUST be a presigned PUT, signed for 15 minutes for one key under `incoming/` (422-FR-004), bound to the declared content type, the exact declared length and a CRC32 checksum (base64) the caller declares; the store MUST accept only that key and MUST refuse a body whose type, length or checksum differs (supersedes 422-FR-003's form bound to type and at most the declared size). The address request DTOs MUST gain a required `checksum` (base64 CRC32, refused with 400 `validation_failed` when missing or malformed), and the address DTO MUST become `{ url, key, expiresAt, headers }`, where `headers` are the headers the browser sends with the PUT; the form `fields` go. The browser upload helper MUST compute the CRC32 of the bytes it sends, ask for the address with it, PUT the body with the given headers, report progress, retry a dropped connection a number of times its caller passes (3 by default, the documents step; 0 for the queued photos, whose drain owns the backoff), ask for a new address once when the store refuses an expired one, then call the owning confirm and return its result, or fail with an error (supersedes 422-FR-012's form post). `apps/api/openapi.json` and the generated client MUST be regenerated. An integration test against the compose store MUST prove the matching body is accepted and a wrong checksum, length and type each refused.

_From 1191-resilient-uploads._

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

## Retired

- `422-FR-008` — superseded by `110-FR-003` (2026-10-08)
- `422-FR-001` — superseded by `1191-FR-005` (2026-10-18)
- `422-FR-003` — superseded by `1191-FR-006` (2026-10-18)
- `422-FR-012` — superseded by `1191-FR-006` (2026-10-18)
