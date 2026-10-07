import { atLocal, localDay, monthStart } from '../bucharest';
import type { PrismaClient } from '../generated/prisma/client';

const ACTIVE_WINDOW = 30 * 86_400_000;

export async function countPlatformFigures(db: PrismaClient, now: Date) {
  const since = atLocal(monthStart(localDay(now)), 0);
  const [garagesListed, garagesApprovedThisMonth, activeDrivers] =
    await Promise.all([
      db.garage.count({ where: { status: 'approved' } }),
      db.garage.count({
        where: { approvedAt: { gte: since }, status: 'approved' },
      }),
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
