#!/bin/sh
# Empties, migrates, seeds and fills with demo data the database of the service it runs in, with that
# service's own private DATABASE_URL. Two callers, both inside the staging api:
#
# - .github/workflows/reset-staging.yml pipes it to `sh -s` there by hand, with
#   SEED_PASSWORD in front of it on stdin, to empty and reseed staging.
# - The api's Railway pre-deploy step on staging (scripts/api-pre-deploy.sh,
#   named by scripts/railway-deploy.ts) runs it from the image after the
#   migrations and the monitor password, with SEED_ONLY=1 and
#   SEED_PASSWORD set on the service, so each deploy is seeded before the
#   end-to-end run signs in. A failed seed exits non-zero and fails that
#   deployment.
#
# A full reset then loads the demo data (libs/domain/src/demo-data.ts):
# garages in Timișoara and six other cities, drivers with history, and one
# account with every role. A deploy's seed leaves it be, so it lasts until the
# next reset.
#
# With SEED_ONLY=1 it only seeds, which adds the seed accounts that are
# missing, restores what each owns (password, one password identity, status,
# roles, link), removes the quote requests they sent in the last day, so the
# seeded driver's daily limit starts unused, and prints one summary line.
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
  npx prisma db seed || {
    echo 'staging seed failed: npx prisma db seed exited non-zero' >&2
    exit 1
  }
  if [ "${SEED_ONLY:-}" != 1 ]; then
    node src/demo-data.ts || {
      echo 'staging demo data failed: node src/demo-data.ts exited non-zero' >&2
      exit 1
    }
  fi
}

main </dev/null
