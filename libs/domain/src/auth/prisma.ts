import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client';

export const PRISMA = Symbol('PRISMA');

export const createPrisma = (databaseUrl: string) =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
