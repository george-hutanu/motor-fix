import { Redis } from 'ioredis';
import { Client } from 'pg';

import { resetGarageOnly } from './garage-only.js';
import { clearSignUpCounts } from './sign-up-counts.js';

async function clearCounts(): Promise<void> {
  const url = process.env['REDIS_URL'];
  if (!url) {
    console.log('global-setup: REDIS_URL unset, sign-up counts not cleared');
    return;
  }
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    const cleared = await clearSignUpCounts(redis);
    if (cleared) console.log(`global-setup: cleared ${cleared} sign-up counts`);
  } catch (error) {
    console.log(`global-setup: sign-up counts not cleared: ${error}`);
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
  await clearCounts();
  await resetAccounts();
}
