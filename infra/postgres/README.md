# The database image

`ghcr.io/george-hutanu/motor-fix-postgres:18`, built from the `Dockerfile`
here by `.github/workflows/postgres-image.yml`, is the one PostgreSQL that
local compose, CI, the mutation jobs, the PR QA boot, both drills and Railway
staging run. It is Railway's `ghcr.io/railwayapp-templates/postgres-ssl:18`
plus `postgresql-18-postgis-3` (PostGIS 3.6), with `PGDATA` set under
`/var/lib/postgresql/data`, the only data directory the base entrypoint
accepts. Nothing else is ours.

What the base entrypoint already does, read from the image:

- SSL with a self-signed certificate, and `pg_stat_statements` preloaded on a
  fresh database.
- Point-in-time recovery, off until `WAL_ARCHIVE_BUCKET` is set. With
  `WAL_ARCHIVE_ENDPOINT`, `WAL_ARCHIVE_REGION`, `WAL_ARCHIVE_KEY` and
  `WAL_ARCHIVE_SECRET` it streams the write-ahead log to that bucket with
  pgBackRest (`archive_timeout` 60 s, `POSTGRES_ARCHIVE_TIMEOUT`), takes a
  full backup every 168 h and a differential one every 24 h
  (`WAL_BACKUP_FULL_INTERVAL_HOURS`, `WAL_BACKUP_DIFF_INTERVAL_HOURS`), keeps
  four fulls and fourteen differentials (`WAL_BACKUP_RETENTION_FULL`,
  `WAL_BACKUP_RETENTION_DIFF`), turns `track_commit_timestamp` on (a
  restore target is a commit time) and records its archive path in
  `$PGDATA/.pgbackrest_repo_path`.
- A restore, on an empty data directory only, when `WAL_RECOVER_FROM_BUCKET`,
  `_ENDPOINT`, `_REGION`, `_KEY`, `_SECRET` and `_PATH` name an archive and
  `POSTGRES_RECOVERY_TARGET_TIME` (or `POSTGRES_RECOVERY_TARGET_XID`) the
  moment: it restores the newest base backup before it, replays the log to it
  and promotes. Railway's point-in-time restore into a new service sets these.

`scripts/backup/pitr-drill.sh` proves the restore; the how-to in the specs
repository (`docs/how-to/back-up-and-restore-the-database.md`) is the
runbook.
