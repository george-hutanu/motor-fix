#!/bin/sh
# The api's Railway pre-deploy step, inside the new image (/app), before it
# goes live: `sh scripts/api-pre-deploy.sh <staging|production>`
# (scripts/railway-deploy.ts apiPreDeploy). Railway runs that command split
# into words with no shell, so every `&&` and `NAME=value` lives here.
#
#   1. the migration;
#   2. the monitor role's password (scripts/monitor-password.ts);
#   3. on staging only, the seed-only reset, whose own guards refuse anywhere
#      Railway and the app do not both say staging.
#
# The first step that fails stops it with its exit code, which fails the
# deployment.
set -eu

main() {
  if [ "$#" -ne 1 ]; then
    echo "usage: api-pre-deploy.sh <staging|production>" >&2
    exit 64
  fi
  case "$1" in
    staging | production) ;;
    *)
      echo "usage: api-pre-deploy.sh <staging|production>" >&2
      exit 64
      ;;
  esac

  npx prisma migrate deploy
  node scripts/monitor-password.ts
  if [ "$1" = staging ]; then
    SEED_ONLY=1 sh scripts/reset-staging.sh
  fi
}

main "$@"
