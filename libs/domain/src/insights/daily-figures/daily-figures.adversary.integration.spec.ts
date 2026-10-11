import { Redis } from 'ioredis';

import { writeDailyFigures } from './daily-figures';
import { serialDatabase } from '../../auth/serial-db.testing';
import { redisUrlFor } from '../../notifications/notifications.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const redisUrl = redisUrlFor(6);
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

let redis: Redis;

beforeAll(() => {
  redis = new Redis(redisUrl);
});

afterAll(async () => {
  await redis.quit();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await world.reset();
  await redis.flushdb();
});

async function seen(
  garageId: string,
  day: string,
  keys: string[],
  source = 'search',
) {
  await redis.pfadd(`insights:pv:${garageId}:${day}`, ...keys);
  await redis.pfadd(`insights:pv:${garageId}:${day}:${source}`, ...keys);
}

const days = async () =>
  (await prisma.garageDailyFigures.findMany({ orderBy: { day: 'asc' } })).map(
    (r) => r.day.toISOString().slice(0, 10),
  );

// @traces 143-FR-011 143-FR-012
describe('the night job across the calendar', () => {
  it.each([
    [
      'the night after the clocks go back',
      '2026-10-25T23:00:00Z',
      '2026-10-25',
      '2026-10-24',
    ],
    [
      'the night after the clocks go forward',
      '2026-03-29T22:00:00Z',
      '2026-03-29',
      '2026-03-28',
    ],
    [
      'the night of the new year',
      '2030-12-31T23:00:00Z',
      '2030-12-31',
      '2030-12-30',
    ],
    [
      'the night after a leap day',
      '2032-02-29T23:00:00Z',
      '2032-02-29',
      '2032-02-28',
    ],
  ])('writes the two days before %s', async (_, now, d1, d2) => {
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, d1, ['v1']);
    await seen(g.id, d2, ['v1', 'v2']);

    const result = await writeDailyFigures(prisma, redis, new Date(now));

    expect(await days()).toEqual([d2, d1]);
    expect(result).toEqual({ gaps: [], written: 2 });
    const rows = await prisma.garageDailyFigures.findMany({
      orderBy: { day: 'asc' },
    });
    expect(rows.map((r) => r.profileViews)).toEqual([2, 1]);
  });

  it('takes the day before from the Bucharest date, to the millisecond', async () => {
    await world.garage('Atelier Dinamo');

    await writeDailyFigures(
      prisma,
      redis,
      new Date('2030-06-16T20:59:59.999Z'),
    );
    expect(await days()).toEqual(['2030-06-14', '2030-06-15']);

    await writeDailyFigures(
      prisma,
      redis,
      new Date('2030-06-16T21:00:00.000Z'),
    );
    expect(await days()).toEqual(['2030-06-14', '2030-06-15', '2030-06-16']);
  });
});

// @traces 143-FR-011
describe('the night job at scale and in a race', () => {
  it('writes two rows for each of a hundred and twenty garages and the same on a second run', async () => {
    const now = new Date('2030-06-16T22:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 120; i++)
      ids.push((await world.garage(`Service ${i}`)).id);
    await seen(ids[0], '2030-06-16', ['v1']);
    await seen(ids[119], '2030-06-16', ['v1', 'v2', 'v3']);

    const first = await writeDailyFigures(prisma, redis, now);
    const rows = await prisma.garageDailyFigures.findMany({
      orderBy: [{ day: 'asc' }, { garageId: 'asc' }],
    });
    const second = await writeDailyFigures(prisma, redis, now);

    expect(first).toEqual({ gaps: [], written: 240 });
    expect(second).toEqual(first);
    expect(rows).toHaveLength(240);
    expect(
      await prisma.garageDailyFigures.findMany({
        orderBy: [{ day: 'asc' }, { garageId: 'asc' }],
      }),
    ).toEqual(rows);
  });

  it('gives one row per garage and day when two runs start together', async () => {
    const now = new Date('2030-06-16T22:00:00Z');
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, '2030-06-16', ['v1', 'v2']);

    await Promise.all([
      writeDailyFigures(prisma, redis, now),
      writeDailyFigures(prisma, redis, now),
    ]);

    expect(await prisma.garageDailyFigures.count()).toBe(2);
    expect(
      await prisma.garageDailyFigures.findUnique({
        where: {
          garageId_day: { day: new Date('2030-06-16'), garageId: g.id },
        },
      }),
    ).toMatchObject({ profileViews: 2 });
  });

  it('writes a row of nothing for a garage whose counter holds only the day before', async () => {
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, '2030-06-15', ['v1']);

    await writeDailyFigures(prisma, redis, new Date('2030-06-16T22:00:00Z'));

    const row = await prisma.garageDailyFigures.findUnique({
      where: { garageId_day: { day: new Date('2030-06-16'), garageId: g.id } },
    });
    expect(row).toMatchObject({ profileViews: 0, profileViewsBySource: {} });
  });

  it('writes no row for a counter of a day older than the two it keeps', async () => {
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, '2030-06-14', ['v1']);

    await writeDailyFigures(prisma, redis, new Date('2030-06-16T22:00:00Z'));

    expect(await days()).toEqual(['2030-06-15', '2030-06-16']);
  });
});

// @traces 143-FR-012
describe('a night after Redis lost its counters', () => {
  it('does not turn a figure already written into nothing', async () => {
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, '2030-06-16', ['v1', 'v2', 'v3']);
    await writeDailyFigures(prisma, redis, new Date('2030-06-16T22:00:00Z'));
    await redis.flushdb();

    await writeDailyFigures(prisma, redis, new Date('2030-06-17T22:00:00Z'));

    expect(
      await prisma.garageDailyFigures.findUnique({
        where: {
          garageId_day: { day: new Date('2030-06-16'), garageId: g.id },
        },
      }),
    ).toMatchObject({ profileViews: 3 });
  });
});
