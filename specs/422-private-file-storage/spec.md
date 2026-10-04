# Feature Specification: Private file storage with signed uploads and downloads

**Feature Branch**: `422-private-file-storage`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-422 Private file storage with signed uploads and downloads (Notion story ST-422 https://app.notion.com/p/3ee607bff0d2815393e8ffeeca814408, epic Foundations EP-1 https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). Build what the story's Build brief says; the EP-2 listing form photos and documents will use it."

**Sources**: the Notion story ST-422 (acceptance criteria and Build brief, read 2026-10-04; the story has no comments or discussions), its epic [Foundations (EP-1)](https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), `.specify/memory/constitution.md` v1.1.0, and this repository at `origin/main` 3f717c6. The Build brief wins where it and the acceptance criteria differ.

The users of this story are the other modules of MotorFix, not a person: no person calls file storage directly. An owning use case (listing photos, legal documents, message photos, repair invoices, later job media) decides who may upload or see a file, and only then asks storage for a signed address. Storage never decides permissions.

## Clarifications

### Session 2026-10-04

- Q: Does the in-process S3 store satisfy the brief's "against a real store, not a mock"? → A: It is the test store for this branch: an S3-protocol server over HTTP that verifies signatures and the signed form's conditions, so the SDK's real requests are exercised. It is not a mock of the client. MinIO in CI is a follow-up (orchestrator directive "in-process fake/adapter, never a real bucket"; no Docker on this machine; s3rver does not enforce POST policies; `.skip` is not allowed). The local code is justified in the plan's Complexity Tracking.
- Q: Does the upload helper retry for as long as the page is open, or 3 times? → A: 3 times for a dropped connection, and one fresh address after an expiry, then an error (Build brief acceptance scenario 3, which is the testable statement). The owning screen keeps the file and lets the person try again. The brief's "keeps the file queued and retries while the page stays open" (States and errors) is recorded as a contradiction for the owner.
- Q: What does confirm take, and what is the incoming key? → A: The key, the purpose and the owner id. The declared type is the object's `Content-Type`, which the signed form pinned. The incoming key is `incoming/<purpose>/<owner id>/<random id>`; the final key drops `incoming/` and keeps the same random id.
- Q: Does the server write take a purpose or a raw key? → A: A raw key, as the Build brief's interface `putObject(key, body, contentType)` says. Worker files (day sheets, exports) get their purposes and key prefixes from the stories that make them.
- Q: Which `Content-Disposition` form makes a file name "safe"? → A: RFC 6266 dual form, `<disposition>; filename="<ascii>"; filename*=UTF-8''<percent-encoded>`. Quotes, slashes, backslashes and control characters are removed from both. Non-ASCII letters are replaced by `_` in the ASCII form and kept, percent-encoded, in `filename*`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An owning use case gets a signed upload address and confirms the upload (Priority: P1)

A garage owner adds a workshop photo in the listing form. The listing use case checks the caller, then asks storage for an upload address for purpose `garage_photo`, the declared type and the declared size. The browser sends the file straight to storage. The use case then confirms the upload; storage checks the file and moves it to its final key, which the owning row stores.

**Why this priority**: every launch file (listing photos, legal documents, message photos, repair invoices) arrives this way. Nothing in EP-2 that takes a file can be built without it.

**Independent Test**: ask for an upload for an allowed type and size, post a real JPEG to the returned address, confirm it, and read the object back at the returned final key.

**Acceptance Scenarios**:

1. **Given** an owning use case has checked the caller, **When** it asks for an upload for purpose `garage_photo`, type `image/jpeg`, size 3 MB, **Then** storage returns the key, a signed upload address valid 15 minutes and the form fields, and the address accepts only that key, that content type and at most the declared size.
2. **Given** a declared type or size outside the purpose's rules (`application/zip` for a garage photo, or 12 MB where the limit is 10 MB), **When** an upload is asked for, **Then** no address is issued and the answer is 422 with code `file_type_not_allowed` or `file_too_large`.
3. **Given** a signed upload address for a declared size, **When** a file larger than that size is sent to it, **Then** the store refuses it.
4. **Given** a file uploaded to its `incoming/` key, **When** the owning use case confirms it, **Then** storage checks that the object exists, that its size is within the purpose's limit and that its first bytes match the declared type (JPEG, PNG, WebP or PDF signature), moves it to `<purpose>/<owner id>/<random id>`, and returns that key; the `incoming/` object no longer exists.
5. **Given** a file whose first bytes do not match its declared type (an executable sent as `image/jpeg`), **When** it is confirmed, **Then** the object is deleted and the answer is 422 with code `file_type_mismatch`.
6. **Given** a key that holds no object, **When** it is confirmed, **Then** the answer is 409 with code `file_missing`.

---

### User Story 2 - An allowed person opens a private file through a short-lived address (Priority: P1)

A garage owner opens its own legal document. The owning use case checks the caller, then asks storage for a download address for that one file.

**Why this priority**: files are private; a driver or garage sees a photo or document only through an address that expires.

**Independent Test**: store an object, ask for a download address, fetch it within its lifetime, then fetch it after its lifetime.

**Acceptance Scenarios**:

1. **Given** a stored file, **When** a download address is asked for with a file name and `attachment`, **Then** storage returns an address on the storage provider's domain, valid 5 minutes, that serves that one file with a safe file name and the asked disposition.
2. **Given** a download address, **When** it is used after its lifetime, **Then** the store refuses it.
3. **Given** an image shown on a public page, **When** its address is asked for with the public-image lifetime, **Then** the address is valid 60 minutes.
4. **Given** a download address for one file, **When** its path is changed to another key, **Then** the store refuses it.

---

### User Story 3 - The worker saves a file it made, and any module deletes a file (Priority: P2)

The worker makes a day-sheet PDF and writes it straight to its final key. An owning use case removes a photo; storage deletes the object.

**Why this priority**: needed by later stories (day sheets, data downloads) and by every owning use case that replaces or removes a file; nothing at launch depends on the worker write yet.

**Independent Test**: write an object from the server, read it back; delete it twice.

**Acceptance Scenarios**:

1. **Given** the worker has made a file, **When** it saves it, **Then** it is written to the final key from the server and no upload address is signed.
2. **Given** a stored file, **When** an owning use case deletes its key, **Then** the object is gone; **When** the same key is deleted again, **Then** that is not an error.

---

### User Story 4 - The browser uploads with progress and recovers from a dropped connection (Priority: P2)

The owning screen hands the upload helper a file, the owning endpoint's "ask for an address" call and its "confirm" call. The helper sends the file straight to storage, reports progress, retries a dropped connection, and finally calls confirm.

**Why this priority**: the listing photos, legal documents, message photos and invoices all use it, so it is written once here; the first screen that uses it is EP-2's listing form.

**Independent Test**: drive the helper against a test HTTP backend: one clean upload, one with dropped connections, one with an expired address.

**Acceptance Scenarios**:

1. **Given** a file and an upload address, **When** the helper uploads it, **Then** it posts the address's form fields and the file straight to the address, reports progress, then calls confirm with the key and returns confirm's result.
2. **Given** the connection drops, **When** the helper is uploading, **Then** it retries up to 3 times before failing with an error the owning screen shows.
3. **Given** the store refuses the address because it expired, **When** the helper is uploading, **Then** it asks the owning endpoint for a new address once, uploads again, and if that also fails it gives up with an error.

---

### User Story 5 - Operations sees when storage is down (Priority: P2)

**Why this priority**: a store that is down must be visible on the readiness check the platform already has, without stopping the rest of MotorFix.

**Independent Test**: point the `api` and `worker` readiness check at an unreachable store.

**Acceptance Scenarios**:

1. **Given** the store answers, **When** `GET /health/ready` is called on the `api` or the `worker`, **Then** it answers 200 with `storage: ok` alongside `postgres` and `redis`.
2. **Given** the store is unreachable or never answers, **When** `GET /health/ready` is called, **Then** it answers 503 naming `storage` within 2 seconds plus the existing margin.

### Edge Cases

- A declared size of 0, a negative size or a non-integer size: refused before signing, no address issued.
- A purpose the rules table does not name: refused before signing.
- An owner id that is not a plain identifier (contains `/`, spaces or more than 64 characters): refused, so a key can never be steered outside its prefix.
- Confirming a key that belongs to another purpose or owner, or a key not under `incoming/`: answered as `file_missing`, and nothing is moved or deleted.
- An object larger than the purpose's limit that reaches `incoming/` anyway: deleted at confirmation, `file_too_large`.
- A file name with quotes, slashes, control characters or non-ASCII letters in a download: the served name is safe and still readable.
- An object that is empty or shorter than any signature: `file_type_mismatch`, deleted.
- The store is down while signing: signing still works (it needs no network); the upload then fails in the browser and the helper reports the error.
- The store is down during a confirm, a delete or a server write: the call fails with the store's error (the owning endpoint answers 500 `internal_error`), and no object is moved or deleted that the call had not already finished with; repeating the call is safe.
- The `incoming/` object is replaced through the still-valid upload address while it is being confirmed: the replacement is not moved unchecked.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep one table of file purposes and their rules, shared by the API, the worker and the web app: `garage_photo`, `message_photo` and `mechanic_photo` take JPEG, PNG or WebP up to 10 MB; `legal_document` and `repair_invoice` take PDF, JPEG or PNG up to 10 MB.
- **FR-002**: Before issuing an upload address, storage MUST refuse a declared type the purpose does not allow (422, `file_type_not_allowed`) and a declared size above the purpose's limit (422, `file_too_large`), and MUST refuse with 400 (`validation_failed`) a size that is not a positive whole number of bytes, an unknown purpose and an owner id that is not 1 to 64 letters, digits, `_` or `-`.
- **FR-003**: An upload address MUST be signed for 15 minutes, for one key under `incoming/`, and MUST let the store accept only that key, the declared content type and at most the declared size.
- **FR-004**: Every key storage issues for an upload MUST be `incoming/<purpose>/<owner id>/<random id>`, and its final key `<purpose>/<owner id>/<random id>` with the same random id; neither MUST contain the original file name or any other personal data.
- **FR-005**: Confirming an upload takes the key, the purpose and the owner id, and MUST check that the object exists (else 409, `file_missing`), that its size is within the purpose's limit (else delete it, 422, `file_too_large`) and that its first bytes match the JPEG, PNG, WebP or PDF signature of its stored content type (else delete it, 422, `file_type_mismatch`); then move exactly the object it checked (an object replaced at the same key during the checks is not moved, and the confirm answers `file_missing`) to its final key, remove the `incoming/` object, and return the final key. A key outside the given purpose and owner's `incoming/` prefix MUST be answered `file_missing` without touching any object. A key whose final key already holds a file (a form replayed after its confirmation) MUST be answered `file_missing`, and the confirmed file MUST NOT be replaced.
- **FR-006**: A download address MUST be signed for the lifetime the owning use case passes (5 minutes for private files, 60 minutes for public images; a lifetime that is not a positive number of minutes is refused), for one key only, point at the storage provider's address, and make the store serve the file `inline` or as an `attachment`, with a file name in RFC 6266 dual form (`filename="<ascii>"; filename*=UTF-8''<encoded>`) from which quotes, slashes, backslashes and control characters are removed.
- **FR-007**: The server MUST be able to write a file straight to its final key without signing an upload address.
- **FR-008**: Deleting a key MUST remove the object, and deleting a key that holds no object MUST succeed.
- **FR-009**: `api` and `worker` MUST answer `GET /health/ready` with `checks` for `postgres`, `redis` and `storage` (the bucket answers; the storage check gives up after 2 seconds on its own too), each limited to 2 seconds and run in parallel, the deployed commit SHA as `version`, 200 when all are `ok` and 503 naming each failed check otherwise.
- **FR-010**: One configuration module MUST read and check the environment at start; a missing required variable MUST stop the process and log the variable's name only, never a value. Required: `api` and `worker` — `APP_ENV`, `DATABASE_URL`, `REDIS_URL`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; `web` — `APP_ENV`, `API_INTERNAL_URL`, `PUBLIC_WEB_URL`; `mcp` — `APP_ENV`. With defaults: `PORT` (set by Railway; a fixed port per app locally) and `RELEASE_SHA` (`dev`). The storage keys MUST NOT be sent to the browser.
- **FR-011**: The refusals in FR-002 and FR-005 MUST be raised as HTTP errors with status 422 or 409 whose body carries the stable `code`, so the owning endpoint answers with that status and code. (The API's error filter keeping a carried `code` is delivered by ST-79, not here.)
- **FR-012**: The browser upload helper MUST post the file and the address's form fields straight to the store, report progress, retry a dropped connection up to 3 times, ask for a new address once when the store refuses an expired one, then call the owning confirm call and return its result, or fail with an error.

## Spec Delta

### Capability: `storage`

- **Adds**: FR-001–FR-008, FR-011, FR-012

### Capability: `platform`

- **Modifies**: `421-FR-013` → `FR-009`, `421-FR-021` → `FR-010`

### Key Entities

- **File purpose**: a named kind of file (`garage_photo`, `legal_document`, `message_photo`, `repair_invoice`, `mechanic_photo`) with its allowed types and largest size.
- **Upload address**: the signed address, its form fields and the `incoming/` key, valid 15 minutes.
- **Stored file**: an object at `<purpose>/<owner id>/<random id>`. Its key is stored on the owning row (outside this story); storage has no table of its own.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every test the Build brief lists for this story passes against an S3-protocol store over HTTP (type and size refusal, oversized upload refused by the store, confirm moves the file, signature mismatch deleted, missing object answered 409, expired download refused, double delete succeeds, readiness 503 naming `storage`, no key holds the file name).
- **SC-002**: 0 bytes of an uploaded file pass through the API: the browser sends every file to the store's address.
- **SC-003**: The readiness check reports a dead or silent store in under 3 seconds (2-second limit from the Build brief, plus the margin the existing health tests already allow).

## Assumptions

- The provider is still open in Notion (`[NEEDS CLARIFICATION]` in the Build brief's Open section). The code speaks only the S3 protocol with path-style addresses, so the provider is a configuration value; this story does not choose it. *(autonomous default)*
- Bucket settings are provisioning outside the code (Build brief, "Depends on: Outside the code"): private, EU region, versioning on, `incoming/` objects deleted after 24 hours, old versions after 30 days, browser uploads only from the environment's own web address, no shared bucket or keys between staging and production. They are recorded for the owner in the plan and are not built here, because no provider exists yet to apply them to. *(autonomous default)*
- Address lifetimes (15, 5, 60 minutes) are constants next to the rules table, not environment variables: nothing asks to vary them per environment (Principle I). *(autonomous default)*
- The upload helper waits 1, 2 and 4 seconds between its 3 retries (see Clarifications). *(autonomous default)*
- The upload address's size limit is the declared size, not the purpose's limit, so the store refuses anything larger than what was declared (Build brief, scenario 1). *(autonomous default)*
- Local development gets an S3-compatible store (MinIO) in `docker-compose.yml` with the same bucket name (Build brief, scenario 13); it is not verified on this machine, which has no Docker. *(autonomous default)*
- Who may upload or see each file, how many files an owner keeps, resizing and metadata removal, clip processing and backups are out of scope (Build brief, Out of scope).
