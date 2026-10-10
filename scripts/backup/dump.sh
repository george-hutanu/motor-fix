# Runs inside an environment's PostgreSQL service, fed on stdin to `sh -s`
# by backup.sh, which puts `EXPECTED_ENV=<environment>` in front of it.
#
# Prints the manifest's first half on line 1 ({"server_version", "tables"},
# every public table with its row count) and then the custom-format dump as
# base64, both read in one exported snapshot, so the counts are the dump's.
# The dump is never written to the service's disk.

set -eu

if [ -z "${EXPECTED_ENV:-}" ] || [ "${RAILWAY_ENVIRONMENT_NAME:-}" != "$EXPECTED_ENV" ]; then
  echo "dump refused: this service is in '${RAILWAY_ENVIRONMENT_NAME:-}', not '${EXPECTED_ENV:-}'" >&2
  exit 1
fi

# The service's own superuser, as its image names it.
export PGUSER="${PGUSER:-${POSTGRES_USER:-postgres}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-$PGUSER}}"

work=$(mktemp -d)
holder=
cleanup() {
  exec 3>&- 2>/dev/null || true
  [ -n "$holder" ] && wait "$holder" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

# One session holds the snapshot open while the counts and the dump read it.
mkfifo "$work/in"
psql -X -q -A -t -v ON_ERROR_STOP=1 <"$work/in" >"$work/snapshot" &
holder=$!
exec 3>"$work/in"
echo "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot();" >&3

tries=0
while [ ! -s "$work/snapshot" ]; do
  tries=$((tries + 1))
  if [ "$tries" -gt 60 ]; then
    echo "dump failed: no snapshot after 60 s" >&2
    exit 1
  fi
  sleep 1
done
snapshot=$(head -n 1 "$work/snapshot")

psql -X -q -A -t -v ON_ERROR_STOP=1 <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET TRANSACTION SNAPSHOT '$snapshot';
SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'tables', coalesce(json_object_agg(
    table_name,
    (xpath('/row/c/text()', query_to_xml(
      format('SELECT count(*) AS c FROM public.%I', table_name), false, true, ''
    )))[1]::text::bigint
    ORDER BY table_name
  ), '{}'::json)
)
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
COMMIT;
SQL

# sh has no pipefail: a failed pg_dump leaves a mark the exit code reads.
{ pg_dump -Fc --snapshot="$snapshot" || : >"$work/failed"; } | base64
if [ -e "$work/failed" ]; then
  # Not base64, so the runner's decode fails even if the exit code is lost.
  echo '!dump failed'
  echo "dump failed: pg_dump exited non-zero" >&2
  exit 1
fi

echo "COMMIT;" >&3
