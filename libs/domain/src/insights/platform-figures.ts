import { addDays, atLocal, localDay, monthStart } from '../bucharest';
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
    distinct: ['garageId'],
    select: { garageId: true },
    where: {
      at: { lt: since },
      field: 'status',
      garageId: { in: garages.map(({ id }) => id) },
      newValue: { equals: 'approved' },
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

type Figures = { activeDrivers: number; garagesListed: number };

// A month closes on the next month's first-day row, written at 01:00 from the
// figures as the month ended; its own last day stands in when that night was
// missed, and with neither the month has no figures rather than zero.
export async function readGrowth(db: PrismaClient, now: Date) {
  const current = monthStart(localDay(now));
  const [year, month] = current.split('-').map(Number);
  const starts = [...Array(12).keys()].map((i) =>
    new Date(Date.UTC(year, month - 12 + i, 1)).toISOString().slice(0, 10),
  );
  const closing = starts.slice(1);
  const rows = await db.platformDaily.findMany({
    select: { activeDrivers: true, day: true, garagesListed: true },
    where: {
      day: {
        in: closing
          .flatMap((first) => [first, addDays(first, -1)])
          .map((day) => new Date(day)),
      },
    },
  });
  const byDay = new Map<string, Figures>(
    rows.map(({ day, ...figures }) => [
      day.toISOString().slice(0, 10),
      figures,
    ]),
  );
  const live = await countPlatformFigures(db, now);
  return {
    months: starts.map((start, i) => {
      const figures =
        i === 11
          ? live
          : (byDay.get(closing[i]) ?? byDay.get(addDays(closing[i], -1)));
      return {
        month: start.slice(0, 7),
        ...(figures && {
          activeDrivers: figures.activeDrivers,
          garagesListed: figures.garagesListed,
        }),
      };
    }),
  };
}
