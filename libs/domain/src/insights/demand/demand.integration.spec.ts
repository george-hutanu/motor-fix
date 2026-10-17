// @traces 103-FR-001 103-FR-003 103-FR-004 103-FR-005 103-FR-012
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readDemand, writeDemandDaily } from './demand';
import { serialDatabase } from '../../auth/serial-db.testing';
import { addDays, atLocal } from '../../bucharest';
import type { QuoteRequestStatus } from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

// Saturday 17 October 2026, 11:00 in Bucharest: the window is 18 September
// to 17 October.
const TODAY = '2026-10-17';
const NOW = atLocal(TODAY, 11);
const FIRST = '2026-09-18';

let driverId: string;
let carId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE demand_daily');
  driverId = await world.account('Andrei Ion Marin');
  carId = (await world.car(driverId)).id;
});

afterAll(() => prisma.$disconnect());

const job = (key: string, nameRo = key, nameEn = key) =>
  prisma.jobType.create({ data: { key, nameEn, nameRo, status: 'approved' } });

// A request for `brand` asking for `jobs`, created at `at`.
async function asked(
  brand: string,
  jobs: { id: string }[],
  at: Date,
  status?: QuoteRequestStatus,
) {
  const request = await world.request(driverId, {
    carId,
    createdAt: at,
    status,
  });
  await prisma.quoteRequest.update({
    data: { carBrand: brand },
    where: { id: request.id },
  });
  await prisma.requestJob.deleteMany({ where: { requestId: request.id } });
  await prisma.requestJob.createMany({
    data: jobs.map((j, position) => ({
      jobTypeId: j.id,
      position,
      requestId: request.id,
    })),
  });
  return request;
}

// A search for the catalogue brand named `name`, logged at `at`. The slug
// keeps "Audi" and "audi" apart.
async function searched(name: string, at: Date, times = 1) {
  const slug = `brand-${[...name].map((c) => c.codePointAt(0)).join('-')}`;
  const brand =
    (await prisma.brand.findUnique({ where: { name } })) ??
    (await prisma.brand.create({ data: { key: slug, name, slug } }));
  await prisma.searchLog.createMany({
    data: Array.from({ length: times }, () => ({ at, brandId: brand.id })),
  });
  return brand;
}

const rowsOf = (day: string) =>
  prisma.demandDaily.findMany({
    orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
    select: { dimension: true, key: true, requests: true },
    where: { day: new Date(day) },
  });

describe('the demand of the last 30 days', () => {
  it('counts a request with two jobs once for its brand and once per job', async () => {
    const brakes = await job('brakes', 'Frâne', 'Brakes');
    const oil = await job('oil-service', 'Schimb ulei', 'Oil service');
    await asked('Dacia', [brakes, oil], atLocal('2026-10-12', 9));

    expect(await readDemand(prisma, NOW)).toEqual({
      brands: [{ name: 'Dacia', requests: 1, searches: 0 }],
      firstDay: FIRST,
      jobs: [
        { key: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne', requests: 1 },
        {
          key: 'oil-service',
          nameEn: 'Oil service',
          nameRo: 'Schimb ulei',
          requests: 1,
        },
      ],
      lastDay: TODAY,
      requests: 1,
      searches: 0,
      searchesFrom: TODAY,
    });
  });

  it('counts a request sent to four garages once', async () => {
    const brakes = await job('brakes');
    const request = await asked('Dacia', [brakes], atLocal('2026-10-12', 9));
    for (const name of ['A', 'B', 'C', 'D'])
      await world.recipient(request.id, (await world.garage(name)).id);

    const demand = await readDemand(prisma, NOW);

    expect(demand.requests).toBe(1);
    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 1, searches: 0 },
    ]);
    expect(demand.jobs.map((j) => j.requests)).toEqual([1]);
  });

  it('starts the window at midnight in Bucharest 29 days before today', async () => {
    const brakes = await job('brakes');
    const start = atLocal(FIRST, 0);
    await asked('Before', [brakes], new Date(start.getTime() - 1000));
    await asked('First', [brakes], start);
    await asked('Late', [brakes], atLocal(TODAY, 10));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands.map((b) => b.name)).toEqual(['First', 'Late']);
    expect(demand.requests).toBe(2);
  });

  it('reads closed days from the nightly rows and counts today live', async () => {
    const brakes = await job('brakes');
    const day = new Date('2026-10-10');
    await prisma.demandDaily.createMany({
      data: [
        { day, dimension: 'brand', key: 'Dacia', requests: 5, writtenAt: NOW },
        { day, dimension: 'job', key: 'brakes', requests: 5, writtenAt: NOW },
        { day, dimension: 'total', key: 'all', requests: 5, writtenAt: NOW },
      ],
    });
    // A request on a written day is not counted again: the rows are the day.
    await asked('Opel', [brakes], atLocal('2026-10-10', 12));
    await asked('Dacia', [brakes], atLocal(TODAY, 10));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 6, searches: 0 },
    ]);
    expect(demand.jobs.map((j) => [j.key, j.requests])).toEqual([
      ['brakes', 6],
    ]);
    expect(demand.requests).toBe(6);
  });

  it('counts a closed day without rows live', async () => {
    const brakes = await job('brakes');
    await asked('Dacia', [brakes], atLocal('2026-10-05', 15));

    expect((await readDemand(prisma, NOW)).requests).toBe(1);
  });

  it('adds the brand bars up to the total and orders ties by stored name and job key', async () => {
    const b = await job('b-job');
    const a = await job('a-job');
    const at = atLocal('2026-10-14', 8);
    await asked('audi', [b], at);
    await asked('BMW', [a], at);
    await asked('Audi', [a, b], at);
    await asked('Dacia', [b], at);
    await asked('Dacia', [b], at);

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 2, searches: 0 },
      { name: 'Audi', requests: 1, searches: 0 },
      { name: 'BMW', requests: 1, searches: 0 },
      { name: 'audi', requests: 1, searches: 0 },
    ]);
    expect(demand.brands.reduce((sum, x) => sum + x.requests, 0)).toBe(
      demand.requests,
    );
    expect(demand.jobs.map((j) => [j.key, j.requests])).toEqual([
      ['b-job', 4],
      ['a-job', 2],
    ]);
  });

  it('keeps an empty brand as its own brand and counts closed requests', async () => {
    const brakes = await job('brakes');
    await asked('', [brakes], atLocal('2026-10-13', 9));
    await asked('Dacia', [brakes], atLocal('2026-10-13', 9), 'closed');

    expect((await readDemand(prisma, NOW)).brands).toEqual([
      { name: '', requests: 1, searches: 0 },
      { name: 'Dacia', requests: 1, searches: 0 },
    ]);
  });

  it("names a job by the catalogue's current names", async () => {
    const brakes = await job('brakes', 'Frâne', 'Brakes');
    await asked('Dacia', [brakes], atLocal('2026-10-13', 9));
    await writeDemandDaily(prisma, NOW);
    await prisma.jobType.update({
      data: { nameEn: 'Brake work', nameRo: 'Sistem de frânare' },
      where: { id: brakes.id },
    });

    expect((await readDemand(prisma, NOW)).jobs).toEqual([
      {
        key: 'brakes',
        nameEn: 'Brake work',
        nameRo: 'Sistem de frânare',
        requests: 1,
      },
    ]);
  });

  it('answers an empty window with no bars', async () => {
    expect(await readDemand(prisma, NOW)).toEqual({
      brands: [],
      firstDay: FIRST,
      jobs: [],
      lastDay: TODAY,
      requests: 0,
      searches: 0,
      searchesFrom: TODAY,
    });
  });
});

describe('the nightly demand rows', () => {
  const yesterday = addDays(TODAY, -1);

  it("writes yesterday's requests by brand, by job and in total, once", async () => {
    const brakes = await job('brakes', 'Frâne', 'Brakes');
    for (let i = 0; i < 3; i++)
      await asked('Dacia', [brakes], atLocal(yesterday, 9 + i));
    for (let i = 0; i < 2; i++)
      await asked('Volkswagen', [brakes], atLocal(yesterday, 14 + i));

    await writeDemandDaily(prisma, NOW);
    const first = await rowsOf(yesterday);
    const again = await writeDemandDaily(prisma, NOW);

    expect(first).toEqual([
      { dimension: 'brand', key: 'Dacia', requests: 3 },
      { dimension: 'brand', key: 'Volkswagen', requests: 2 },
      { dimension: 'job', key: 'brakes', requests: 5 },
      { dimension: 'total', key: 'all', requests: 5 },
    ]);
    expect(again).toEqual({ days: [], written: 0 });
    expect(await rowsOf(yesterday)).toEqual(first);
  });

  it('writes each day once when two runs overlap, and the second changes nothing', async () => {
    const brakes = await job('brakes');
    await asked('Dacia', [brakes], atLocal(yesterday, 9));
    const LATER = atLocal(TODAY, 12);

    const [one, two] = await Promise.all([
      writeDemandDaily(prisma, NOW),
      writeDemandDaily(prisma, LATER),
    ]);

    const rows = await prisma.demandDaily.findMany({
      select: { day: true, writtenAt: true },
    });
    expect(one.written + two.written).toBe(rows.length);
    expect([...one.days, ...two.days].sort()).toHaveLength(29);
    expect(new Set([...one.days, ...two.days]).size).toBe(29);
    const stamps = new Map<string, Set<number>>();
    for (const row of rows) {
      const key = row.day.toISOString();
      stamps.set(
        key,
        (stamps.get(key) ?? new Set()).add(row.writtenAt.getTime()),
      );
    }
    for (const set of stamps.values()) expect(set.size).toBe(1);
  });

  it('writes every closed day of the window that has no rows, an empty one as a total of 0', async () => {
    const brakes = await job('brakes');
    await asked('Dacia', [brakes], atLocal(addDays(TODAY, -5), 9));
    await asked('Dacia', [brakes], atLocal(TODAY, 9));

    const { days } = await writeDemandDaily(prisma, NOW);

    expect(days).toHaveLength(29);
    expect(days).toContain(FIRST);
    expect(days).not.toContain(TODAY);
    expect(await rowsOf(addDays(TODAY, -6))).toEqual([
      { dimension: 'total', key: 'all', requests: 0 },
    ]);
    expect(await rowsOf(addDays(TODAY, -5))).toEqual([
      { dimension: 'brand', key: 'Dacia', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 1 },
      { dimension: 'total', key: 'all', requests: 1 },
    ]);
    expect(await rowsOf(TODAY)).toEqual([]);
  });

  it('gives the same answer from the rows as from a live count', async () => {
    const brakes = await job('brakes');
    const oil = await job('oil');
    await asked('Dacia', [brakes, oil], atLocal(addDays(TODAY, -3), 9));
    await asked('BMW', [oil], atLocal(addDays(TODAY, -20), 23));
    await asked('Dacia', [brakes], atLocal(addDays(TODAY, -29), 0));
    const live = await readDemand(prisma, NOW);

    await writeDemandDaily(prisma, NOW);

    expect(await readDemand(prisma, NOW)).toEqual(live);
  });
});

const searchRowsOf = (day: string) =>
  prisma.demandDaily.findMany({
    orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
    select: { dimension: true, key: true, requests: true, searches: true },
    where: { day: new Date(day) },
  });

describe('searches beside requests', () => {
  // @traces 404-demand-searches-FR-001 404-demand-searches-FR-002 404-demand-searches-FR-013
  it('counts the searches and the requests of one brand apart', async () => {
    const brakes = await job('brakes');
    await searched('Dacia', atLocal('2026-10-12', 9), 3);
    await asked('Dacia', [brakes], atLocal('2026-10-12', 10));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 1, searches: 3 },
    ]);
    expect(demand.searches).toBe(3);
    expect(demand.requests).toBe(1);
  });

  // @traces 404-demand-searches-FR-002 404-demand-searches-FR-013
  it('keeps a brand searched and never requested, and one requested and never searched', async () => {
    const brakes = await job('brakes');
    await searched('BMW', atLocal('2026-10-12', 9), 2);
    await asked('Renault', [brakes], atLocal('2026-10-12', 10));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'BMW', requests: 0, searches: 2 },
      { name: 'Renault', requests: 1, searches: 0 },
    ]);
    expect(demand.brands.reduce((sum, b) => sum + b.searches, 0)).toBe(
      demand.searches,
    );
    expect(demand.brands.reduce((sum, b) => sum + b.requests, 0)).toBe(
      demand.requests,
    );
  });

  // @traces 404-demand-searches-FR-002
  it('joins a request and a search only when the brand names are the same string', async () => {
    const brakes = await job('brakes');
    await searched('Dacia', atLocal('2026-10-12', 9));
    await asked('dacia', [brakes], atLocal('2026-10-12', 10));

    expect((await readDemand(prisma, NOW)).brands).toEqual([
      { name: 'Dacia', requests: 0, searches: 1 },
      { name: 'dacia', requests: 1, searches: 0 },
    ]);
  });

  // @traces 404-demand-searches-FR-002
  it('counts a search with no area', async () => {
    const brand = await searched('Dacia', atLocal('2026-10-12', 9));
    await prisma.searchLog.create({
      data: {
        areaCell: 'u8vx2',
        at: atLocal('2026-10-12', 9),
        brandId: brand.id,
      },
    });

    expect((await readDemand(prisma, NOW)).searches).toBe(2);
  });

  // @traces 404-demand-searches-FR-002 404-demand-searches-FR-009
  it('orders brands by searches, then requests, then name', async () => {
    const brakes = await job('brakes');
    const at = atLocal('2026-10-12', 9);
    await searched('Audi', at, 2);
    await searched('BMW', at, 2);
    await asked('BMW', [brakes], at);
    await searched('Opel', at, 5);
    await asked('Renault', [brakes], at);
    await asked('Renault', [brakes], at);
    await searched('audi', at, 2);

    expect(
      (await readDemand(prisma, NOW)).brands.map((b) => [
        b.name,
        b.searches,
        b.requests,
      ]),
    ).toEqual([
      ['Opel', 5, 0],
      ['BMW', 2, 1],
      ['Audi', 2, 0],
      ['audi', 2, 0],
      ['Renault', 0, 2],
    ]);
  });

  // @traces 404-demand-searches-FR-003 404-demand-searches-FR-013
  it('starts the searches at midnight in Bucharest on the first day', async () => {
    const start = atLocal(FIRST, 0);
    await searched('Before', new Date(start.getTime() - 1000));
    await searched('First', start);

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands.map((b) => b.name)).toEqual(['First']);
    expect(demand.searches).toBe(1);
  });

  // @traces 404-demand-searches-FR-003 404-demand-searches-FR-004 404-demand-searches-FR-013
  it('puts a search at 23:59:59 on its day and one at midnight on the next', async () => {
    const day = addDays(TODAY, -3);
    await searched(
      'Late',
      new Date(atLocal(addDays(day, 1), 0).getTime() - 1000),
    );
    await searched('Early', atLocal(addDays(day, 1), 0));

    await writeDemandDaily(prisma, NOW);

    expect(await searchRowsOf(day)).toEqual([
      { dimension: 'brand', key: 'Late', requests: 0, searches: 1 },
      { dimension: 'total', key: 'all', requests: 0, searches: 1 },
    ]);
    expect(await searchRowsOf(addDays(day, 1))).toEqual([
      { dimension: 'brand', key: 'Early', requests: 0, searches: 1 },
      { dimension: 'total', key: 'all', requests: 0, searches: 1 },
    ]);
  });

  // @traces 404-demand-searches-FR-003
  it('reads the searches of a written day from its rows and counts today live', async () => {
    const day = new Date('2026-10-10');
    await prisma.demandDaily.createMany({
      data: [
        {
          day,
          dimension: 'brand',
          key: 'Dacia',
          requests: 0,
          searches: 4,
          writtenAt: NOW,
        },
        {
          day,
          dimension: 'total',
          key: 'all',
          requests: 0,
          searches: 4,
          writtenAt: NOW,
        },
      ],
    });
    // A search on a written day is not counted again: the rows are the day.
    await searched('Dacia', atLocal('2026-10-10', 12));
    await searched('Dacia', atLocal(TODAY, 10));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 0, searches: 5 },
    ]);
    expect(demand.searches).toBe(5);
  });

  // @traces 404-demand-searches-FR-003
  it('counts the searches of a closed day without rows live', async () => {
    await searched('Dacia', atLocal('2026-10-05', 15));

    expect((await readDemand(prisma, NOW)).searches).toBe(1);
  });

  // @traces 404-demand-searches-FR-002 404-demand-searches-FR-003
  it("keeps a written day's brand name and counts today under the brand's current name", async () => {
    const brand = await searched('Dacia', atLocal(addDays(TODAY, -2), 9));
    await writeDemandDaily(prisma, NOW);
    await prisma.brand.update({
      data: { name: 'Dacia Motors' },
      where: { id: brand.id },
    });
    await searched('Dacia Motors', atLocal(TODAY, 9));

    expect((await readDemand(prisma, NOW)).brands).toEqual([
      { name: 'Dacia', requests: 0, searches: 1 },
      { name: 'Dacia Motors', requests: 0, searches: 1 },
    ]);
  });

  // @traces 404-demand-searches-FR-003 404-demand-searches-FR-004
  it('gives the same searches from the rows as from a live count', async () => {
    const brakes = await job('brakes');
    await searched('Dacia', atLocal(addDays(TODAY, -3), 9), 2);
    await searched('BMW', atLocal(addDays(TODAY, -20), 23));
    await asked('Dacia', [brakes], atLocal(addDays(TODAY, -3), 10));
    await searched('Opel', atLocal(addDays(TODAY, -29), 0));
    const live = await readDemand(prisma, NOW);

    await writeDemandDaily(prisma, NOW);

    expect(await readDemand(prisma, NOW)).toEqual(live);
  });
});

describe('the nightly rows with searches', () => {
  const yesterday = addDays(TODAY, -1);

  // @traces 404-demand-searches-FR-004 404-demand-searches-FR-013
  it('writes searches on the brand rows and the total, 0 on the job rows, once', async () => {
    const brakes = await job('brakes');
    await searched('Dacia', atLocal(yesterday, 9), 3);
    await asked('Dacia', [brakes], atLocal(yesterday, 10));
    await searched('BMW', atLocal(yesterday, 11));

    await writeDemandDaily(prisma, NOW);
    const first = await searchRowsOf(yesterday);
    const again = await writeDemandDaily(prisma, NOW);

    expect(first).toEqual([
      { dimension: 'brand', key: 'BMW', requests: 0, searches: 1 },
      { dimension: 'brand', key: 'Dacia', requests: 1, searches: 3 },
      { dimension: 'job', key: 'brakes', requests: 1, searches: 0 },
      { dimension: 'total', key: 'all', requests: 1, searches: 4 },
    ]);
    expect(again).toEqual({ days: [], written: 0 });
    expect(await searchRowsOf(yesterday)).toEqual(first);
  });

  // @traces 404-demand-searches-FR-004
  it('writes a day with neither search nor request as a total of 0 searches', async () => {
    await writeDemandDaily(prisma, NOW);

    expect(await searchRowsOf(yesterday)).toEqual([
      { dimension: 'total', key: 'all', requests: 0, searches: 0 },
    ]);
  });
});

describe('since when searches are counted', () => {
  // @traces 404-demand-searches-FR-005 404-demand-searches-FR-013
  it('names the day of the first search when it falls inside the window', async () => {
    await searched('Dacia', atLocal('2026-10-11', 0));
    await searched('Dacia', atLocal('2026-10-15', 9));

    expect((await readDemand(prisma, NOW)).searchesFrom).toBe('2026-10-11');
  });

  // @traces 404-demand-searches-FR-005
  it('names today when no search was ever logged', async () => {
    expect((await readDemand(prisma, NOW)).searchesFrom).toBe(TODAY);
  });

  // @traces 404-demand-searches-FR-005
  it('names nothing when searches were counted from the first day or before', async () => {
    await searched('Dacia', atLocal(FIRST, 0));

    expect((await readDemand(prisma, NOW)).searchesFrom).toBeUndefined();
  });

  // @traces 404-demand-searches-FR-005
  it('names nothing when the first search is older than the window', async () => {
    await searched('Dacia', atLocal('2026-08-01', 9));

    expect((await readDemand(prisma, NOW)).searchesFrom).toBeUndefined();
  });

  // @traces 404-demand-searches-FR-005
  it('names its own day for a search at midnight in Bucharest', async () => {
    await searched('Dacia', atLocal('2026-10-12', 0));

    expect((await readDemand(prisma, NOW)).searchesFrom).toBe('2026-10-12');
  });
});

describe('the searches of days written before searches were counted', () => {
  const MIGRATION = join(
    __dirname,
    '../../../prisma/migrations/20261018090000_demand_daily_searches/migration.sql',
  );

  // The part of the migration after its backfill marker, statement by statement.
  const backfill = () =>
    readFileSync(MIGRATION, 'utf8')
      .split('-- backfill')[1]
      .split(/;\s*$/m)
      .map((sql) => sql.trim())
      .filter((sql) => sql.replace(/--.*$/gm, '').trim() !== '');

  const run = async () => {
    for (const sql of backfill()) await prisma.$executeRawUnsafe(sql);
  };

  // @traces 404-demand-searches-FR-002 404-demand-searches-FR-003
  it('fills the searches of written days only, adds a searched-only brand and can run again', async () => {
    const written = new Date('2026-10-10');
    await prisma.demandDaily.createMany({
      data: [
        {
          day: written,
          dimension: 'brand',
          key: 'Dacia',
          requests: 2,
          writtenAt: NOW,
        },
        {
          day: written,
          dimension: 'job',
          key: 'brakes',
          requests: 2,
          writtenAt: NOW,
        },
        {
          day: written,
          dimension: 'total',
          key: 'all',
          requests: 2,
          writtenAt: NOW,
        },
      ],
    });
    await searched('Dacia', atLocal('2026-10-10', 9), 3);
    await searched('BMW', atLocal('2026-10-10', 23));
    await searched('Opel', atLocal('2026-10-11', 9));

    await run();
    await run();

    expect(
      await prisma.demandDaily.findMany({
        orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
        select: {
          dimension: true,
          key: true,
          requests: true,
          searches: true,
          writtenAt: true,
        },
        where: { day: written },
      }),
    ).toEqual([
      {
        dimension: 'brand',
        key: 'BMW',
        requests: 0,
        searches: 1,
        writtenAt: NOW,
      },
      {
        dimension: 'brand',
        key: 'Dacia',
        requests: 2,
        searches: 3,
        writtenAt: NOW,
      },
      {
        dimension: 'job',
        key: 'brakes',
        requests: 2,
        searches: 0,
        writtenAt: NOW,
      },
      {
        dimension: 'total',
        key: 'all',
        requests: 2,
        searches: 4,
        writtenAt: NOW,
      },
    ]);
    expect(await searchRowsOf('2026-10-11')).toEqual([]);
  });
});
