# Research: Private file storage with signed uploads and downloads

## R1. S3 client and signing helpers

- **Decision**: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post` and `@aws-sdk/s3-request-presigner`, all 3.1146.0 (`npm view`, 2026-10-04), one `S3Client` per process with `forcePathStyle: true`, `requestChecksumCalculation: 'WHEN_REQUIRED'` and `responseChecksumValidation: 'WHEN_REQUIRED'`.
- **Rationale**: the Build brief names them as "the only new dependencies". Path-style addresses and checksums only when required are what S3-compatible providers other than AWS (MinIO, R2, Tigris) accept; the SDK's default CRC trailers are refused by several of them.
- **Alternatives considered**: hand-written SigV4 signing (rejected: it is the security-critical part, and the brief names the SDK); the `minio` client (rejected: a second S3 client, not in the brief).

## R2. Signed upload: form POST, not PUT

- **Decision**: `createPresignedPost` with conditions `content-length-range [1, declared size]`, `eq $Content-Type <declared type>`, the fixed `key`, expiry 900 s. Probe output (scratch, 2026-10-04) shows the policy carries `{"key":"incoming/x"}`, `["content-length-range",1,100]` and `["eq","$Content-Type","image/jpeg"]`.
- **Rationale**: only a POST policy lets the store itself refuse a file larger than the declared size (scenario 1, "A file too big for its address: the store refuses it, because the size is part of the signed form"). A presigned PUT cannot bound the size.
- **Alternatives considered**: presigned PUT with a signed `Content-Length` (rejected: browsers set the header themselves and providers differ on enforcing it).

## R3. The test store

- **Decision**: an in-process S3-protocol server written for the tests (`libs/domain/src/storage/s3-test-store.ts`, Node `http`, in memory), started by each storage and health spec on a free port. It verifies the POST policy (signature, expiry, every condition) and the presigned GET (signature and `X-Amz-Expires`), and serves HEAD, ranged GET, PUT, copy, DELETE and HEAD bucket.
- **Rationale**: the Build brief wants the API tests against "a real store, not a mock" (MinIO); this machine has no Docker and the build orchestrator directed an in-process store and never a real bucket. An HTTP server that checks signatures exercises the same SDK requests and the same signed conditions a provider checks.
- **Alternatives considered**: `s3rver` 3.7.1 (rejected: its POST handler marks `policy` as "unimplemented", so it cannot refuse an oversized upload, and it was last published in 2022); mocking the SDK client (rejected: Principle II forbids mocks of the store's protocol and it would not test the signed conditions); a MinIO binary (rejected: a download outside the orchestrator's directive).
- **Follow-up**: a MinIO service in CI pointed at by the same specs would check the store's behaviour against a real implementation; GitHub service containers cannot pass MinIO's `server /data` argument, so it needs a step, not a `services:` entry.

## R4. Signature sniffing at confirmation

- **Decision**: ranged GET of bytes 0–11, compared with JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`, PDF `%PDF-`. The declared type is the object's `Content-Type`, which the signed form fixed.
- **Rationale**: the brief: "reads only the first bytes, so it runs in the confirm call".

## R5. Move to the final key

- **Decision**: `CopyObject` from `incoming/<purpose>/<owner>/<id>` to `<purpose>/<owner>/<id>` with `CopySourceIfMatch` set to the ETag the `HEAD` returned, then `DeleteObject` on the incoming key. A precondition failure (412) answers `file_missing`; the replacement stays in `incoming/` for the life-cycle rule.
- **Rationale**: S3 has no rename. The incoming key carries purpose and owner so confirm can refuse a key that is not the caller's without a table.

## R6. Errors to the owning endpoint

- **Decision**: storage throws `UnprocessableEntityException({ code, message })` or `ConflictException({ code, message })`. This branch does not edit `apps/api/src/problem.filter.ts`: ST-79 (079-account-model) makes an `HttpException` carrying a `code` keep that code (orchestrator relay, 2026-10-04), and the owning endpoints that surface these refusals arrive after it merges.
- **Rationale**: the filter on `main` maps status to a fixed code (`CODE_BY_STATUS`, `problem.filter.ts:12-16`), so a 422 would leave as `error` until ST-79 merges; storage itself has no endpoint, so its tests assert the exception's status and body `code`.
- **Access checks**: storage has no controller and takes a plain owner id string; the owning use case runs ST-79's `ActorGuard`/`assertOwner`/`assertGarage` before calling it. No actor port is needed here.

## R7. Upload helper

- **Decision**: one Angular service in a new lib `libs/media` (`@motor-fix/media`), using `HttpClient` with `reportProgress` and `observe: 'events'`; it posts a `FormData` of the address's fields then the file, retries status 0 up to 3 times (1, 2, 4 s), asks for a new address once on a 403 from the store, then calls confirm.
- **Rationale**: the brief places it in `libs/media`; `HttpClient` is already in the web app's stack and its testing controller drives progress and failures without a browser.
