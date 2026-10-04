# Implementation Plan: Private file storage with signed uploads and downloads

**Branch**: `422-private-file-storage` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/422-private-file-storage/spec.md`

## Summary

A global Nest `StorageModule` in `libs/domain` gives owning use cases signed upload forms (S3 POST policy bound to one key, one type and the declared size), a confirm step that checks existence, size and the file's first bytes before moving it from `incoming/` to its final key, signed download addresses with a safe RFC 6266 file name, a server write, an idempotent delete and a ready check that joins `/health/ready` on the `api` and the `worker`. The purposes and their rules live in `FILE_RULES` in `libs/contracts`. A new Angular lib `libs/media` holds the browser upload helper. Tests run against an in-process S3-protocol store over HTTP.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node ≥ 24 (`package.json` engines; `.nvmrc` 24).

**Primary Dependencies**: NestJS 12.1.2, `@nestjs/swagger` 12.0.2, Angular 22.2.1 (`@angular/common/http` for the helper), RxJS 7.8.2 (`package.json`). New: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner` 3.1146.0 (`npm view`, 2026-10-04) — the only new dependencies, as the Build brief says.

**Storage**: S3-compatible object storage, one private bucket per environment, path-style addresses. Provider `[NEEDS CLARIFICATION: which S3-compatible EU provider — Build brief Open; owner with the build lead]`; the code takes it as configuration. No PostgreSQL table (data-model.md).

**Testing**: Jest 30.5.2 from the root config (`jest.config.ts`, `getJestProjectsAsync`); `ts-jest` for `libs/domain` and `libs/contracts` (`libs/domain/jest.config.cts`), `jest-preset-angular` 17.0.1 for `libs/media` (as `apps/web/jest.config.cts`). Storage and health specs start the in-process S3 store; health specs also need PostgreSQL and Redis (`DATABASE_URL`, `REDIS_URL`).

**Target Platform**: `api` and `worker` on Node (Railway, EU); the helper in the browser through the Angular SSR `web` app.

**Project Type**: Nx monorepo libs (`nx.json`): `libs/contracts`, `libs/domain`, new `libs/media`.

**Performance Goals**: signing is local (no network call); confirm reads 12 bytes.

**Constraints**: ready check limited to 2 s (`libs/domain/src/health/health.service.ts:16`, `LIMIT_MS`); file bytes never pass through the API (Notion System overview); keys never hold personal data; secrets never echoed (`libs/contracts/src/env.ts:10`).

**Scale/Scope**: 5 purposes, 10 MB each (Build brief, Rules and validation).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one service, no interface layer, no table. The address lifetimes are constants, not knobs. There is no `SignedUploadDto`: no endpoint in this story returns one, so the first owning endpoint (EP-2) adds it. One justified exception, the in-process test store, is listed under Complexity Tracking.
- [x] **II. Test Discipline**: red specs first, colocated (`storage.service.spec.ts`, `files.spec.ts`, `file-uploader.spec.ts`, health specs). Health specs use real PostgreSQL and Redis. The object store is an S3-protocol server over HTTP, not a client mock (spec Clarifications Q1). No Playwright test of its own: the Build brief puts the first end-to-end upload in EP-2.
- [x] **III. The Given Stack**: Nest providers, Angular `HttpClient`.
- [x] **IV. One Repository, One Toolchain**: new lib `libs/media` with the existing Jest preset and root Biome. Its only Biome change is adding it to the existing `noRestrictedImports` override that keeps `@motor-fix/domain` out of browser code.
- [x] **V. Rules Live in One Place**: `FILE_RULES` is the single rules table. Storage decides no permission; owning use cases call ST-79's guards first. The `/health/ready` shape change flows through `HealthChecksDto` into `openapi.json` and the generated client (`data-access:generate`).
- [x] **VI. PostgreSQL Is the Truth**: storage changes no PostgreSQL state and emits no event (Build brief, Events).
- [x] **Notion choices**: signed uploads (A12, Proposed) are confirmed here. The provider is `[NEEDS CLARIFICATION]` (Build brief Open, T1 hosting); retention of old versions waits on T10. Both are provisioning, outside the code.

Re-check after design: unchanged.

## Design

- **Config** (`libs/contracts/src/env.ts` appends `STORAGE_ENV`, the name list both `main.ts` files spread into `readEnv`, and `StorageModule.register` takes the resulting record directly — no mapping layer): `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. `readEnv` already refuses missing values and never echoes them (FR-010).
- **Rules** (`libs/contracts/src/files.ts`): `FILE_RULES`, `FilePurpose`, `UPLOAD_URL_MINUTES`, `DOWNLOAD_URL_MINUTES`, `PUBLIC_IMAGE_URL_MINUTES`.
- **Storage** (`libs/domain/src/storage/`): `StorageModule.register(options)` (global, exports `StorageService`); `StorageService` as in contracts/storage.md. Refusals are Nest `HttpException`s whose body carries `code` (research R6).
- **Health**: `HealthService` injects `StorageService` and adds `storage: within(storage.ready())`; `HealthChecksDto` gains `storage`. `HealthModule.register` is unchanged; the api's `AppModule` and the worker's root module import `StorageModule.register` beside it.
- **Helper** (`libs/media/src/file-uploader.ts`): `FileUploader.upload(file, ask, confirm)`.
- **Local dev**: `docker-compose.yml` gains `minio` plus a one-shot `mc` service that creates bucket `motorfix`; `.env.example` gains the 5 names.

## Outside the code (owner, per environment)

These are not built here: the provider is open, and the build never creates cloud resources.

- One private S3-compatible bucket per environment in an EU region, with its own access keys. Staging and production never share either.
- Bucket settings: no public listing or reading; versioning on; a life-cycle rule deleting `incoming/` objects after 24 hours; old versions deleted after 30 days (pending T10); CORS allowing `POST` only from the environment's own `PUBLIC_WEB_URL`.
- Railway variables for `api` and `worker`: `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`. Without them, both apps refuse to start (FR-010).

## Project Structure

### Documentation (this feature)

```text
specs/422-private-file-storage/
├── plan.md  research.md  data-model.md  quickstart.md  contracts/storage.md
├── context.md  design.md  auto-run.md  notion-sync.md  checklists/
└── tasks.md
```

### Source Code (repository root)

```text
libs/contracts/src/
├── files.ts                 (new) FILE_RULES, lifetimes
├── files.spec.ts            (new)
├── health.dto.ts            storage check
└── index.ts                 export files
libs/domain/src/
├── storage/                 (new)
│   ├── storage.module.ts
│   ├── storage.service.ts
│   ├── storage.service.spec.ts
│   └── s3-test-store.ts     in-process S3-protocol store for specs
├── health/                  health.service.ts + specs: storage check
└── index.ts                 export storage
libs/media/                  (new Nx lib, Angular)
├── project.json  jest.config.cts  tsconfig*.json
└── src/ index.ts  file-uploader.ts  file-uploader.spec.ts  test-setup.ts
apps/api/src/app.module.ts, main.ts       StorageModule, env names
apps/api/src/bootstrap.spec.ts            storage env for AppModule
apps/api/openapi.json, libs/data-access/  regenerated
apps/worker/src/main.ts                   StorageModule, env names
tsconfig.base.json, biome.json, package.json, package-lock.json, .env.example, docker-compose.yml
```

**Structure Decision**: storage is a platform module in `libs/domain` beside `health`, and the helper is a browser lib (the Build brief and the Front end architecture page both name `libs/media`).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Local test infrastructure: an in-process S3-protocol store (`s3-test-store.ts`, ~200 lines) | The Build brief's tests need a store that refuses an oversized upload and an expired address. Here there is no Docker, and the orchestrator forbids real buckets. | `s3rver` ignores the POST policy (it cannot refuse an oversized upload) and is unmaintained. Mocking the SDK would test nothing the store enforces. A MinIO binary download is outside the directive. |
| New Nx lib `libs/media` for one service | The Build brief and the Front end architecture page place the upload helper there. Four EP-2 screens use it. | Putting it in `apps/web` (rejected: the listing, document, message and invoice screens live in later feature areas that import libs, and the architecture page names the lib). |
