import { Redis } from 'ioredis';
import { Client } from 'pg';

import { resetGarageOnly } from './garage-only.js';
import { clearCounts, DRAFT_KEYS, SIGN_UP_KEYS } from './rate-counts.js';

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

async function clearRateCounts(): Promise<void> {
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
    const signUps = await clearCounts(redis, SIGN_UP_KEYS);
    if (signUps) console.log(`global-setup: cleared ${signUps} sign-up counts`);
    const drafts = await clearCounts(redis, DRAFT_KEYS);
    if (drafts) console.log(`global-setup: cleared ${drafts} draft counts`);
  } catch (error) {
    throw unreachable('Redis', 'REDIS_URL', 'the rate-limit counts', error);
  } finally {
    redis.disconnect();
  }
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
  await clearRateCounts();
  await resetAccounts();
}
