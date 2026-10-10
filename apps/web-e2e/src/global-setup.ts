import { Redis } from 'ioredis';
import { Client } from 'pg';

import { resetGarageOnly } from './garage-only.js';
import {
  CONSENT_KEYS,
  clearCounts,
  DRAFT_KEYS,
  SIGN_UP_KEYS,
} from './rate-counts.js';

async function clearRateCounts(
  patterns: Record<string, string>,
): Promise<void> {
  const url = process.env['REDIS_URL'];
  if (!url) {
    console.log('global-setup: REDIS_URL unset, counts not cleared');
    return;
  }
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    for (const [name, pattern] of Object.entries(patterns)) {
      const cleared = await clearCounts(redis, pattern);
      if (cleared)
        console.log(`global-setup: cleared ${cleared} ${name} counts`);
    }
  } catch (error) {
    console.log(`global-setup: counts not cleared: ${error}`);
  } finally {
    redis.disconnect();
  }
}

// The consent flows' own start: the address's analytics choices so far,
// stored by every spec that answered the bar, are cleared. Against a
// deployed environment (BASE_URL), whose Redis is not the run's, it does
// nothing.
export async function clearConsentCounts(): Promise<void> {
  if (process.env['BASE_URL']) return;
  await clearRateCounts({ consent: CONSENT_KEYS });
}

async function resetAccounts(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.log('global-setup: DATABASE_URL unset, accounts not reset');
    return;
  }
  const db = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    if (await resetGarageOnly(db)) {
      console.log('global-setup: garage-only account reset');
    }
  } catch (error) {
    console.log(`global-setup: accounts not reset: ${error}`);
  } finally {
    await db.end().catch(() => undefined);
  }
}

// Runs once before a suite that starts its own servers (playwright.config.mts
// wires it only then, so a deployed environment is never touched). Without
// REDIS_URL, DATABASE_URL or a reachable server the run goes on: the api skips
// its limits then too, and the seeded accounts stay as they are.
export default async function globalSetup(): Promise<void> {
  await clearRateCounts({
    consent: CONSENT_KEYS,
    draft: DRAFT_KEYS,
    'sign-up': SIGN_UP_KEYS,
  });
  await resetAccounts();
}
