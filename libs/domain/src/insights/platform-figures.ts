import { atLocal, localDay, monthStart } from '../bucharest';
import type { PrismaClient } from '../generated/prisma/client';

const ACTIVE_WINDOW = 30 * 86_400_000;

export async function countPlatformFigures(db: PrismaClient, now: Date) {
  const since = atLocal(monthStart(localDay(now)), 0);
  const [garagesListed, garagesApprovedThisMonth, activeDrivers] =
    await Promise.all([
      db.garage.count({ where: { status: 'approved' } }),
      firstApprovedSince(db, since),
      db.account.count({
        where: {
          lastActiveAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW) },
          roles: { some: { role: 'driver' } },
          status: 'active',
        },
      }),
    ]);
  return { activeDrivers, garagesApprovedThisMonth, garagesListed };
}

// `approvedAt` moves when a reopened file is approved again, so a garage
// whose audit history shows it published before `since` is left out.
async function firstApprovedSince(db: PrismaClient, since: Date) {
  const garages = await db.garage.findMany({
    select: { id: true },
    where: { approvedAt: { gte: since }, status: 'approved' },
  });
  if (garages.length === 0) return 0;
  const earlier = await db.activityLog.findMany({
    distinct: ['subjectId'],
    select: { subjectId: true },
    where: {
      at: { lt: since },
      field: 'status',
      newValue: { equals: 'approved' },
      subjectId: { in: garages.map(({ id }) => id) },
      subjectType: 'garage',
    },
  });
  return garages.length - earlier.length;
}

export async function monthStartSnapshot(db: PrismaClient, now: Date) {
  const row = await db.platformDaily.findUnique({
    select: { activeDrivers: true },
    where: { day: new Date(monthStart(localDay(now))) },
  });
  return row?.activeDrivers;
}

export async function writeSnapshot(db: PrismaClient, now: Date) {
  const day = new Date(localDay(now));
  const figures = { ...(await countPlatformFigures(db, now)), writtenAt: now };
  await db.platformDaily.upsert({
    create: { day, ...figures },
    update: figures,
    where: { day },
  });
}
