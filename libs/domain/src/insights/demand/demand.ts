import type { AdminDemandDto } from '@motor-fix/contracts';

import { addDays, atLocal, localDay } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';

// The window: today and the 29 closed Europe/Bucharest days before it.
const WINDOW_DAYS = 30;

type Db = Pick<
  PrismaClient,
  'demandDaily' | 'jobType' | 'quoteRequest' | 'requestJob'
>;

interface Counts {
  brands: Map<string, number>;
  // By job type key.
  jobs: Map<string, number>;
  requests: number;
}

const add = (into: Map<string, number>, key: string, n: number) =>
  into.set(key, (into.get(key) ?? 0) + n);

// The requests created on `days`, whatever their status: once per brand as
// stored in the car snapshot, once per job asked for.
async function countDays(db: Db, days: readonly string[]): Promise<Counts> {
  const counts: Counts = { brands: new Map(), jobs: new Map(), requests: 0 };
  if (days.length === 0) return counts;
  const createdAt = days.map((day) => ({
    createdAt: { gte: atLocal(day, 0), lt: atLocal(addDays(day, 1), 0) },
  }));
  const [brands, jobs] = await Promise.all([
    db.quoteRequest.groupBy({
      _count: { _all: true },
      by: ['carBrand'],
      where: { OR: createdAt },
    }),
    db.requestJob.groupBy({
      _count: { _all: true },
      by: ['jobTypeId'],
      where: { request: { OR: createdAt } },
    }),
  ]);
  for (const row of brands) {
    add(counts.brands, row.carBrand, row._count._all);
    counts.requests += row._count._all;
  }
  const types = await db.jobType.findMany({
    select: { id: true, key: true },
    where: { id: { in: jobs.map((row) => row.jobTypeId) } },
  });
  const keyOf = new Map(types.map((t) => [t.id, t.key]));
  for (const row of jobs) {
    const key = keyOf.get(row.jobTypeId);
    if (key !== undefined) add(counts.jobs, key, row._count._all);
  }
  return counts;
}

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// The closed days of the window, oldest first.
function closedDays(now: Date) {
  const today = localDay(now);
  return Array.from({ length: WINDOW_DAYS - 1 }, (_, i) =>
    addDays(today, i - (WINDOW_DAYS - 1)),
  );
}

// The closed days that already have their total row.
async function writtenDays(db: Db, days: readonly string[]) {
  const totals = await db.demandDaily.findMany({
    select: { day: true, requests: true },
    where: {
      day: { in: days.map((day) => new Date(day)) },
      dimension: 'total',
      key: 'all',
    },
  });
  return new Map(totals.map((row) => [dayOf(row.day), row.requests]));
}

// Plain code-point order; `<` would compare UTF-16 units and put an astral
// character before U+E000..U+FFFF.
function byCodePoint(a: string, b: string) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

// Most first, then by name (key) in plain code-point order.
const ranked = (counts: Map<string, number>) =>
  [...counts].sort(([a, n], [b, m]) => m - n || byCodePoint(a, b));

// The demand of the last 30 days: the written closed days from their rows,
// today and any closed day the night has not written counted live.
export async function readDemand(db: Db, now: Date): Promise<AdminDemandDto> {
  const closed = closedDays(now);
  const today = localDay(now);
  const written = await writtenDays(db, closed);
  const live = [...closed.filter((day) => !written.has(day)), today];
  const [rows, counts] = await Promise.all([
    db.demandDaily.findMany({
      select: { dimension: true, key: true, requests: true },
      where: {
        day: { in: [...written.keys()].map((day) => new Date(day)) },
        dimension: { in: ['brand', 'job'] },
      },
    }),
    countDays(db, live),
  ]);
  for (const row of rows)
    add(
      row.dimension === 'brand' ? counts.brands : counts.jobs,
      row.key,
      row.requests,
    );
  for (const n of written.values()) counts.requests += n;

  const jobs = ranked(counts.jobs);
  const names = await db.jobType.findMany({
    select: { key: true, nameEn: true, nameRo: true },
    where: { key: { in: jobs.map(([key]) => key) } },
  });
  const nameOf = new Map(names.map((n) => [n.key, n]));
  return {
    brands: ranked(counts.brands).map(([name, requests]) => ({
      name,
      requests,
    })),
    firstDay: closed[0],
    jobs: jobs.map(([key, requests]) => ({
      key,
      // A job type is never deleted; the key stands in should one go.
      nameEn: nameOf.get(key)?.nameEn ?? key,
      nameRo: nameOf.get(key)?.nameRo ?? key,
      requests,
    })),
    lastDay: today,
    requests: counts.requests,
  };
}

// Writes every closed day of the window that has no total row yet, so a
// missed night is caught up by the next; a written day is left as it is.
export async function writeDemandDaily(
  db: Db & Pick<PrismaClient, '$transaction'>,
  now: Date,
): Promise<{ days: string[]; written: number }> {
  const closed = closedDays(now);
  const written = await writtenDays(db, closed);
  const days: string[] = [];
  let rows = 0;
  for (const day of closed.filter((d) => !written.has(d))) {
    const counts = await countDays(db, [day]);
    const date = new Date(day);
    const data = [
      ...[...counts.brands].map(([key, requests]) => ({
        dimension: 'brand',
        key,
        requests,
      })),
      ...[...counts.jobs].map(([key, requests]) => ({
        dimension: 'job',
        key,
        requests,
      })),
      { dimension: 'total', key: 'all', requests: counts.requests },
    ].map((row) => ({ ...row, day: date, writtenAt: now }));
    // Two runs at once write one after the other, and the second finds the
    // day written under the lock and leaves it as it is.
    const wrote = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demand_daily'), hashtext(${day}))`;
      if ((await writtenDays(tx, [day])).has(day)) return false;
      await tx.demandDaily.deleteMany({ where: { day: date } });
      await tx.demandDaily.createMany({ data });
      return true;
    });
    if (!wrote) continue;
    days.push(day);
    rows += data.length;
  }
  return { days, written: rows };
}
