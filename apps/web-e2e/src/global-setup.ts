import { Redis } from 'ioredis';
import { Client } from 'pg';

import { newPhoneBase, PHONE_BASE_VARIABLE } from './fresh-phone.js';
import { resetGarageOnly } from './garage-only.js';
import {
  CONSENT_KEYS,
  clearCounts,
  DRAFT_KEYS,
  SIGN_UP_KEYS,
} from './rate-counts.js';

// A set store that does not answer stops the run here rather than letting
// it fail later on a stale count or account, far from the cause. The message
// names the variable and the error's code, never the URL, which may hold a
// password.
function unreachable(
  store: string,
  variable: string,
  what: string,
  error: unknown,
): Error {
  const code = (error as { code?: unknown } | null)?.code;
  const why = typeof code === 'string' ? code : (error as Error)?.name;
  return new Error(
    `global-setup: ${store} did not answer at ${variable} (${why}), so ${what} were not reset`,
  );
}

async function clearRateCounts(
  patterns: Record<string, string>,
): Promise<void> {
  const url = process.env['REDIS_URL'];
  if (!url) {
    console.log('global-setup: REDIS_URL unset, counts not cleared');
    return;
  }
  // One attempt, no reconnecting: a Redis that does not answer stops the run.
  const redis = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    for (const [name, pattern] of Object.entries(patterns)) {
      const cleared = await clearCounts(redis, pattern);
      if (cleared)
        console.log(`global-setup: cleared ${cleared} ${name} counts`);
    }
  } catch (error) {
    throw unreachable('Redis', 'REDIS_URL', 'the rate-limit counts', error);
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
    throw unreachable(
      'PostgreSQL',
      'DATABASE_URL',
      'the seeded accounts',
      error,
    );
  } finally {
    await db.end().catch(() => undefined);
  }
}

// Runs once before a suite that starts its own servers (playwright.config.mts
// wires it only then, so a deployed environment is never touched; the release
// seeds staging instead). Without REDIS_URL or DATABASE_URL that step is
// skipped: the api skips its limits then too, and the seeded accounts stay as
// they are. A store that is set but does not answer stops the run.
export default async function globalSetup(): Promise<void> {
  // One start for the run's fresh phone numbers, which every worker reads.
  process.env[PHONE_BASE_VARIABLE] ??= newPhoneBase();
  await clearRateCounts({
    consent: CONSENT_KEYS,
    draft: DRAFT_KEYS,
    'sign-up': SIGN_UP_KEYS,
  });
  await resetAccounts();
}
