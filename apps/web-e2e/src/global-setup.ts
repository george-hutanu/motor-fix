import { Redis } from 'ioredis';
import { Client } from 'pg';

import { resetGarageOnly } from './garage-only.js';
import { clearCounts, DRAFT_KEYS, SIGN_UP_KEYS } from './sign-up-counts.js';

async function clearRateCounts(): Promise<void> {
  const url = process.env['REDIS_URL'];
  if (!url) {
    console.log('global-setup: REDIS_URL unset, counts not cleared');
    return;
  }
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const signUps = await clearCounts(redis, SIGN_UP_KEYS);
    if (signUps) console.log(`global-setup: cleared ${signUps} sign-up counts`);
    const drafts = await clearCounts(redis, DRAFT_KEYS);
    if (drafts) console.log(`global-setup: cleared ${drafts} draft counts`);
  } catch (error) {
    console.log(`global-setup: counts not cleared: ${error}`);
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
  await clearRateCounts();
  await resetAccounts();
}
