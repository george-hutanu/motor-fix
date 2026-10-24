# Runs inside a Railway sandbox on the environment's private network, fed on
# stdin to `sh -s` by backup.sh, which puts a prelude in front of it
# (scripts/railway-sandbox.ts prelude): EXPECTED_ENV, IMAGE (the PostgreSQL
# service's own image), OBJECT (the copy's key in the bucket), DUMP_SH
# (dump.sh, base64), BACKUP_GPG_PASSPHRASE and the BACKUP_S3_* settings. The
# sandbox already holds the service's PG* variables and Railway environment
# name, as references Railway resolved.
#
# dump.sh runs in that image and streams the manifest head and the dump; the
# dump is encrypted as it arrives, so only ciphertext touches the disk, and is
# uploaded from here. Only two short lines go back to the runner, which a cut
# stream cannot turn into a corrupt copy: `BACKUP_HEAD <json>` and
# `BACKUP_SIZE <bytes>`.

set -eu
umask 077

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf %s "$DUMP_SH" | base64 -d >"$work/dump.sh"
printf %s "$BACKUP_GPG_PASSPHRASE" >"$work/passphrase"
docker pull -q "$IMAGE" >&2
docker pull -q amazon/aws-cli:2.22.0 >&2

# sh has no pipefail: each side of the pipe leaves its own mark.
{
  docker run --rm -i --network host --entrypoint sh -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e RAILWAY_ENVIRONMENT_NAME -e EXPECTED_ENV "$IMAGE" -s <"$work/dump.sh" ||
    : >"$work/dump-failed"
} | {
  IFS= read -r head
  printf '%s\n' "$head" >"$work/head.json"
  { base64 -d || : >"$work/decode-failed"; } |
    gpg --symmetric --cipher-algo AES256 --batch --yes --quiet \
      --pinentry-mode loopback --passphrase-file "$work/passphrase" --output "$work/dump.gpg"
}
rm -f "$work/passphrase"
if [ -e "$work/dump-failed" ] || [ -e "$work/decode-failed" ]; then
  echo "backup failed: the dump did not complete" >&2
  exit 1
fi

AWS_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY \
  AWS_ENDPOINT_URL=$BACKUP_S3_ENDPOINT AWS_REGION=$BACKUP_S3_REGION \
  docker run --rm --network host -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_ENDPOINT_URL -e AWS_REGION \
  -v "$work/dump.gpg:/backup/dump.gpg:ro" \
  amazon/aws-cli:2.22.0 s3 cp --only-show-errors /backup/dump.gpg "s3://$BACKUP_S3_BUCKET/$OBJECT"

printf 'BACKUP_HEAD %s\n' "$(cat "$work/head.json")"
printf 'BACKUP_SIZE %s\n' "$(wc -c <"$work/dump.gpg" | tr -d ' ')"
