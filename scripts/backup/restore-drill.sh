#!/usr/bin/env bash
# Restores one backup into a throwaway PostgreSQL and proves the API starts on
# it (.github/workflows/restore-drill.yml; locally under scripts/heavy.sh).
#
#   bash scripts/backup/restore-drill.sh [<key>]
#       <key> as staging/20261011T030012Z; none takes staging's newest. Reads
#       BACKUP_S3_BUCKET, BACKUP_GPG_PASSPHRASE and the bucket's
#       AWS_ENDPOINT_URL, AWS_REGION and AWS_* keys.
#   bash scripts/backup/restore-drill.sh --file <dump.gpg> --manifest <manifest.json>
#       a copy already on this machine; reads BACKUP_GPG_PASSPHRASE only.
#
# The throwaway runs postgres:<the backup's major version>, as staging does;
# DRILL_IMAGE names another (the local compose PostGIS image for a copy of a
# local database).
#
# Fails at the first step that does: a size that differs from the manifest's,
# a dump that does not decrypt, a restore error, a table whose row count
# differs, or an API not ready within 120 s. Prints each step's seconds and
# the total. The database, Redis, MinIO and the API are removed however it
# ends.

set -euo pipefail

DB=mf-restore-drill
REDIS=mf-restore-drill-redis
MINIO=mf-restore-drill-minio
API_PORT=3999

work=$(mktemp -d)
chmod 700 "$work"
api=
teardown() {
  if [ -n "$api" ]; then
    kill "$api" 2>/dev/null || true
    wait "$api" 2>/dev/null || true
  fi
  docker rm -f mf-restore-drill "$REDIS" "$MINIO" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap teardown EXIT

step_started=$SECONDS
step() {
  echo "$1 $((SECONDS - step_started))" >>"$work/steps"
  echo "drill: $1 done in $((SECONDS - step_started)) s"
  step_started=$SECONDS
}

if [ "${1:-}" = --file ]; then
  cp "$2" "$work/dump.gpg"
  cp "$4" "$work/manifest.json"
  label=$(basename "$2")
else
  key=${1:-}
  if [ -z "$key" ]; then
    key=$(aws s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix staging/ --output json \
      | jq -r '[.Contents[]?.Key | select(endswith(".manifest.json"))] | max // empty')
    key=${key%.manifest.json}
  fi
  if [ -z "$key" ]; then
    echo "drill failed: no backup in the bucket" >&2
    exit 1
  fi
  aws s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$key.manifest.json" "$work/manifest.json"
  aws s3 cp --only-show-errors "s3://$BACKUP_S3_BUCKET/$key.dump.gpg" "$work/dump.gpg"
  label=$key
fi
echo "drill: restoring $label"

expected=$(jq -r '.dump_size_bytes // empty' "$work/manifest.json")
actual=$(wc -c <"$work/dump.gpg" | tr -d ' ')
if [ -n "$expected" ] && [ "$expected" != "$actual" ]; then
  echo "drill failed: the copy is $actual bytes, its manifest says $expected" >&2
  exit 1
fi
step download

if ! gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 \
  --decrypt --output "$work/dump" "$work/dump.gpg" 3< <(printf '%s' "$BACKUP_GPG_PASSPHRASE"); then
  echo "drill failed: decryption failed" >&2
  exit 1
fi
step decrypt

major=$(jq -r '.server_version' "$work/manifest.json" | cut -d. -f1)
docker rm -f mf-restore-drill >/dev/null 2>&1 || true
docker run -d --name "$DB" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill "${DRILL_IMAGE:-postgres:$major}" >/dev/null
# Over TCP: the image's first-start server listens on its socket only.
for _ in $(seq 60); do
  docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres -d drill -q && break
  sleep 1
done
docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres -d drill -q
# From template0: an image that installs extensions into its databases (the
# compose PostGIS one) would otherwise clash with the dump's own CREATE lines.
docker exec "$DB" createdb -h 127.0.0.1 -U postgres -T template0 restored
docker exec -i "$DB" pg_restore -U postgres -d restored --no-owner --no-privileges --exit-on-error <"$work/dump"
rm -f "$work/dump"
step restore

docker exec -i "$DB" psql -X -q -A -t -v ON_ERROR_STOP=1 -U postgres -d restored >"$work/counts.json" <<'SQL'
SELECT coalesce(json_object_agg(
  table_name,
  (xpath('/row/c/text()', query_to_xml(
    format('SELECT count(*) AS c FROM public.%I', table_name), false, true, ''
  )))[1]::text::bigint
), '{}'::json)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
SQL
node scripts/backup.ts compare "$work/manifest.json" "$work/counts.json"
echo "drill: $(jq 'length' "$work/counts.json") tables hold the manifest's rows"
step compare

npx nx run api:build --configuration=production --skip-nx-cache >"$work/build.log" 2>&1 \
  || { tail -n 40 "$work/build.log" >&2; exit 1; }
step build

# Files are not in a backup: an empty bucket of the compose images lets the
# ready check's storage probe pass.
docker run -d --name "$REDIS" -p 127.0.0.1::6379 redis:7 >/dev/null
docker run -d --name "$MINIO" -p 127.0.0.1::9000 \
  -e MINIO_ROOT_USER=drill -e MINIO_ROOT_PASSWORD=drill-secret \
  pgsty/minio:RELEASE.2026-08-04T00-00-00Z server /data >/dev/null
docker run --rm --network "container:$MINIO" --entrypoint sh \
  pgsty/mc:RELEASE.2026-09-16T00-00-00Z -c \
  'until mc alias set local http://127.0.0.1:9000 drill drill-secret >/dev/null; do sleep 1; done && mc mb -q local/drill' >/dev/null
db_port=$(docker port "$DB" 5432/tcp | head -n 1 | cut -d: -f2)
redis_port=$(docker port "$REDIS" 6379/tcp | head -n 1 | cut -d: -f2)
minio_port=$(docker port "$MINIO" 9000/tcp | head -n 1 | cut -d: -f2)

(
  cd dist/apps/api
  exec env APP_ENV=test PORT=$API_PORT \
    DATABASE_URL="postgresql://postgres:drill@127.0.0.1:$db_port/restored" \
    REDIS_URL="redis://127.0.0.1:$redis_port" \
    AUTH_TOKEN_SECRET="drill-$RANDOM-$RANDOM" \
    STORAGE_ENDPOINT="http://127.0.0.1:$minio_port" STORAGE_REGION=us-east-1 \
    STORAGE_BUCKET=drill STORAGE_ACCESS_KEY_ID=drill STORAGE_SECRET_ACCESS_KEY=drill-secret \
    node main.js
) >"$work/api.log" 2>&1 &
api=$!

ready=
for _ in $(seq 120); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health/ready" 2>/dev/null; then
    ready=yes
    break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "drill failed: the API was not ready within 120 s" >&2
  tail -n 40 "$work/api.log" >&2
  exit 1
fi
step boot

node scripts/backup.ts report <"$work/steps"
