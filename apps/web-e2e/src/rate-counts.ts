// The api counts sign-ups (libs/domain/src/auth/attempts.ts) and listing
// drafts created (libs/domain/src/garages/listing-drafts/listing-drafts.throttle.ts) per
// address for an hour, 10 a client each, and the suite does both several times
// a run, so a second local run within the hour would be refused. A local run
// clears those counts first (global-setup.ts); CI starts a fresh Redis each run.
export const SIGN_UP_KEYS = 'auth:signup:address:*';
export const DRAFT_KEYS = 'listing-drafts:create:*';
// Analytics choices stored per address, 20 an hour
// (libs/domain/src/auth/consents/consents.throttle.ts): every spec that
// answers the consent bar stores one from the same address, so the suite
// uses them up within a run, and the consent flows clear them per test.
export const CONSENT_KEYS = 'consents:record:*';
// SCAN ends when its cursor comes back to 0; the cap ends it should a Redis
// never answer so. 1000 pages of 100 is far beyond a local test database.
const MAX_PAGES = 1000;

// The two Redis calls the clearing needs; an ioredis client has both.
type KeyStore = {
  scan(
    cursor: string,
    match: 'MATCH',
    pattern: string,
    count: 'COUNT',
    size: number,
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
};

// Deletes every count the pattern names and returns how many there were. The
// keys are all found before any is deleted, so the scan never runs over a
// changing set.
export async function clearCounts(
  redis: KeyStore,
  pattern: string,
): Promise<number> {
  const keys: string[] = [];
  let cursor = '0';
  for (let page = 0; page < MAX_PAGES; page++) {
    const [next, found] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100,
    );
    keys.push(...found);
    cursor = next;
    if (cursor === '0') break;
  }
  return keys.length ? redis.del(...keys) : 0;
}
