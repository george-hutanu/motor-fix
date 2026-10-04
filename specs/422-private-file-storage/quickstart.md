# Quickstart: validate private file storage

## Prerequisites

- PostgreSQL and Redis reachable (`DATABASE_URL`, `REDIS_URL`), as for every API test.
- No object store needed for the tests: the storage and health specs start their own in-process S3-protocol store.

## Run

```sh
npx jest libs/contracts/src/files.spec.ts
npx jest libs/domain/src/storage
npx jest libs/domain/src/health
npx nx test media
npm run typecheck && npm run lint
sh scripts/contract-check.sh   # openapi.json and the generated client include the storage check
```

Expected: all green; `storage.service.spec.ts` covers type and size refusals, the store refusing an oversized upload, confirm moving the file, a mismatched signature deleted, a missing object answered 409, an expired download refused, double delete, and no file name in any key; the health specs answer 503 naming `storage` for a dead or silent store.

## Local development against MinIO

```sh
docker compose up -d   # postgres, redis, minio (creates the motorfix bucket)
# .env
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=eu-central-1
STORAGE_BUCKET=motorfix
STORAGE_ACCESS_KEY_ID=motorfix
STORAGE_SECRET_ACCESS_KEY=motorfix-secret
```

`curl -s localhost:3000/health/ready` shows `"storage":"ok"`.
