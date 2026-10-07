import { Redis } from 'ioredis';

import { clearSignUpCounts, redisToClear } from './sign-up-counts.js';

// Runs once before a suite that starts its own servers (playwright.config.mts).
// Without a reachable Redis the run goes on: the api skips its limits then too.
export default async function globalSetup(): Promise<void> {
  const url = redisToClear(process.env);
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
