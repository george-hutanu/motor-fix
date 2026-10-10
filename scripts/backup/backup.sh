#!/usr/bin/env bash
# Takes one environment's nightly copy (.github/workflows/backup.yml).
#
# dump.sh runs inside the environment's PostgreSQL service and streams the
# table counts and the dump back; the dump is encrypted as it arrives, so only
# ciphertext reaches this runner's disk. The copy and its manifest are
# uploaded, and only then are the copies past the retention removed.
#
# Reads ENVIRONMENT, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID,
# RAILWAY_SERVICE_POSTGRES, BACKUP_S3_BUCKET, BACKUP_GPG_PASSPHRASE, and the
# bucket's AWS_ENDPOINT_URL, AWS_REGION and AWS_* keys.

set -euo pipefail

key=$(node scripts/backup.ts key "$ENVIRONMENT")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

started=$(date +%s)
{ printf 'EXPECTED_ENV=%s\n' "$ENVIRONMENT"; cat scripts/backup/dump.sh; } \
  | railway ssh --project "$RAILWAY_PROJECT_ID" --environment "$RAILWAY_ENVIRONMENT_ID" --service "$RAILWAY_SERVICE_POSTGRES" -- sh -s \
  | tr -d '\r' \
  | {
      IFS= read -r head
      printf '%s\n' "$head" >"$work/head.json"
      base64 -d | gpg --symmetric --cipher-algo AES256 --batch --yes --quiet \
        --pinentry-mode loopback --passphrase-fd 3 --output "$work/dump.gpg"
    } 3< <(printf '%s' "$BACKUP_GPG_PASSPHRASE")

size=$(wc -c <"$work/dump.gpg" | tr -d " ")
jq -e '(.tables | type == "object") and (.tables | length > 0) and (.server_version | type == "string")' \
  "$work/head.json" >/dev/null
jq -c --arg environment "$ENVIRONMENT" --arg timestamp "${key#*/}" --argjson size "$size" \
  '{environment: $environment, timestamp: $timestamp, server_version, tables, dump_size_bytes: $size}' \
  "$work/head.json" >"$work/manifest.json"

aws s3 cp --only-show-errors "$work/dump.gpg" "s3://$BACKUP_S3_BUCKET/$key.dump.gpg"
aws s3 cp --only-show-errors "$work/manifest.json" "s3://$BACKUP_S3_BUCKET/$key.manifest.json"
echo "uploaded $key: $(jq '.tables | length' "$work/manifest.json") tables, $size bytes, $(($(date +%s) - started)) s"

aws s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix "$ENVIRONMENT/" --output json \
  | node scripts/backup.ts prune "$ENVIRONMENT" \
  | while IFS= read -r old; do
      aws s3 rm --only-show-errors "s3://$BACKUP_S3_BUCKET/$old"
      echo "removed $old"
    done
