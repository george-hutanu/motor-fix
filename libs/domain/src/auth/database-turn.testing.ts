import { basename } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

type JestGlobal = { expect?: { getState(): { testPath?: string } } };

// Shown in pg_stat_activity, so CI's Database waits step names the holder.
function holderName() {
  const path = (globalThis as JestGlobal).expect?.getState().testPath;
  return `turn ${path ? basename(path) : 'outside jest'}`.slice(0, 63);
}

const POLL_MS = 250;

// One spec file at a time touches the shared tables. The turn is asked for
// again and again instead of queued on: a queued pg_advisory_lock cannot be
// called off, so a take whose hook timed out was granted after its spec file
// had ended and held the turn, idle, for the rest of the run. Once released,
// a take stops asking and never holds the turn.
export function databaseTurn(databaseUrl: string) {
  const lock = new PrismaClient({
    adapter: new PrismaPg({
      application_name: holderName(),
      connectionString: databaseUrl,
      idleTimeoutMillis: 0,
      max: 1,
    }),
  });
  let released = false;
  return {
    release: async () => {
      released = true;
      await lock.$disconnect();
    },
    take: async () => {
      while (!released) {
        const [row] = await lock.$queryRaw<{ taken: boolean }[]>`
          SELECT pg_try_advisory_lock(79079) AS taken`;
        if (row?.taken) return;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    },
  };
}
