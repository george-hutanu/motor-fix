import { PROFILE_VIEW_SOURCES } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { addDays, localDay } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';
import { recordRows } from '../profile-views/profile-views.metrics';
import { UUID } from '../profile-views/profile-views.service';

interface Counted {
  garageId: string;
  profileViews: number;
  profileViewsBySource: Record<string, number>;
}

// The garage ids with a total counter for the day: keys of exactly four parts,
// so the day secret (`secret` is no id) and the throttle never pass.
async function countedIds(redis: Redis, day: string): Promise<string[]> {
  const ids = new Set<string>();
  let cursor = '0';
  // SCAN has walked every key once it hands back cursor 0.
  do {
    const [next, keys] = await redis.scan(
      cursor,
      'MATCH',
      `insights:pv:*:${day}`,
      'COUNT',
      500,
    );
    cursor = next;
    for (const key of keys) {
      const parts = key.split(':');
      if (parts.length === 4 && UUID.test(parts[2])) ids.add(parts[2]);
    }
  } while (cursor !== '0');
  return [...ids];
}

async function countsOf(
  redis: Redis,
  day: string,
  ids: string[],
): Promise<Counted[]> {
  if (ids.length === 0) return [];
  const pipeline = redis.pipeline();
  for (const id of ids) {
    const total = `insights:pv:${id}:${day}`;
    pipeline.pfcount(total);
    for (const source of PROFILE_VIEW_SOURCES)
      pipeline.pfcount(`${total}:${source}`);
  }
  const replies = (await pipeline.exec()) ?? [];
  for (const [error] of replies) if (error) throw error;
  const per = PROFILE_VIEW_SOURCES.length + 1;
  return ids.map((garageId, i) => {
    const counts = replies
      .slice(i * per, (i + 1) * per)
      .map(([, n]) => Number(n));
    const profileViewsBySource: Record<string, number> = {};
    PROFILE_VIEW_SOURCES.forEach((source, s) => {
      if (counts[s + 1] > 0) profileViewsBySource[source] = counts[s + 1];
    });
    return { garageId, profileViews: counts[0], profileViewsBySource };
  });
}

// Writes yesterday's and the day before's figures from the live counters,
// which outlive both, so one missed night is caught up by the next. A garage
// with a counter gets its counts, replacing what an earlier run wrote; an
// approved garage without one gets a row of nothing, but never over a row
// already written (a Redis that lost its counters must not erase figures).
// Older days without a row are only logged as gaps.
export async function writeDailyFigures(
  prisma: PrismaClient,
  redis: Redis,
  now: Date,
): Promise<{ gaps: string[]; written: number }> {
  const logger = new Logger('ProfileViews');
  const yesterday = addDays(localDay(now), -1);
  const days = [yesterday, addDays(yesterday, -1)];
  // Every Redis read first, so a Redis that fails leaves no row behind.
  const read = await Promise.all(
    days.map(async (day) => {
      const ids = await countedIds(redis, day);
      const known = await prisma.garage.findMany({
        select: { id: true },
        where: { id: { in: ids } },
      });
      return {
        counted: await countsOf(
          redis,
          day,
          known.map((g) => g.id),
        ),
        day,
      };
    }),
  );
  const approved = await prisma.garage.findMany({
    select: { id: true },
    where: { status: 'approved' },
  });
  let written = 0;
  for (const { counted, day } of read) {
    const date = new Date(day);
    const withCounter = new Set(counted.map((c) => c.garageId));
    const empty = approved.filter((g) => !withCounter.has(g.id));
    await prisma.$transaction(async (tx) => {
      // Two runs at once write one after the other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('garage_daily_figures'), hashtext(${day}))`;
      // Replaced in two statements, whatever the number of garages.
      await tx.garageDailyFigures.deleteMany({
        where: { day: date, garageId: { in: [...withCounter] } },
      });
      await tx.garageDailyFigures.createMany({
        data: counted.map((row) => ({ ...row, day: date, writtenAt: now })),
      });
      await tx.garageDailyFigures.createMany({
        data: empty.map((g) => ({
          day: date,
          garageId: g.id,
          profileViews: 0,
          profileViewsBySource: {},
          writtenAt: now,
        })),
        skipDuplicates: true,
      });
    });
    const count = counted.length + empty.length;
    written += count;
    recordRows('written', count);
    logger.log(`profile views: written ${count} for ${day}`);
  }
  const gaps = await gapsBefore(prisma, days[1]);
  for (const day of gaps) logger.warn(`profile views: gap ${day}`);
  recordRows('gap', gaps.length);
  return { gaps, written };
}

// The days between the last row before `day` and `day` that no night wrote.
// No row before it at all is the first night, which has no gap.
async function gapsBefore(prisma: PrismaClient, day: string) {
  const last = await prisma.garageDailyFigures.aggregate({
    _max: { day: true },
    where: { day: { lt: new Date(day) } },
  });
  const gaps: string[] = [];
  const from = last._max.day?.toISOString().slice(0, 10);
  if (!from) return gaps;
  for (let d = addDays(from, 1); d < day; d = addDays(d, 1)) gaps.push(d);
  return gaps;
}
