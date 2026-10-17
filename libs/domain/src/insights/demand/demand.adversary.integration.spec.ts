import { readDemand, writeDemandDaily } from './demand';
import { serialDatabase } from '../../auth/serial-db.testing';
import { addDays, atLocal } from '../../bucharest';
import type { QuoteRequestStatus } from '../../generated/prisma/enums';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const TODAY = '2026-10-17';
const NOW = atLocal(TODAY, 11);

let driverId: string;
let carId: string;

beforeEach(async () => {
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE demand_daily');
  driverId = await world.account('Andrei Ion Marin');
  carId = (await world.car(driverId)).id;
});

afterAll(() => prisma.$disconnect());

const job = (key: string) =>
  prisma.jobType.create({
    data: { key, nameEn: key, nameRo: key, status: 'approved' },
  });

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

const rowsOf = (day: string) =>
  prisma.demandDaily.findMany({
    orderBy: [{ dimension: 'asc' }, { key: 'asc' }],
    select: { dimension: true, key: true, requests: true },
    where: { day: new Date(day) },
  });

describe('the demand read under hostile data', () => {
  // @traces 103-FR-003
  it('counts a request with no job for its brand and in the total', async () => {
    await asked('Dacia', [], atLocal('2026-10-12', 9));

    const demand = await readDemand(prisma, NOW);

    expect(demand.requests).toBe(1);
    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 1, searches: 0 },
    ]);
    expect(demand.jobs).toEqual([]);
  });

  // @traces 103-FR-003
  it('keeps brands differing in case, spacing or accents apart', async () => {
    const brakes = await job('brakes');
    for (const brand of ['Dacia', 'dacia', 'Dacia ', 'Dăcia'])
      await asked(brand, [brakes], atLocal('2026-10-12', 9));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands.map((b) => b.name)).toEqual([
      'Dacia',
      'Dacia ',
      'Dăcia',
      'dacia',
    ]);
    expect(demand.requests).toBe(4);
  });

  // @traces 103-FR-001
  it('orders tied brands by code point, not UTF-16 unit', async () => {
    const brakes = await job('brakes');
    for (const brand of ['\u{1F600}', 'ｚ', 'Z', 'a'])
      await asked(brand, [brakes], atLocal('2026-10-12', 9));

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands.map((b) => b.name)).toEqual([
      'Z',
      'a',
      'ｚ',
      '\u{1F600}',
    ]);
  });

  // @traces 103-FR-001
  it('orders tied jobs by key with uppercase before lowercase', async () => {
    const keys = ['b', 'B', 'a', '_x', '10', '9'];
    for (const key of keys) {
      const j = await job(key);
      await asked('Dacia', [j], atLocal('2026-10-12', 9));
    }

    const demand = await readDemand(prisma, NOW);

    expect(demand.jobs.map((j) => j.key)).toEqual([
      '10',
      '9',
      'B',
      '_x',
      'a',
      'b',
    ]);
  });

  // @traces 103-FR-003
  it('counts a request created at 23:59:59 on the last day of the window in that day and at 00:00:00 tomorrow not at all', async () => {
    const brakes = await job('brakes');
    await asked(
      'Edge',
      [brakes],
      new Date(atLocal(addDays(TODAY, 1), 0).getTime() - 1000),
    );
    await asked('Tomorrow', [brakes], atLocal(addDays(TODAY, 1), 0));

    const demand = await readDemand(prisma, atLocal(TODAY, 23));

    expect(demand.brands).toEqual([{ name: 'Edge', requests: 1, searches: 0 }]);
  });

  // @traces 103-FR-004
  it('ends the day at midnight in Bucharest when now is one second before it', async () => {
    const brakes = await job('brakes');
    await asked('Old', [brakes], atLocal('2026-09-18', 0));
    const justBefore = new Date(atLocal(addDays(TODAY, 1), 0).getTime() - 1000);

    const demand = await readDemand(prisma, justBefore);

    expect(demand.lastDay).toBe(TODAY);
    expect(demand.firstDay).toBe('2026-09-18');
    expect(demand.brands).toEqual([{ name: 'Old', requests: 1, searches: 0 }]);
  });

  // @traces 103-FR-004
  it('moves the window on at midnight so the oldest day drops out', async () => {
    const brakes = await job('brakes');
    await asked('Old', [brakes], atLocal('2026-09-18', 0));

    const demand = await readDemand(prisma, atLocal(addDays(TODAY, 1), 0));

    expect(demand.firstDay).toBe('2026-09-19');
    expect(demand.brands).toEqual([]);
    expect(demand.requests).toBe(0);
  });

  // @traces 103-FR-004
  it('counts the 25-hour day of the autumn clock change in its own calendar day', async () => {
    const brakes = await job('brakes');
    const lateOnChangeDay = new Date(atLocal('2026-10-26', 0).getTime() - 1000);
    await asked('Late', [brakes], lateOnChangeDay);
    await asked('Early', [brakes], atLocal('2026-10-25', 0));
    await asked('Next', [brakes], atLocal('2026-10-26', 0));
    const now = atLocal('2026-10-26', 12);

    await writeDemandDaily(prisma, now);

    expect(await rowsOf('2026-10-25')).toEqual([
      { dimension: 'brand', key: 'Early', requests: 1 },
      { dimension: 'brand', key: 'Late', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 2 },
      { dimension: 'total', key: 'all', requests: 2 },
    ]);
    const demand = await readDemand(prisma, now);
    expect(demand.brands.map((b) => b.name)).toEqual(['Early', 'Late', 'Next']);
  });

  // @traces 103-FR-004
  it('counts the 23-hour day of the spring clock change in its own calendar day', async () => {
    const brakes = await job('brakes');
    await asked(
      'Late',
      [brakes],
      new Date(atLocal('2026-03-30', 0).getTime() - 1000),
    );
    await asked(
      'Before',
      [brakes],
      new Date(atLocal('2026-03-29', 0).getTime() - 1000),
    );
    const now = atLocal('2026-04-02', 12);

    await writeDemandDaily(prisma, now);

    expect(await rowsOf('2026-03-29')).toEqual([
      { dimension: 'brand', key: 'Late', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 1 },
      { dimension: 'total', key: 'all', requests: 1 },
    ]);
    expect(await rowsOf('2026-03-28')).toEqual([
      { dimension: 'brand', key: 'Before', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 1 },
      { dimension: 'total', key: 'all', requests: 1 },
    ]);
  });

  // @traces 103-FR-004
  it('never counts rows of a day before the window', async () => {
    await prisma.demandDaily.createMany({
      data: [
        {
          day: new Date('2026-09-17'),
          dimension: 'brand',
          key: 'Stale',
          requests: 99,
          writtenAt: NOW,
        },
        {
          day: new Date('2026-09-17'),
          dimension: 'total',
          key: 'all',
          requests: 99,
          writtenAt: NOW,
        },
      ],
    });

    const demand = await readDemand(prisma, NOW);

    expect(demand.requests).toBe(0);
    expect(demand.brands).toEqual([]);
  });

  // @traces 103-FR-004
  it('ignores rows written for today and counts today live', async () => {
    const brakes = await job('brakes');
    await asked('Live', [brakes], atLocal(TODAY, 9));
    await prisma.demandDaily.createMany({
      data: [
        {
          day: new Date(TODAY),
          dimension: 'brand',
          key: 'Ghost',
          requests: 50,
          writtenAt: NOW,
        },
        {
          day: new Date(TODAY),
          dimension: 'total',
          key: 'all',
          requests: 50,
          writtenAt: NOW,
        },
      ],
    });

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([{ name: 'Live', requests: 1, searches: 0 }]);
    expect(demand.requests).toBe(1);
  });

  // @traces 103-FR-004
  it('counts a closed day live when it has brand rows but no total row', async () => {
    const brakes = await job('brakes');
    await asked('Real', [brakes], atLocal('2026-10-10', 9));
    await prisma.demandDaily.create({
      data: {
        day: new Date('2026-10-10'),
        dimension: 'brand',
        key: 'Partial',
        requests: 7,
        writtenAt: NOW,
      },
    });

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([{ name: 'Real', requests: 1, searches: 0 }]);
    expect(demand.requests).toBe(1);
  });

  // @traces 103-FR-004
  it('trusts a written zero day over requests created on it afterwards', async () => {
    const brakes = await job('brakes');
    await prisma.demandDaily.create({
      data: {
        day: new Date('2026-10-10'),
        dimension: 'total',
        key: 'all',
        requests: 0,
        writtenAt: NOW,
      },
    });
    await asked('Late', [brakes], atLocal('2026-10-10', 9));

    const demand = await readDemand(prisma, NOW);

    expect(demand.requests).toBe(0);
  });

  // @traces 103-FR-001
  it('answers every one of a thousand brands', async () => {
    const brakes = await job('brakes');
    await asked('Brand 0', [brakes], atLocal('2026-10-12', 9));
    const rows = Array.from({ length: 999 }, (_, i) => ({
      carBrand: `Brand ${i + 1}`,
    }));
    for (const [i, row] of rows.entries()) {
      if (i % 100 === 0)
        await asked(row.carBrand, [brakes], atLocal('2026-10-12', 9));
    }
    await prisma.demandDaily.createMany({
      data: [
        ...Array.from({ length: 1000 }, (_, i) => ({
          day: new Date('2026-10-01'),
          dimension: 'brand',
          key: `B${String(i).padStart(4, '0')}`,
          requests: 1,
          writtenAt: NOW,
        })),
        {
          day: new Date('2026-10-01'),
          dimension: 'total',
          key: 'all',
          requests: 1000,
          writtenAt: NOW,
        },
      ],
    });

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toHaveLength(1000 + 1 + 10);
    expect(demand.requests).toBe(1000 + 11);
  });

  // @traces 103-FR-001
  it('answers a stable shape on an empty database', async () => {
    expect(await readDemand(prisma, NOW)).toEqual({
      brands: [],
      firstDay: '2026-09-18',
      jobs: [],
      lastDay: TODAY,
      requests: 0,
      searches: 0,
      searchesFrom: TODAY,
    });
  });

  // @traces 103-FR-003
  it('counts every request status once', async () => {
    const brakes = await job('brakes');
    const statuses = ['closed', 'done', 'booked'] as QuoteRequestStatus[];
    for (const status of statuses)
      await asked('Dacia', [brakes], atLocal('2026-10-12', 9), status);

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 3, searches: 0 },
    ]);
  });
});

describe('the nightly write under hostile data', () => {
  // @traces 103-FR-005
  it('leaves a written day alone when a request arrives for it later', async () => {
    const brakes = await job('brakes');
    const yesterday = addDays(TODAY, -1);
    await asked('Dacia', [brakes], atLocal(yesterday, 9));
    await writeDemandDaily(prisma, NOW);
    const first = await rowsOf(yesterday);
    await asked('Late', [brakes], atLocal(yesterday, 10));

    const again = await writeDemandDaily(prisma, NOW);

    expect(again.days).toEqual([]);
    expect(await rowsOf(yesterday)).toEqual(first);
  });

  // @traces 103-FR-005
  it('writes the same rows when two runs start together', async () => {
    const brakes = await job('brakes');
    await asked('Dacia', [brakes], atLocal(addDays(TODAY, -1), 9));

    await Promise.all([
      writeDemandDaily(prisma, NOW),
      writeDemandDaily(prisma, NOW),
    ]);

    expect(await rowsOf(addDays(TODAY, -1))).toEqual([
      { dimension: 'brand', key: 'Dacia', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 1 },
      { dimension: 'total', key: 'all', requests: 1 },
    ]);
  });

  // @traces 103-FR-005
  it('writes an empty-string brand as its own row', async () => {
    const brakes = await job('brakes');
    await asked('', [brakes], atLocal(addDays(TODAY, -2), 9));

    await writeDemandDaily(prisma, NOW);

    expect(await rowsOf(addDays(TODAY, -2))).toEqual([
      { dimension: 'brand', key: '', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 1 },
      { dimension: 'total', key: 'all', requests: 1 },
    ]);
  });

  // @traces 103-FR-005
  it('writes nothing for today or for days before the window', async () => {
    const brakes = await job('brakes');
    await asked('Today', [brakes], atLocal(TODAY, 9));
    await asked('Old', [brakes], atLocal('2026-09-17', 9));

    await writeDemandDaily(prisma, NOW);

    expect(await rowsOf(TODAY)).toEqual([]);
    expect(await rowsOf('2026-09-17')).toEqual([]);
  });

  // @traces 103-FR-005
  it('catches up a missed night around a partial set of rows', async () => {
    const brakes = await job('brakes');
    await asked('Dacia', [brakes], atLocal('2026-10-10', 9));
    await prisma.demandDaily.create({
      data: {
        day: new Date('2026-10-10'),
        dimension: 'brand',
        key: 'Partial',
        requests: 9,
        writtenAt: NOW,
      },
    });

    await writeDemandDaily(prisma, NOW);

    expect(await rowsOf('2026-10-10')).toEqual([
      { dimension: 'brand', key: 'Dacia', requests: 1 },
      { dimension: 'job', key: 'brakes', requests: 1 },
      { dimension: 'total', key: 'all', requests: 1 },
    ]);
  });

  // @traces 103-FR-005
  it('writes the job type key, not its name, as the job row key', async () => {
    const j = await prisma.jobType.create({
      data: {
        key: 'brakes',
        nameEn: 'Brakes',
        nameRo: 'Frâne',
        status: 'approved',
      },
    });
    await asked('Dacia', [j], atLocal(addDays(TODAY, -1), 9));

    await writeDemandDaily(prisma, NOW);

    const rows = await rowsOf(addDays(TODAY, -1));
    expect(rows.filter((r) => r.dimension === 'job').map((r) => r.key)).toEqual(
      ['brakes'],
    );
  });
});

describe('searches under hostile data', () => {
  const brand = (name: string) =>
    prisma.brand.create({
      data: { key: `k-${name}`, name, slug: `s-${name}` },
    });

  // @traces 404-demand-searches-FR-002
  it('counts each logged search once, however many follow it from the same driver', async () => {
    const dacia = await brand('Dacia');
    const at = atLocal('2026-10-12', 9);
    await prisma.searchLog.createMany({
      data: [0, 1, 2].map((s) => ({
        at: new Date(at.getTime() + s * 1000),
        brandId: dacia.id,
      })),
    });

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'Dacia', requests: 0, searches: 3 },
    ]);
    expect(demand.searches).toBe(3);
  });

  // @traces 404-demand-searches-FR-001 404-demand-searches-FR-002
  it('answers a brand searched thousands of times and never requested', async () => {
    const bmw = await brand('BMW');
    await prisma.searchLog.createMany({
      data: Array.from({ length: 5000 }, (_, i) => ({
        at: atLocal(addDays(TODAY, -(i % 29)), 12),
        brandId: bmw.id,
      })),
    });
    await writeDemandDaily(prisma, NOW);

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([
      { name: 'BMW', requests: 0, searches: 5000 },
    ]);
    expect(demand.requests).toBe(0);
  });

  // @traces 404-demand-searches-FR-002
  it('counts no search logged after now or before the window', async () => {
    const dacia = await brand('Dacia');
    await prisma.searchLog.createMany({
      data: [
        { at: atLocal(addDays(TODAY, 1), 9), brandId: dacia.id },
        { at: atLocal('2026-09-17', 23), brandId: dacia.id },
      ],
    });

    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([]);
    expect(demand.searches).toBe(0);
  });

  // @traces 404-demand-searches-FR-001
  it('answers zero searches and requests with no brand on an empty window', async () => {
    const demand = await readDemand(prisma, NOW);

    expect(demand.brands).toEqual([]);
    expect([demand.searches, demand.requests]).toEqual([0, 0]);
  });
});
