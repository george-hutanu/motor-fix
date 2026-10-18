#!/usr/bin/env bash
# Restores a write-ahead-log archive to a moment, into a throwaway PostgreSQL
# on this machine, and proves it stopped there (.github/workflows/pitr-drill.yml;
# locally under scripts/heavy.sh).
#
#   bash scripts/backup/pitr-drill.sh --self-contained
#       starts its own source database archiving to an object store on this
#       machine; needs no setting.
#   bash scripts/backup/pitr-drill.sh
#       staging: the archive the staging PostgreSQL writes, read with
#       WAL_ARCHIVE_BUCKET, WAL_ARCHIVE_ENDPOINT, WAL_ARCHIVE_REGION,
#       WAL_ARCHIVE_KEY and WAL_ARCHIVE_SECRET; the markers are written over
#       `railway ssh` with RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID and
#       RAILWAY_SERVICE_POSTGRES, as backup.sh reaches the service.
#
# The image does the archiving and the restore (infra/postgres/README.md); this
# script only drives it. It commits two empty transactions on the source, the
# target being the first one's commit time, waits until the archive holds the
# second, restores a sibling to the target and checks that the first is
# committed there and the second is not. It prints how long the second commit
# took to reach the archive (the data at risk, at most 15 min) and how long
# the restore took, and fails at the first check that does. Everything it
# started is removed however it ends.

set -euo pipefail

IMAGE=${DRILL_IMAGE:-ghcr.io/george-hutanu/motor-fix-postgres:18}
NET=mf-pitr-drill
SOURCE=mf-pitr-drill-source
STORE=mf-pitr-drill-store
SIBLING=mf-pitr-drill-sibling
MAX_LAG_SECONDS=900
READY_SECONDS=600

mode=staging
[ "${1:-}" = --self-contained ] && mode=self-contained

work=$(mktemp -d)
teardown() {
  docker rm -f -v "$SIBLING" "$SOURCE" "$STORE" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap teardown EXIT
teardown
mkdir -p "$work" && chmod 700 "$work"
docker network create "$NET" >/dev/null

step_started=$SECONDS
step() {
  echo "$1 $((SECONDS - step_started))" >>"$work/steps"
  echo "drill: $1 done in $((SECONDS - step_started)) s"
  step_started=$SECONDS
}
fail() {
  echo "drill failed: $*" >&2
  exit 1
}
# Runs the command every `pause` seconds until it succeeds, for at most
# `limit` seconds by the clock however long each try takes.
until_within() {
  local limit=$1 pause=$2 deadline
  shift 2
  deadline=$((SECONDS + limit))
  until "$@"; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$pause"
  done
}

# One SQL statement on the source, its single value printed.
source_sql() {
  if [ "$mode" = self-contained ]; then
    docker exec "$SOURCE" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -c "$1"
  else
    printf '%s\n' "$1" | railway ssh --project "$RAILWAY_PROJECT_ID" --environment "$RAILWAY_ENVIRONMENT_ID" \
      --service "$RAILWAY_SERVICE_POSTGRES" -- \
      sh -c 'psql -X -q -A -t -v ON_ERROR_STOP=1 -U "${PGUSER:-${POSTGRES_USER:-postgres}}" -d "${PGDATABASE:-${POSTGRES_DB:-postgres}}"' \
      | tr -d '\r'
  fi
}

# Every container reads the archive's credentials from this environment by
# name (`-e NAME`), so no key or secret is ever on a command line.
archive_env=()
if [ "$mode" = self-contained ]; then
  # pgBackRest talks to S3 over TLS only: the store gets a certificate signed
  # by a throwaway authority the source and the sibling trust.
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=drill-ca \
    -keyout "$work/ca.key" -out "$work/ca.crt" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$STORE" -keyout "$work/store.key" -out "$work/store.csr" 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$STORE" >"$work/san"
  openssl x509 -req -in "$work/store.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial \
    -days 1 -extfile "$work/san" -out "$work/store.crt" 2>/dev/null
  # The store runs as this user, so it reads a key no one else can (the
  # image would otherwise drop from root to its own user, who could not); the
  # source and the sibling read only the authority's certificate.
  chmod 644 "$work"/*.crt
  chmod 600 "$work"/*.key
  chmod 755 "$work"

  docker run -d --name "$STORE" --network "$NET" -v "$work:/certs:ro" --user "$(id -u):$(id -g)" --tmpfs /data:mode=1777 \
    -e AWS_ACCESS_KEY_ID=drill -e AWS_SECRET_ACCESS_KEY=drill-secret \
    chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d \
    mini -dir=/data -bucket=pitr -admin.ui=false -webdav=false -master.telemetry=false \
    -s3.port.https=8443 -s3.cert.file=/certs/store.crt -s3.key.file=/certs/store.key >/dev/null
  store_ready() { docker exec "$STORE" wget -q -O /dev/null http://127.0.0.1:8888/buckets/pitr/ 2>/dev/null; }
  until_within 60 1 store_ready || fail "the object store had no bucket within 60 s"

  export WAL_ARCHIVE_BUCKET=pitr WAL_ARCHIVE_ENDPOINT=$STORE WAL_ARCHIVE_REGION=us-east-1
  export WAL_ARCHIVE_KEY=drill WAL_ARCHIVE_SECRET=drill-secret
  archive_env=(-e WAL_ARCHIVE_BUCKET -e WAL_ARCHIVE_ENDPOINT -e WAL_ARCHIVE_REGION -e WAL_ARCHIVE_KEY -e WAL_ARCHIVE_SECRET)
  tls_env=(-v "$work/ca.crt:/certs/ca.crt:ro" -e PGBACKREST_REPO1_STORAGE_PORT=8443 -e PGBACKREST_REPO1_STORAGE_CA_FILE=/certs/ca.crt)

  docker run -d --name "$SOURCE" --network "$NET" -e POSTGRES_PASSWORD=drill \
    ${archive_env[@]+"${archive_env[@]}"} ${tls_env[@]+"${tls_env[@]}"} "$IMAGE" >/dev/null
  source_up() { source_sql 'SELECT 1' >/dev/null 2>&1; }
  until_within 120 1 source_up || fail "the source database did not start within 120 s"
  repo_path=$(docker exec "$SOURCE" sh -c 'cat "$PGDATA/.pgbackrest_repo_path"')
else
  for name in WAL_ARCHIVE_BUCKET WAL_ARCHIVE_ENDPOINT WAL_ARCHIVE_REGION WAL_ARCHIVE_KEY WAL_ARCHIVE_SECRET \
    RAILWAY_PROJECT_ID RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_POSTGRES; do
    [ -n "${!name:-}" ] || fail "$name is not set"
  done
  tls_env=()
  repo_path=$(source_sql "SELECT pg_read_file(current_setting('data_directory') || '/.pgbackrest_repo_path')" | head -n 1)
fi
[ -n "$repo_path" ] || fail "the source names no archive path: is point-in-time recovery on?"
echo "drill: $mode archive at $repo_path"

export PGBACKREST_REPO1_TYPE=s3 PGBACKREST_REPO1_S3_URI_STYLE=path PGBACKREST_LOG_LEVEL_FILE=off
export PGBACKREST_REPO1_S3_BUCKET=$WAL_ARCHIVE_BUCKET PGBACKREST_REPO1_S3_ENDPOINT=$WAL_ARCHIVE_ENDPOINT
export PGBACKREST_REPO1_S3_REGION=$WAL_ARCHIVE_REGION PGBACKREST_REPO1_S3_KEY=$WAL_ARCHIVE_KEY
export PGBACKREST_REPO1_S3_KEY_SECRET=$WAL_ARCHIVE_SECRET PGBACKREST_REPO1_PATH=$repo_path
export WAL_RECOVER_FROM_BUCKET=$WAL_ARCHIVE_BUCKET WAL_RECOVER_FROM_ENDPOINT=$WAL_ARCHIVE_ENDPOINT
export WAL_RECOVER_FROM_REGION=$WAL_ARCHIVE_REGION WAL_RECOVER_FROM_KEY=$WAL_ARCHIVE_KEY
export WAL_RECOVER_FROM_SECRET=$WAL_ARCHIVE_SECRET WAL_RECOVER_FROM_PATH=$repo_path

# pgBackRest's view of the archive, from this machine, through the image.
archive_info() {
  docker run --rm --network "$NET" ${tls_env[@]+"${tls_env[@]}"} --user postgres --entrypoint pgbackrest \
    -e PGBACKREST_REPO1_TYPE -e PGBACKREST_REPO1_S3_URI_STYLE -e PGBACKREST_LOG_LEVEL_FILE \
    -e PGBACKREST_REPO1_S3_BUCKET -e PGBACKREST_REPO1_S3_ENDPOINT -e PGBACKREST_REPO1_S3_REGION \
    -e PGBACKREST_REPO1_S3_KEY -e PGBACKREST_REPO1_S3_KEY_SECRET -e PGBACKREST_REPO1_PATH \
    "$IMAGE" --stanza=main --output=json info 2>/dev/null
}

# A restore needs a base backup older than the target: the image takes the
# first one once archiving works.
has_backup() { [ "$(archive_info | jq '[.[0].backup[]?] | length' 2>/dev/null || echo 0)" -gt 0 ]; }
until_within "$READY_SECONDS" 1 has_backup || fail "the archive holds no base backup after $READY_SECONDS s"
step backup

# Two empty transactions: committing pg_current_xact_id() gives each its own
# commit record, so nothing is written to any table.
before=$(source_sql 'SELECT pg_current_xact_id()')
target=$(source_sql "SELECT pg_xact_commit_timestamp('$before'::xid8::xid)")
[ -n "$target" ] || fail "the source has no commit time for $before (track_commit_timestamp off?)"
sleep 1
after=$(source_sql 'SELECT pg_current_xact_id()')
committed_at=$SECONDS
segment=$(source_sql 'SELECT pg_walfile_name(pg_current_wal_insert_lsn())')
echo "drill: target $target, after transaction $before; $after committed in $segment"

# Archive segment names sort in log order on one timeline.
archive_holds() {
  local newest
  newest=$(archive_info | jq -r '.[0].archive[0].max // empty' 2>/dev/null || true)
  [ -n "$newest" ] && [[ ! "$newest" < "$segment" ]]
}
until_within "$MAX_LAG_SECONDS" 5 archive_holds || fail "the archive did not reach $segment within $MAX_LAG_SECONDS s"
lag=$((SECONDS - committed_at))
echo "drill: the archive held the commit after $lag s (at most $MAX_LAG_SECONDS s)"
step archive

docker run -d --name "$SIBLING" --network "$NET" ${tls_env[@]+"${tls_env[@]}"} \
  -e POSTGRES_PASSWORD=drill -e "POSTGRES_RECOVERY_TARGET_TIME=$target" \
  -e WAL_RECOVER_FROM_BUCKET -e WAL_RECOVER_FROM_ENDPOINT -e WAL_RECOVER_FROM_REGION \
  -e WAL_RECOVER_FROM_KEY -e WAL_RECOVER_FROM_SECRET -e WAL_RECOVER_FROM_PATH \
  "$IMAGE" >/dev/null
sibling_sql() {
  docker exec "$SIBLING" psql -X -q -A -t -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -c "$1"
}
sibling_failed() {
  docker logs --tail 40 "$SIBLING" >&2 || true
  fail "the sibling $1"
}
sibling_promoted() {
  [ "$(sibling_sql 'SELECT pg_is_in_recovery()' 2>/dev/null)" = f ] && return 0
  docker inspect -f '{{.State.Running}}' "$SIBLING" 2>/dev/null | grep -qx true && return 1
  sibling_failed "stopped before it promoted"
}
until_within "$READY_SECONDS" 1 sibling_promoted ||
  sibling_failed "did not reach $target and promote within $READY_SECONDS s"
step restore

# The target transaction is there; the next one is not, so its id is still
# in the sibling's future.
[ "$(sibling_sql "SELECT pg_xact_status('$before'::xid8)")" = committed ] \
  || fail "transaction $before, committed at the target, is missing"
status_after=$(sibling_sql "SELECT pg_xact_status('$after'::xid8)" 2>&1 || true)
case "$status_after" in
  *"in the future"*) ;;
  *) fail "transaction $after, committed after the target, is there ($status_after)" ;;
esac
echo "drill: the sibling stopped at $target: $before committed, $after not"
step check

node scripts/backup.ts report <"$work/steps"
