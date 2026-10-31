import type {
  AdminAreaDto,
  AdminDemandSupplyDto,
  AdminDemandSupplyRowDto,
} from '@motor-fix/contracts';
import { byCodePoint } from '@motor-fix/contracts/demand-order';
import { BadRequestException } from '@nestjs/common';

import { addDays, atLocal, localDay } from '../../../bucharest';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client';
import { areaOf, cellCentre } from '../../areas/areas';
import { closedDays } from '../demand';

type Db = Pick<PrismaClient, '$queryRaw' | 'area' | 'demandDaily'>;

interface Figures {
  requests: number;
  searches: number;
  unmet: number;
}

// Figures by `<area code>:<brand name>`; an area code holds no colon.
type Counts = Map<string, Figures>;

const DIMENSION = 'brand_area';
const MARKER = 'all';

const UNKNOWN: AdminAreaDto = {
  code: 'unknown',
  kind: 'unknown',
  name: 'Zonă necunoscută',
};

const keyOf = (area: string, brand: string) => `${area}:${brand}`;

function splitKey(key: string) {
  const at = key.indexOf(':');
  return { area: key.slice(0, at), brand: key.slice(at + 1) };
}

function add(into: Counts, key: string, figures: Partial<Figures>) {
  const was = into.get(key) ?? { requests: 0, searches: 0, unmet: 0 };
  into.set(key, {
    requests: was.requests + (figures.requests ?? 0),
    searches: was.searches + (figures.searches ?? 0),
    unmet: was.unmet + (figures.unmet ?? 0),
  });
}

// `column` within one of the Europe/Bucharest days.
const within = (column: Prisma.Sql, days: readonly string[]) =>
  Prisma.join(
    days.map(
      (day) =>
        Prisma.sql`(${column} >= ${atLocal(day, 0)} AND ${column} < ${atLocal(addDays(day, 1), 0)})`,
    ),
    ' OR ',
  );

interface Grouped {
  area: string;
  brand: string;
  n: number;
}

// On `days`: the searches by the catalogue brand's name and the area of
// their cell; the requests by the snapshot's brand, once per distinct area of
// their recipients, on the day created; the unmet ones (expired with no quote
// from any garage) the same way, on the day they closed.
async function countBrandArea(
  db: Pick<PrismaClient, '$queryRaw'>,
  days: readonly string[],
): Promise<Counts> {
  const counts: Counts = new Map();
  if (days.length === 0) return counts;
  const sent = (at: Prisma.Sql, unmet: Prisma.Sql) => Prisma.sql`
    SELECT brand, area, COUNT(DISTINCT id)::int AS n FROM (
      SELECT qr.id, qr.car_brand AS brand, ${areaOf(Prisma.sql`g.position`)} AS area
      FROM quote_request qr
      JOIN request_recipient rr ON rr.request_id = qr.id
      JOIN garage g ON g.id = rr.garage_id
      WHERE (${within(at, days)}) ${unmet}
    ) sent GROUP BY brand, area`;
  const [searches, requests, unmet] = await Promise.all([
    db.$queryRaw<Grouped[]>`
      SELECT brand, area, COUNT(*)::int AS n FROM (
        SELECT b.name AS brand, ${areaOf(cellCentre(Prisma.sql`sl.area_cell`))} AS area
        FROM search_log sl JOIN brand b ON b.id = sl.brand_id
        WHERE ${within(Prisma.sql`sl.at`, days)}
      ) logged GROUP BY brand, area`,
    db.$queryRaw<Grouped[]>(sent(Prisma.sql`qr.created_at`, Prisma.empty)),
    db.$queryRaw<Grouped[]>(
      sent(
        Prisma.sql`qr.closed_at`,
        Prisma.sql`AND qr.closed_reason = 'expired' AND NOT EXISTS (SELECT 1 FROM quote q WHERE q.request_id = qr.id)`,
      ),
    ),
  ]);
  for (const row of searches)
    add(counts, keyOf(row.area, row.brand), { searches: row.n });
  for (const row of requests)
    add(counts, keyOf(row.area, row.brand), { requests: row.n });
  for (const row of unmet)
    add(counts, keyOf(row.area, row.brand), { unmet: row.n });
  return counts;
}

// The closed days that have their brand-area marker, with its write time.
async function markedDays(
  db: Pick<PrismaClient, 'demandDaily'>,
  days: readonly string[],
) {
  const markers = await db.demandDaily.findMany({
    select: { day: true, writtenAt: true },
    where: {
      day: { in: days.map((day) => new Date(day)) },
      dimension: DIMENSION,
      key: MARKER,
    },
  });
  return new Map(
    markers.map((row) => [row.day.toISOString().slice(0, 10), row.writtenAt]),
  );
}

// Writes the brand-area rows of every closed day of the window that has no
// marker yet, each day with its marker in one transaction under the demand
// step's per-day lock; a written day is left as it is, so a day written
// before these rows existed is caught up once.
export async function writeBrandAreaDaily(
  db: Pick<PrismaClient, '$queryRaw' | '$transaction' | 'area' | 'demandDaily'>,
  now: Date,
): Promise<{ days: string[]; written: number }> {
  // Before the API's start has loaded the areas every row would be unknown
  // and its marker would keep the day from being written again.
  if ((await db.area.count()) === 0) return { days: [], written: 0 };
  const closed = closedDays(now);
  const marked = await markedDays(db, closed);
  const days: string[] = [];
  let rows = 0;
  for (const day of closed.filter((d) => !marked.has(d))) {
    const counts = await countBrandArea(db, [day]);
    const date = new Date(day);
    const sums = { requests: 0, searches: 0, unmetRequests: 0 };
    const data = [...counts].map(([key, { requests, searches, unmet }]) => {
      sums.requests += requests;
      sums.searches += searches;
      sums.unmetRequests += unmet;
      return { key, requests, searches, unmetRequests: unmet };
    });
    data.push({ key: MARKER, ...sums });
    const wrote = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('demand_daily'), hashtext(${day}))`;
      if ((await markedDays(tx, [day])).has(day)) return false;
      await tx.demandDaily.deleteMany({
        where: { day: date, dimension: DIMENSION },
      });
      await tx.demandDaily.createMany({
        data: data.map((row) => ({
          ...row,
          day: date,
          dimension: DIMENSION,
          writtenAt: now,
        })),
      });
      return true;
    });
    if (!wrote) continue;
    days.push(day);
    rows += data.length;
  }
  return { days, written: rows };
}

// Approved garages working on the brand, by the area of their position (a
// mobile mechanic's is its seat), counted now.
async function countSupply(db: Pick<PrismaClient, '$queryRaw'>) {
  const rows = await db.$queryRaw<Grouped[]>`
    SELECT brand, area, COUNT(*)::int AS n FROM (
      SELECT b.name AS brand, ${areaOf(Prisma.sql`g.position`)} AS area
      FROM garage g
      JOIN garage_brand gb ON gb.garage_id = g.id
      JOIN brand b ON b.id = gb.brand_id
      WHERE g.status = 'approved' AND gb.stance = 'works_on'
    ) supply GROUP BY brand, area`;
  return new Map(rows.map((row) => [keyOf(row.area, row.brand), row.n]));
}

const byDemand = (a: AdminDemandSupplyRowDto, b: AdminDemandSupplyRowDto) =>
  b.unmet - a.unmet ||
  b.searches - a.searches ||
  b.requests - a.requests ||
  byCodePoint(a.brand, b.brand) ||
  byCodePoint(a.area.name, b.area.name);

// Every stored area by code, then the pseudo-area of the points in none.
async function areaList(db: Pick<PrismaClient, 'area'>) {
  const stored = await db.area.findMany({
    orderBy: { code: 'asc' },
    select: { code: true, kind: true, name: true },
  });
  return [
    ...stored.map((area) => ({
      ...area,
      kind: area.kind as AdminAreaDto['kind'],
    })),
    UNKNOWN,
  ];
}

// The rows the filters keep, with the supply of their brand and area.
function rowsOf(
  counts: Counts,
  supply: Map<string, number>,
  areaBy: Map<string, AdminAreaDto>,
  query: { area?: string; brand?: string },
) {
  const rows: AdminDemandSupplyRowDto[] = [];
  for (const [key, figures] of counts) {
    const { area, brand } = splitKey(key);
    const kept =
      (query.brand === undefined || brand === query.brand) &&
      (query.area === undefined || area === query.area);
    if (!kept) continue;
    const garages = supply.get(key) ?? 0;
    rows.push({
      // An area is never deleted; the code stands in should one go.
      area: areaBy.get(area) ?? { ...UNKNOWN, code: area, name: area },
      brand,
      ...figures,
      requestsPerGarage:
        garages === 0 ? null : Math.round(figures.requests / garages),
      supply: garages,
    });
  }
  return rows.sort(byDemand);
}

// Demand against supply per brand and area over the last 30 days: the
// written closed days from their rows, today and any closed day the night
// has not written counted live; supply as it stands now.
export async function readDemandSupply(
  db: Db,
  now: Date,
  query: { area?: string; brand?: string },
): Promise<AdminDemandSupplyDto> {
  const areas = await areaList(db);
  const areaBy = new Map(areas.map((area) => [area.code, area]));
  if (query.area !== undefined && !areaBy.has(query.area))
    throw new BadRequestException('validation_failed');

  const closed = closedDays(now);
  const today = localDay(now);
  const marked = await markedDays(db, closed);
  const live = [...closed.filter((day) => !marked.has(day)), today];
  const [written, counts, supply] = await Promise.all([
    db.demandDaily.findMany({
      select: {
        key: true,
        requests: true,
        searches: true,
        unmetRequests: true,
      },
      where: {
        day: { in: [...marked.keys()].map((day) => new Date(day)) },
        dimension: DIMENSION,
        key: { not: MARKER },
      },
    }),
    countBrandArea(db, live),
    countSupply(db),
  ]);
  for (const row of written)
    add(counts, row.key, {
      requests: row.requests,
      searches: row.searches,
      unmet: row.unmetRequests,
    });
  const times = [...marked.values()].map((at) => at.getTime());
  return {
    areas,
    firstDay: closed[0],
    lastDay: today,
    rows: rowsOf(counts, supply, areaBy, query),
    writtenAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
