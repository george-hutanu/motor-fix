// @traces 103-FR-001 103-FR-003 103-FR-004 103-FR-005 103-FR-012
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
      brands: [{ name: 'Dacia', requests: 1 }],
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
    });
  });

  it('counts a request sent to four garages once', async () => {
    const brakes = await job('brakes');
    const request = await asked('Dacia', [brakes], atLocal('2026-10-12', 9));
    for (const name of ['A', 'B', 'C', 'D'])
      await world.recipient(request.id, (await world.garage(name)).id);

    const demand = await readDemand(prisma, NOW);

    expect(demand.requests).toBe(1);
    expect(demand.brands).toEqual([{ name: 'Dacia', requests: 1 }]);
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

    expect(demand.brands).toEqual([{ name: 'Dacia', requests: 6 }]);
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
      { name: 'Dacia', requests: 2 },
      { name: 'Audi', requests: 1 },
      { name: 'BMW', requests: 1 },
      { name: 'audi', requests: 1 },
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
      { name: '', requests: 1 },
      { name: 'Dacia', requests: 1 },
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
