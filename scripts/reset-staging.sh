#!/bin/sh
# Empties, migrates and seeds the database of the service it runs in. Run only
# by .github/workflows/reset-staging.yml, which pipes it to `sh -s` inside the
# staging api service over `railway ssh`, so it uses that service's own private
# DATABASE_URL. The workflow puts SEED_PASSWORD in front of it on stdin.
#
# With SEED_ONLY=1 in front too, it only seeds, which adds the seed accounts
# that are missing and removes the quote requests they sent in the last day,
# so the seeded driver's daily limit starts unused: the release's staging job
# does this after each deploy, before the end-to-end run signs in as them.
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
  if [ "${SEED_ONLY:-}" != 1 ]; then
    npx prisma migrate reset --force
  fi
  npx prisma db seed
}

main </dev/null
