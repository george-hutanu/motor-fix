---
description: "Tasks: private file storage with signed uploads and downloads"
---

# Tasks: Private file storage with signed uploads and downloads

**Input**: `specs/422-private-file-storage/` — plan.md, spec.md, research.md, data-model.md, contracts/storage.md, context.md

**Tests**: required (constitution II, red first). Every FR maps to at least one test below; the mapping is listed at the end, not in the source.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Add `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner` 3.1146.0 to `package.json` dependencies and `package-lock.json`
- [ ] T002 [P] Create the Nx lib `libs/media` (new): `project.json` (name `media`, typecheck target like `libs/contracts/project.json`), `jest.config.cts` (jest-preset-angular, as `apps/web/jest.config.cts`), `tsconfig.json`, `tsconfig.lib.json`, `tsconfig.spec.json`, `src/test-setup.ts` (zoneless, as `apps/web/src/test-setup.ts`), `src/index.ts`; add `@motor-fix/media` to `tsconfig.base.json` paths; add `libs/media/**` to the `noRestrictedImports` override in `biome.json`
- [X] T003 [P] Add `minio` and a one-shot bucket-creating `minio-setup` service to `docker-compose.yml`; append `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` under an `# api, worker` comment in `.env.example`

## Phase 2: Foundational

- [X] T004 Write the in-process S3-protocol test store in `libs/domain/src/storage/s3-test-store.ts` (new): HEAD bucket; POST form upload verifying the SigV4 policy signature, expiry and every condition (`content-length-range`, `eq`, exact-match fields); presigned GET verifying signature and `X-Amz-Expires`, honouring `Range` and `response-content-disposition`; PUT (with `x-amz-copy-source` and `x-amz-copy-source-if-match`), HEAD and DELETE object; a settable clock for expiry tests
- [X] T005 [P] Write `FILE_RULES`, `FilePurpose`, `UPLOAD_URL_MINUTES = 15`, `DOWNLOAD_URL_MINUTES = 5`, `PUBLIC_IMAGE_URL_MINUTES = 60` in `libs/contracts/src/files.ts` (new) and export from `libs/contracts/src/index.ts`; purposes and limits exactly as data-model.md ("10 MB (10 485 760 bytes)")
- [X] T006 Append `STORAGE_ENV` (the five `STORAGE_*` names, `as const`) and its `StorageEnv` type to `libs/contracts/src/env.ts`; write `StorageModule.register(env: StorageEnv)` (global, exports `StorageService`) in `libs/domain/src/storage/storage.module.ts` (new) and the `S3Client` setup (path style, checksums `WHEN_REQUIRED`) in `libs/domain/src/storage/storage.service.ts` (new); export both and `SignedUpload` from `libs/domain/src/index.ts`

## Phase 3: User Story 1 — signed upload and confirm (P1)

**Independent test**: ask for an upload, post a real JPEG to the address, confirm, read the object at the final key.

- [X] T007 [P] [US1] Red tests in `libs/contracts/src/files.spec.ts` (new): the five purposes, their types and 10 MB limits
- [X] T008 [P] [US1] Red tests in `libs/domain/src/storage/storage.service.spec.ts` (new): refusals before signing (type → 422 `file_type_not_allowed`, size → 422 `file_too_large`, malformed size/purpose/owner id → 400); the address and fields accept the declared type and size, valid 15 minutes; the store refuses a larger file, another content type and another key; key shapes and no file name in any key; confirm moves to the final key and removes the incoming object; confirm of a mismatched signature deletes and answers 422 `file_type_mismatch`; oversized stored object deleted with 422 `file_too_large`; missing object and foreign key answer 409 `file_missing` and touch nothing; a replaced object during confirm is not moved
- [X] T009 [US1] Implement `createUpload` in `libs/domain/src/storage/storage.service.ts`: rule checks, key `incoming/<purpose>/<owner id>/<uuid>`, owner id `^[A-Za-z0-9_-]{1,64}$`, `createPresignedPost` with `content-length-range [1, size]`, `eq $Content-Type`, 900 s
- [X] T010 [US1] Implement `confirmUpload` in `libs/domain/src/storage/storage.service.ts`: prefix check, HEAD, size check, ranged GET of bytes 0–11 and signature match (JPEG, PNG, WebP, PDF), `CopyObject` with `CopySourceIfMatch`, delete incoming, return the final key

## Phase 4: User Story 2 — signed downloads (P1)

**Independent test**: store an object, fetch its download address within and after its lifetime.

- [X] T011 [P] [US2] Red tests in `libs/domain/src/storage/storage.service.spec.ts`: download address serves the file with the asked disposition and the RFC 6266 dual-form name (quotes, slashes, backslashes, control characters removed; non-ASCII `_` in `filename`, percent-encoded in `filename*`); refused after its lifetime; refused for another key; points at the store's endpoint
- [X] T012 [US2] Implement `createDownloadUrl(key, fileName, disposition, minutes)` in `libs/domain/src/storage/storage.service.ts`

## Phase 5: User Story 3 — server write and delete (P2)

- [X] T013 [P] [US3] Red tests in `libs/domain/src/storage/storage.service.spec.ts`: `putObject` writes to the given key and no address is signed; `deleteObject` removes an object and a second delete succeeds
- [X] T014 [US3] Implement `putObject` and `deleteObject` in `libs/domain/src/storage/storage.service.ts`

## Phase 6: User Story 5 — readiness (P2)

- [X] T015 [P] [US5] Red tests in `libs/domain/src/health/health.controller.spec.ts` and `health.adversary.spec.ts`: `checks.storage` is `ok` with the test store; 503 naming `storage` for a dead store and for a silent one within 3 s; documented keys include `storage`
- [X] T016 [US5] Implement `ready()` (HEAD bucket) in `libs/domain/src/storage/storage.service.ts`; inject `StorageService` into `libs/domain/src/health/health.service.ts` and add the storage check under `within`; add `storage` to `HealthChecksDto` in `libs/contracts/src/health.dto.ts`
- [X] T017 [US5] Wire `StorageModule.register(env)` into `apps/api/src/app.module.ts` and `readEnv(['DATABASE_URL', 'REDIS_URL', ...STORAGE_ENV])` into `apps/api/src/main.ts` and `apps/worker/src/main.ts` (worker root module imports `StorageModule` and `HealthModule`); pass storage env in `apps/api/src/bootstrap.spec.ts`; add the five names to the `openapi` target env in `apps/api/project.json`; run `npx nx run data-access:generate` so `apps/api/openapi.json` and `libs/data-access/src/lib` carry the storage check
- [X] T018 [P] [US5] Red test in `libs/contracts/src/env.spec.ts`: `readEnv(STORAGE_ENV, …)` returns the five values, and refuses each missing one by name without echoing any value (FR-010)

## Phase 7: User Story 4 — browser upload helper (P2)

- [ ] T019 [P] [US4] Red tests in `libs/media/src/file-uploader.spec.ts` (new), `HttpTestingController`: posts the fields then the file to the address and reports progress, then confirms and emits the result; retries a dropped connection 3 times then errors; on a 403 asks for one new address and uploads again; a second 403 errors; any other error status errors without retry
- [ ] T020 [US4] Implement `FileUploader` in `libs/media/src/file-uploader.ts` (new) and export from `libs/media/src/index.ts`

## Phase 8: Polish

- [ ] T021 Run quickstart.md validation: `npm run typecheck`, `npm run lint`, `npm test`, `sh scripts/contract-check.sh`

## Dependencies

- T001 → T004, T006; T002 → T019, T020; T005 → T006 → T009–T016.
- Red tests (T007, T008, T011, T013, T015, T018, T019) before their implementation tasks; they are committed with the slice that turns them green.
- US1 → US2/US3 (same service file, sequential); US5 after T006; US4 independent of the server side.

## Parallel examples

- T002, T003, T005 together; T007, T008, T019 together.

## Implementation strategy

MVP is US1 (upload and confirm); then downloads, server write and delete, readiness and wiring, then the helper. One commit per slice: rules + storage upload/confirm; downloads; write/delete; readiness + wiring + contract; helper lib.

## FR → test map

| FR | Test |
| --- | --- |
| FR-001 | `files.spec.ts` |
| FR-002 | `storage.service.spec.ts` › refusals before signing |
| FR-003 | `storage.service.spec.ts` › upload address (store refuses larger file, other type, other key) |
| FR-004 | `storage.service.spec.ts` › key shapes, no file name |
| FR-005 | `storage.service.spec.ts` › confirm (moves, mismatch, too large, missing, foreign key, replaced) |
| FR-006 | `storage.service.spec.ts` › download (disposition, name, expiry, other key, endpoint) |
| FR-007 | `storage.service.spec.ts` › server write |
| FR-008 | `storage.service.spec.ts` › delete twice |
| FR-009 | `health.controller.spec.ts`, `health.adversary.spec.ts` › storage |
| FR-010 | `env.spec.ts` › storage names; `bootstrap.spec.ts` boots with them |
| FR-011 | `storage.service.spec.ts` › refusal status and body `code` |
| FR-012 | `file-uploader.spec.ts` |
