import type { AdminDemandDto } from '@motor-fix/contracts';
import { byCodePoint, orderBrands } from '@motor-fix/contracts/demand-order';

import { addDays, atLocal, localDay } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';

// The window: today and the 29 closed Europe/Bucharest days before it.
const WINDOW_DAYS = 30;

type Db = Pick<
  PrismaClient,
  | 'brand'
  | 'demandDaily'
  | 'jobType'
  | 'quoteRequest'
  | 'requestJob'
  | 'searchLog'
>;

interface Counts {
  // Requests by brand name.
  brands: Map<string, number>;
  // By job type key.
  jobs: Map<string, number>;
  requests: number;
  // Logged searches by the brand's current name.
  searches: Map<string, number>;
  searchCount: number;
}

const add = (into: Map<string, number>, key: string, n: number) =>
  into.set(key, (into.get(key) ?? 0) + n);

// The requests created on `days`, whatever their status: once per brand as
// stored in the car snapshot, once per job asked for; and the searches logged
// on them, once per brand under its name today.
async function countDays(db: Db, days: readonly string[]): Promise<Counts> {
  const counts: Counts = {
    brands: new Map(),
    jobs: new Map(),
    requests: 0,
    searchCount: 0,
    searches: new Map(),
  };
  if (days.length === 0) return counts;
  const ranges = days.map((day) => ({
    gte: atLocal(day, 0),
    lt: atLocal(addDays(day, 1), 0),
  }));
  const createdAt = ranges.map((range) => ({ createdAt: range }));
  const [brands, jobs, searches] = await Promise.all([
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
    db.searchLog.groupBy({
      _count: { _all: true },
      by: ['brandId'],
      where: { OR: ranges.map((at) => ({ at })) },
    }),
  ]);
  for (const row of brands) {
    add(counts.brands, row.carBrand, row._count._all);
    counts.requests += row._count._all;
  }
  const [types, searched] = await Promise.all([
    db.jobType.findMany({
      select: { id: true, key: true },
      where: { id: { in: jobs.map((row) => row.jobTypeId) } },
    }),
    db.brand.findMany({
      select: { id: true, name: true },
      where: { id: { in: searches.map((row) => row.brandId) } },
    }),
  ]);
  const nameOf = new Map(searched.map((b) => [b.id, b.name]));
  for (const row of searches) {
    const name = nameOf.get(row.brandId);
    if (name === undefined) continue;
    add(counts.searches, name, row._count._all);
    counts.searchCount += row._count._all;
  }
  const keyOf = new Map(types.map((t) => [t.id, t.key]));
  for (const row of jobs) {
    const key = keyOf.get(row.jobTypeId);
    if (key !== undefined) add(counts.jobs, key, row._count._all);
  }
  return counts;
}

// One row per brand searched or requested, matched on the exact name.
const brandRows = ({ brands, searches }: Counts) =>
  [...new Set([...brands.keys(), ...searches.keys()])].map((name) => ({
    name,
    requests: brands.get(name) ?? 0,
    searches: searches.get(name) ?? 0,
  }));

const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// The closed days of the window, oldest first.
function closedDays(now: Date) {
  const today = localDay(now);
  return Array.from({ length: WINDOW_DAYS - 1 }, (_, i) =>
    addDays(today, i - (WINDOW_DAYS - 1)),
  );
}

// The closed days that already have their total row.
async function writtenDays(
  db: Pick<PrismaClient, 'demandDaily'>,
  days: readonly string[],
) {
  const totals = await db.demandDaily.findMany({
    select: { day: true, requests: true, searches: true },
    where: {
      day: { in: days.map((day) => new Date(day)) },
      dimension: 'total',
      key: 'all',
    },
  });
  return new Map(totals.map((row) => [dayOf(row.day), row]));
}

// The day searches are counted from, when it falls after the window's first
// day: the earliest search's, or today when none was ever logged.
async function searchesFrom(db: Db, firstDay: string, today: string) {
  const earliest = await db.searchLog.findFirst({
    orderBy: { at: 'asc' },
    select: { at: true },
  });
  if (!earliest) return today;
  const day = localDay(earliest.at);
  return day > firstDay && day <= today ? day : undefined;
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
  const [rows, counts, from] = await Promise.all([
    db.demandDaily.findMany({
      select: { dimension: true, key: true, requests: true, searches: true },
      where: {
        day: { in: [...written.keys()].map((day) => new Date(day)) },
        dimension: { in: ['brand', 'job'] },
      },
    }),
    countDays(db, live),
    searchesFrom(db, closed[0], today),
  ]);
  for (const row of rows) {
    if (row.dimension === 'job') {
      add(counts.jobs, row.key, row.requests);
      continue;
    }
    // A searched-only brand's row holds no request, a requested-only one no
    // search; neither is counted as a 0 of the other.
    if (row.requests > 0) add(counts.brands, row.key, row.requests);
    if (row.searches > 0) add(counts.searches, row.key, row.searches);
  }
  for (const total of written.values()) {
    counts.requests += total.requests;
    counts.searchCount += total.searches;
  }

  const jobs = ranked(counts.jobs);
  const names = await db.jobType.findMany({
    select: { key: true, nameEn: true, nameRo: true },
    where: { key: { in: jobs.map(([key]) => key) } },
  });
  const nameOf = new Map(names.map((n) => [n.key, n]));
  return {
    brands: orderBrands(brandRows(counts), 'searches'),
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
    searches: counts.searchCount,
    ...(from !== undefined && { searchesFrom: from }),
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
      ...brandRows(counts).map(({ name, ...figures }) => ({
        dimension: 'brand',
        key: name,
        ...figures,
      })),
      ...[...counts.jobs].map(([key, requests]) => ({
        dimension: 'job',
        key,
        requests,
        searches: 0,
      })),
      {
        dimension: 'total',
        key: 'all',
        requests: counts.requests,
        searches: counts.searchCount,
      },
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
