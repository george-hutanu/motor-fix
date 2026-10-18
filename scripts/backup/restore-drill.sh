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
# The throwaway runs the repository's own image at the backup's major version
# (infra/postgres: PostgreSQL with PostGIS, as staging runs), so a dump that
# holds the PostGIS extension restores; DRILL_IMAGE names another.
#
# Fails at the first step that does: a size that differs from the manifest's,
# a dump that does not decrypt, a restore error, a table whose row count
# differs, or an API not ready within 120 s. Prints each step's seconds and
# the total. The database, Redis, the object store and the API are removed however it
# ends.

set -euo pipefail

DB=mf-restore-drill
REDIS=mf-restore-drill-redis
STORE=mf-restore-drill-storage
API_PORT=3999

work=$(mktemp -d)
chmod 700 "$work"
api=
teardown() {
  if [ -n "$api" ]; then
    kill "$api" 2>/dev/null || true
    wait "$api" 2>/dev/null || true
  fi
  docker rm -f "$DB" "$REDIS" "$STORE" >/dev/null 2>&1 || true
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
docker rm -f "$DB" "$REDIS" "$STORE" >/dev/null 2>&1 || true
docker run -d --name "$DB" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill "${DRILL_IMAGE:-ghcr.io/george-hutanu/motor-fix-postgres:$major}" >/dev/null
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

# Uncached: the drill proves today's code builds and boots, not a cached build.
npx nx run api:build --configuration=production --skip-nx-cache >"$work/build.log" 2>&1 \
  || { tail -n 40 "$work/build.log" >&2; exit 1; }
step build

# Files are not in a backup: an empty bucket in the compose file's object
# store lets the ready check's storage probe pass. The store creates the
# bucket as it starts; its filer lists the bucket once it exists.
docker run -d --name "$REDIS" -p 127.0.0.1::6379 valkey/valkey:9 valkey-server --maxmemory-policy noeviction >/dev/null
docker run -d --name "$STORE" -p 127.0.0.1::8333 \
  -e AWS_ACCESS_KEY_ID=drill -e AWS_SECRET_ACCESS_KEY=drill-secret \
  chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d mini -bucket=drill \
  -dir=/data -admin.ui=false -webdav=false -master.telemetry=false >/dev/null
for _ in $(seq 60); do docker exec "$STORE" wget -q -O /dev/null http://127.0.0.1:8888/buckets/drill/ && break; sleep 1; done
docker exec "$STORE" wget -q -O /dev/null http://127.0.0.1:8888/buckets/drill/ || { echo "drill failed: the object store had no bucket within 60 s" >&2; exit 1; }
db_port=$(docker port "$DB" 5432/tcp | head -n 1 | cut -d: -f2)
redis_port=$(docker port "$REDIS" 6379/tcp | head -n 1 | cut -d: -f2)
store_port=$(docker port "$STORE" 8333/tcp | head -n 1 | cut -d: -f2)

(
  cd dist/apps/api
  exec env APP_ENV=test PORT=$API_PORT \
    DATABASE_URL="postgresql://postgres:drill@127.0.0.1:$db_port/restored" \
    REDIS_URL="redis://127.0.0.1:$redis_port" \
    AUTH_TOKEN_SECRET="drill-$RANDOM-$RANDOM" \
    STORAGE_ENDPOINT="http://127.0.0.1:$store_port" STORAGE_REGION=us-east-1 \
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
