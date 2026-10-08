-- The slow-statement reading: normalised statement text and timings. Reading
-- the view also needs pg_stat_statements in shared_preload_libraries; without
-- it the worker logs one line and leaves the slow-statement figure out.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- The worker reads the catalogue as this role: pg_monitor only, no table
-- grant, read-only transactions and a 5 s statement limit. Its password is
-- set at deploy time from MONITOR_DATABASE_PASSWORD (scripts/monitor-password.ts),
-- never here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'motorfix_monitor') THEN
    CREATE ROLE motorfix_monitor LOGIN;
  END IF;
END
$$;
GRANT pg_monitor TO motorfix_monitor;
ALTER ROLE motorfix_monitor SET default_transaction_read_only = on;
ALTER ROLE motorfix_monitor SET statement_timeout = '5s';
