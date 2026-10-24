import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

// How often a take asks for the turn again while another file holds it.
const RETRY_MS = 250;

// Jest runs test files in parallel workers against one database; files that
// empty the account tables take turns by holding one advisory lock on a
// dedicated connection that never idles out.
//
// A take asks with pg_try_advisory_lock and waits between asks, never queued
// on the lock itself: a beforeAll that runs out of time leaves its take
// behind, and release() must end that wait. A take still queued on the
// server took the turn once its holder let go and never gave it back.
export function databaseTurn(databaseUrl: string) {
  const lock = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      idleTimeoutMillis: 0,
      max: 1,
    }),
  });
  let released = false;
  let asking: Promise<unknown> = Promise.resolve();
  return {
    release: async () => {
      released = true;
      await asking.catch(() => undefined);
      // Closing the connection gives the turn back if the last ask took it.
      await lock.$disconnect();
    },
    // Resolves once the turn is held, or, without it, once release() ran.
    take: async () => {
      while (!released) {
        const ask = lock.$queryRaw<{ taken: boolean }[]>`
          SELECT pg_try_advisory_lock(79079) AS taken`;
        asking = ask;
        const [row] = await ask;
        if (row?.taken) return;
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    },
  };
}
