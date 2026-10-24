import { basename } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

type JestGlobal = { expect?: { getState(): { testPath?: string } } };

// The spec file taking the turn, as pg_stat_activity shows its session.
function holderName() {
  const path = (globalThis as JestGlobal).expect?.getState().testPath;
  return `turn ${path ? basename(path) : 'outside jest'}`.slice(0, 63);
}

// Jest runs test files in parallel workers against one database; files that
// empty the account tables take turns by holding one advisory lock on a
// dedicated connection that never idles out.
export function databaseTurn(databaseUrl: string) {
  const lock = new PrismaClient({
    adapter: new PrismaPg({
      application_name: holderName(),
      connectionString: databaseUrl,
      idleTimeoutMillis: 0,
      max: 1,
    }),
  });
  return {
    release: () => lock.$disconnect(),
    take: () => lock.$executeRaw`SELECT pg_advisory_lock(79079)`,
  };
}
