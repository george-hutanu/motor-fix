// The api counts sign-ups per address for an hour (libs/domain/src/auth/attempts.ts,
// 10 a client) and the suite signs up several accounts a run, so a second local
// run within the hour would be refused. A local run clears those counts first;
// CI starts a fresh Redis each run, and a deployed environment is never touched.
const SIGN_UP_KEYS = 'auth:signup:address:*';

// The two Redis calls the clearing needs; an ioredis client has both.
export type KeyStore = {
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    size: number,
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
};

// Deletes every sign-up count and returns how many there were. The keys are
// all found before any is deleted, so the scan never runs over a changing set.
export async function clearSignUpCounts(redis: KeyStore): Promise<number> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, page] = await redis.scan(
      cursor,
      'MATCH',
      SIGN_UP_KEYS,
      'COUNT',
      100,
    );
    keys.push(...page);
    cursor = next;
  } while (cursor !== '0');
  return keys.length ? redis.del(...keys) : 0;
}

// The Redis a run clears: the one at REDIS_URL when the run starts its own
// servers, none against a deployed address (BASE_URL).
export function redisToClear(
  env: Record<string, string | undefined>,
): string | null {
  if (env['BASE_URL']) return null;
  return env['REDIS_URL'] || null;
}
