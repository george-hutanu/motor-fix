import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

export const PRISMA = Symbol('PRISMA');

// The adapter writes and reads timestamps as UTC wall-clock text, so every
// session runs in UTC whatever the server's own time zone.
export const createPrisma = (databaseUrl: string) =>
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      options: '-c TimeZone=UTC',
    }),
  });
