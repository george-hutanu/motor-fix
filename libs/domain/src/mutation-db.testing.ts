// Stryker numbers its test-runner workers in STRYKER_MUTATOR_WORKER. Each
// worker gets a database of its own, postgres_w<N>, and Redis index <N>, so
// workers running side by side never share the rows or keys a spec resets.
export function workerUrls(env: Record<string, string | undefined>): {
  DATABASE_URL: string | undefined;
  REDIS_URL: string | undefined;
} {
  const { DATABASE_URL, REDIS_URL, STRYKER_MUTATOR_WORKER: worker } = env;
  if (worker === undefined) return { DATABASE_URL, REDIS_URL };
  if (!/^\d+$/.test(worker))
    throw new Error(
      `STRYKER_MUTATOR_WORKER must be a whole number; got "${worker}"`,
    );
  const database = DATABASE_URL && new URL(DATABASE_URL);
  if (database) database.pathname = `/postgres_w${Number(worker)}`;
  const redis = REDIS_URL && new URL(REDIS_URL);
  if (redis) redis.pathname = `/${Number(worker)}`;
  return {
    DATABASE_URL: database ? database.toString() : DATABASE_URL,
    REDIS_URL: redis ? redis.toString() : REDIS_URL,
  };
}
