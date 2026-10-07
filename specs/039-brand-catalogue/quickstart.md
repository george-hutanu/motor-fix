# Quickstart: prove the brand catalogue works

Prerequisites: Docker (PostgreSQL and Redis from `docker-compose.yml`), Node 24, `npm ci` done, `.env` from `.env.example` (`DATABASE_URL`, `REDIS_URL`, `AUTH_TOKEN_SECRET`). Heavy commands go through `scripts/heavy.sh`.

## 1. Migrate and boot

```sh
docker compose up -d --wait postgres redis minio
npx prisma migrate deploy --config libs/domain/prisma.config.ts
npx prisma generate --config libs/domain/prisma.config.ts
sh scripts/heavy.sh npx nx serve api
```

Expected: the API logs the loader's result once at boot (`brands loaded: 12 created` on an empty database, `brands loaded: 0 changes` on the next boot) and then listens.

## 2. Search as a visitor (no token)

```sh
curl -s 'http://localhost:3000/api/v1/brands?q=sko' | jq .
curl -s 'http://localhost:3000/api/v1/brands?q=%C5%A0KODA' | jq '.items[].name'
curl -s 'http://localhost:3000/api/v1/brands' | jq '{n: (.items|length), first: .items[0].name, total}'
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/v1/brands?cursor=00000000-0000-4000-8000-000000000000'
```

Expected: 200 with Škoda in the first two; the third lists 12 items, `first: "BMW"`, `total: 12`; the fourth prints `400` (`invalid_cursor`). Every other new route is refused with 401 `sign_in_required` (none is added by this task).

## 3. Cache

```sh
docker compose exec redis redis-cli TTL brands:active     # ≤ 3600 after a search
```

Change a name in `libs/domain/src/catalogue/brands.ts`, restart the API: the key is gone (`-2`), the next search shows the new name, and `activity_log` has one `update` entry with `subject_type = 'brand'`, `actor_role = 'system'`, `actor_name = 'MotorFix'`.

## 4. Garage rules (SQL or the service's integration spec)

```sql
INSERT INTO garage_brand (garage_id, brand_id, stance) SELECT g.id, b.id, 'does_not_take' FROM garage g, brand b WHERE g.slug = 'atelier-test' AND b.slug = 'tesla';
UPDATE garage_brand SET petrol = true WHERE stance = 'does_not_take';   -- refused: garage_brand_fuel_check
UPDATE garage SET brand_note = repeat('x', 141) WHERE slug = 'atelier-test';  -- refused: garage_brand_note_check
```

## 5. Tests

```sh
sh scripts/heavy.sh npx nx run-many -t test -p contracts domain api > /tmp/039-test.log 2>&1; echo "exit $?"; tail -n 40 /tmp/039-test.log
```

Specs this feature adds and that must pass: `libs/contracts/src/brands.dto.spec.ts`, `libs/domain/src/catalogue/brands.spec.ts`, `brand-loader.integration.spec.ts`, `brands.api.integration.spec.ts`, `libs/domain/src/garages/garage-brands.service.integration.spec.ts`, and `apps/api/src/public-routes.integration.spec.ts` with `GET /api/v1/brands` in its list. Then the contract:

```sh
sh scripts/heavy.sh npx nx run data-access:generate && git status --porcelain -- apps/api/openapi.json libs/data-access/src/lib
```

Expected: the regenerated document and client are committed (empty status after the commit); `scripts/contract-check.sh` is what CI runs.
