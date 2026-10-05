import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

// Jest runs test files in parallel workers against one database; files that
// empty the account tables take turns by holding one advisory lock on a
// dedicated connection that never idles out.
export function databaseTurn(databaseUrl: string) {
  const lock = new PrismaClient({
    adapter: new PrismaPg({
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
