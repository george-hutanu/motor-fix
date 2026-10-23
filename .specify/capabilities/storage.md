---
capability: storage
updated: 2026-10-23
features:
  - 422-private-file-storage
  - 110-workshop-photos
  - 1191-resilient-uploads
  - 1192-photo-variants
  - 068-yearly-documents
---

# Capability: Storage

Private object storage for every file MotorFix keeps: the rules per file purpose, signed upload and download addresses, the confirmation checks, the server write and the delete, and the browser upload helper.

## Requirements

### 1191-FR-005 — The one table of file purposes and their rules, shared by the API, the worker and the web app (`libs/contracts/src/files.ts`), MUST read: `garage_photo` takes JPEG, PNG, WebP, HEIC and HEIF; `message_photo` and `mechanic_photo` take JPEG, PNG or WebP; `legal_document` and `repair_invoice` take PDF, JPEG or PNG; every purpose up to 10 MB (supersedes 422-FR-001 by adding `image/heic` and `image/heif` to `garage_photo`). The confirm's signature check MUST recognise a HEIC/HEIF file by its `ftyp` box brand (`heic`, `heix`, `hevc`, `hevx`, `mif1`, `msf1`, `heif`); a declared HEIC whose bytes are not one, or a HEIC declared as another type, is refused as `file_type_mismatch` and deleted (422-FR-005). The worker MUST decode a HEIC/HEIF original (a HEIC decoder dependency in the worker, the one new dependency of this story) and write a JPEG thumbnail and a JPEG display copy with the same sizes and metadata stripping as today (110-FR-010). `legal_document` and the other purposes do not change. Integration tests MUST cover a real HEIC accepted and processed, and both mismatch cases. This supersedes the closed ST-936 decision "HEIC photos are not accepted" (context.md, Contradictions), which rested on sharp's binary not decoding HEIC; the worker's decoder removes that reason.

_From 1191-resilient-uploads._

### 422-FR-002 — Before issuing an upload address, storage MUST refuse a declared type the purpose does not allow (422, `file_type_not_allowed`) and a declared size above the purpose's limit (422, `file_too_large`), and MUST refuse with 400 (`validation_failed`) a size that is not a positive whole number of bytes, an unknown purpose and an owner id that is not 1 to 64 letters, digits, `_` or `-`.

_From 422-private-file-storage._

### 068-FR-006 — The upload dialog MUST reuse the document step of "List your garage" (ListGarage step 6: one picker per kind, PDF, JPG or PNG, at most 10 MB per file and 10 pages per document, the issue date for each, the certificate's within 30 days), opened from the row for the signed-in owner; each page goes to the object store through a signed upload address for the purpose `legal_document` (422-FR-002, 1191-FR-006) obtained from `POST /api/v1/garages/{garageId}/legal-documents/upload-url` (owner only: 403 `not_owner` for a receptionist or mechanic, 404 for anyone else and for a `draft` garage; 409 `document_in_review` while both kinds are `in_review`, since nothing is left to send), and a page the store refuses (type, size) is shown with its message and kept out. The browser MUST keep the chosen pages across a failed confirm and retry; with the store unreachable it reads "Încărcarea nu e disponibilă acum" / "Upload is not available right now". Nothing is stored on the garage until the confirm of FR-007 succeeds.

_From 068-yearly-documents._

### 422-FR-004 — Every key storage issues for an upload MUST be `incoming/<purpose>/<owner id>/<random id>`, and its final key `<purpose>/<owner id>/<random id>` with the same random id; neither MUST contain the original file name or any other personal data.

_From 422-private-file-storage._

### 422-FR-005 — Confirming an upload takes the key, the purpose and the owner id, and MUST check that the object exists (else 409, `file_missing`), that its size is within the purpose's limit (else delete it, 422, `file_too_large`) and that its first bytes match the JPEG, PNG, WebP or PDF signature of its stored content type (else delete it, 422, `file_type_mismatch`); then move exactly the object it checked (an object replaced at the same key during the checks is not moved, and the confirm answers `file_missing`) to its final key, remove the `incoming/` object, and return the final key. A key outside the given purpose and owner's `incoming/` prefix MUST be answered `file_missing` without touching any object. A key whose final key already holds a file (a form replayed after its confirmation) MUST be answered `file_missing`, and the confirmed file MUST NOT be replaced.

_From 422-private-file-storage._

### 422-FR-006 — A download address MUST be signed for the lifetime the owning use case passes (5 minutes for private files, 60 minutes for public images; a lifetime that is not a positive number of minutes is refused), for one key only, point at the storage provider's address, and make the store serve the file `inline` or as an `attachment` (any other disposition is refused), with a file name in RFC 6266 dual form (`filename="<ascii>"; filename*=UTF-8''<encoded>`) from which quotes, slashes, backslashes and control characters are removed.

_From 422-private-file-storage._

### 422-FR-007 — The server MUST be able to write a file straight to its final key without signing an upload address.

_From 422-private-file-storage._

### 1192-FR-004 — Deleting a photo key MUST also delete the keys derived from it (its thumbnail, its display copy and its eight variants, the variants found through the digest on its thumbnail's metadata), and succeed when any of them holds no object; a photo without a digest deletes the key and its two copies as today. The thumbnail MUST be deleted last, after the others succeeded, so a delete that fails part-way can be repeated and still finds the digest. The storage rules for the `garage_photo` purpose and their signature check stay as 1191-FR-005 sets them (supersedes 110-FR-003, whose HEIC exclusion 1191-FR-005 already lifted).

_From 1192-photo-variants._

### 422-FR-011 — The refusals in FR-002 and FR-005 MUST be raised as HTTP errors with status 422 or 409 whose body carries the stable `code`, so the owning endpoint answers with that status and code. (The API's error filter keeping a carried `code` is delivered by ST-79, not here.)

_From 422-private-file-storage._

### 1192-FR-011 — One named photo configuration MUST give the job's `attempts` (default 3), the failed jobs kept (`removeOnFail`, default 100), sharp's `limitInputPixels` (default 268,402,689) and the worker's concurrency (default the CPU count), each from an optional environment variable (`PHOTO_JOB_ATTEMPTS`, `PHOTO_JOB_KEEP_FAILED`, `PHOTO_MAX_INPUT_PIXELS`, `PHOTO_WORKER_CONCURRENCY`) whose malformed or non-positive value falls back to the default; `listing-photos.service.ts` and `photo-processing.ts` read it. A unit test MUST cover the defaults and a set value.

_From 1192-photo-variants._

## Retired

- `422-FR-008` — superseded by `110-FR-003` (2026-10-08)
- `422-FR-001` — superseded by `1191-FR-005` (2026-10-18)
- `422-FR-003` — superseded by `1191-FR-006` (2026-10-18)
- `422-FR-012` — superseded by `1191-FR-006` (2026-10-18)
- `110-FR-003` — superseded by `1192-FR-004` (2026-10-22)
- `1191-FR-006` — superseded by `068-FR-006` (2026-10-23)
