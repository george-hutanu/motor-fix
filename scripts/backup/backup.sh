#!/usr/bin/env bash
# Takes one environment's nightly copy (.github/workflows/backup.yml).
#
# The database has no public address, so the job has opened a Railway sandbox
# on the environment's private network (scripts/railway-sandbox.ts open, its id
# in SANDBOX_ID). sandbox-backup.sh runs dump.sh there in the PostgreSQL
# service's own image, encrypts the stream as it arrives and uploads the
# ciphertext from the sandbox; only the manifest head and the size come back.
# This runner checks the size against the bucket, uploads the manifest, and
# only then removes the copies past the retention.
#
# Reads ENVIRONMENT, RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID,
# RAILWAY_SERVICE_POSTGRES, SANDBOX_ID, BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT,
# BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY,
# BACKUP_GPG_PASSPHRASE, and the same bucket as AWS_ENDPOINT_URL, AWS_REGION
# and AWS_* keys for the runner's own calls.

set -euo pipefail

key=$(node scripts/backup.ts key "$ENVIRONMENT")
image=$(node scripts/railway-sandbox.ts image "$RAILWAY_SERVICE_POSTGRES")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

started=$(date +%s)
{
  # Secrets and settings alike go base64 on stdin, never as an argument.
  EXPECTED_ENV=$ENVIRONMENT IMAGE=$image OBJECT=$key.dump.gpg \
    DUMP_SH=$(cat scripts/backup/dump.sh) \
    node scripts/railway-sandbox.ts prelude EXPECTED_ENV IMAGE OBJECT DUMP_SH \
    BACKUP_GPG_PASSPHRASE BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY \
    BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET
  cat scripts/backup/sandbox-backup.sh
} | node scripts/railway-sandbox.ts exec "$SANDBOX_ID" | tr -d '\r' >"$work/out"

sed -n 's/^BACKUP_HEAD //p' "$work/out" | head -n 1 >"$work/head.json"
size=$(sed -n 's/^BACKUP_SIZE //p' "$work/out" | head -n 1)
if ! [[ $size =~ ^[0-9]+$ ]]; then
  echo "backup failed: the sandbox reported no size" >&2
  exit 1
fi
stored=$(aws s3api head-object --bucket "$BACKUP_S3_BUCKET" --key "$key.dump.gpg" --query ContentLength --output text)
if [ "$stored" != "$size" ]; then
  echo "backup failed: the bucket holds $stored bytes of $key.dump.gpg, the sandbox wrote $size" >&2
  exit 1
fi
jq -e '(.tables | type == "object") and (.tables | length > 0) and (.server_version | type == "string")' \
  "$work/head.json" >/dev/null
jq -c --arg environment "$ENVIRONMENT" --arg timestamp "${key#*/}" --argjson size "$size" \
  '{environment: $environment, timestamp: $timestamp, server_version, tables, dump_size_bytes: $size}' \
  "$work/head.json" >"$work/manifest.json"

aws s3 cp --only-show-errors "$work/manifest.json" "s3://$BACKUP_S3_BUCKET/$key.manifest.json"
echo "uploaded $key: $(jq '.tables | length' "$work/manifest.json") tables, $size bytes, $(($(date +%s) - started)) s"

aws s3api list-objects-v2 --bucket "$BACKUP_S3_BUCKET" --prefix "$ENVIRONMENT/" --output json \
  | node scripts/backup.ts prune "$ENVIRONMENT" \
  | while IFS= read -r old; do
      aws s3 rm --only-show-errors "s3://$BACKUP_S3_BUCKET/$old"
      echo "removed $old"
    done
