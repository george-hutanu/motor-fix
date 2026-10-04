#!/bin/sh
# Empties, migrates and seeds the database of the service it runs in. Run only
# by .github/workflows/reset-staging.yml, which pipes it to `sh -s` inside the
# staging api service over `railway ssh`, so it uses that service's own private
# DATABASE_URL. The workflow puts SEED_PASSWORD in front of it on stdin.
#
# It refuses unless the container says it is staging twice over: APP_ENV,
# which the app reads, and RAILWAY_ENVIRONMENT_NAME, which Railway sets.
#
# Everything is inside main, read whole before it runs, so a command that reads
# stdin cannot eat the rest of the script.

main() {
  set -eu
  if [ "${APP_ENV:-}" != staging ] ||
    [ "${RAILWAY_ENVIRONMENT_NAME:-}" != staging ]; then
    echo "reset refused: APP_ENV=${APP_ENV:-unset}, Railway environment ${RAILWAY_ENVIRONMENT_NAME:-unset}; only staging is reset" >&2
    exit 1
  fi
  if [ -z "${SEED_PASSWORD:-}" ]; then
    echo 'reset refused: SEED_PASSWORD is empty' >&2
    exit 1
  fi
  # The api image keeps the Prisma config, schema, migrations and seed here.
  cd "${APP_DIR:-/app}"
  npx prisma migrate reset --force
  npx prisma db seed
}

main </dev/null
