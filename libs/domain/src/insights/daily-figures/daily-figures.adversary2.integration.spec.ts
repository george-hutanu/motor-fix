import { Logger } from '@nestjs/common';
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

afterEach(() => jest.restoreAllMocks());

async function seen(garageId: string, day: string, keys: string[]) {
  await redis.pfadd(`insights:pv:${garageId}:${day}`, ...keys);
  await redis.pfadd(`insights:pv:${garageId}:${day}:search`, ...keys);
}

const rowAt = (garageId: string, day: string) =>
  prisma.garageDailyFigures.findUnique({
    where: { garageId_day: { day: new Date(day), garageId } },
  });

async function earlier(garageId: string, day: string) {
  await prisma.garageDailyFigures.create({
    data: {
      day: new Date(day),
      garageId,
      profileViews: 1,
      profileViewsBySource: {},
      writtenAt: new Date(),
    },
  });
}

// @traces 143-FR-012
describe('the gaps the night job reports', () => {
  it('reports one missed day between the last row and the days it fills', async () => {
    const g = await world.garage('Atelier Dinamo');
    await earlier(g.id, '2030-06-11');

    const result = await writeDailyFigures(
      prisma,
      redis,
      new Date('2030-06-16T22:00:00Z'),
    );

    expect(result.gaps).toEqual(['2030-06-12', '2030-06-13', '2030-06-14']);
  });

  it('reports nothing when the last row is the day just before D-2', async () => {
    const g = await world.garage('Atelier Dinamo');
    await earlier(g.id, '2030-06-14');

    const result = await writeDailyFigures(
      prisma,
      redis,
      new Date('2030-06-16T22:00:00Z'),
    );

    expect(result.gaps).toEqual([]);
  });

  it('reports a gap across the end of a month and a year in order', async () => {
    const g = await world.garage('Atelier Dinamo');
    await earlier(g.id, '2030-12-27');

    const result = await writeDailyFigures(
      prisma,
      redis,
      new Date('2031-01-02T22:00:00Z'),
    );

    expect(result.gaps).toEqual([
      '2030-12-28',
      '2030-12-29',
      '2030-12-30',
      '2030-12-31',
    ]);
  });

  it('reports the same gap again on a second run, not a different one', async () => {
    const g = await world.garage('Atelier Dinamo');
    await earlier(g.id, '2030-06-10');
    const now = new Date('2030-06-16T22:00:00Z');

    const first = await writeDailyFigures(prisma, redis, now);
    const second = await writeDailyFigures(prisma, redis, now);

    expect(second.gaps).toEqual(first.gaps);
    expect(first.gaps).toEqual([
      '2030-06-11',
      '2030-06-12',
      '2030-06-13',
      '2030-06-14',
    ]);
  });

  it('does not take a row of a day after the days it fills for the last one', async () => {
    const g = await world.garage('Atelier Dinamo');
    await earlier(g.id, '2030-06-20');

    const result = await writeDailyFigures(
      prisma,
      redis,
      new Date('2030-06-16T22:00:00Z'),
    );

    expect(result.gaps).toEqual([]);
  });

  it('logs each gap as a warning naming the day and no garage', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const g = await world.garage('Atelier Dinamo');
    await earlier(g.id, '2030-06-13');

    await writeDailyFigures(prisma, redis, new Date('2030-06-16T22:00:00Z'));

    const lines = warn.mock.calls.map((call) => call.map(String).join(' '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2030-06-14');
    expect(lines[0]).not.toContain(g.id);
  });
});

// @traces 143-FR-011 143-FR-012
describe('the night job on the nights the clocks change', () => {
  it.each([
    [
      '00:59 after the clocks go back',
      '2026-10-25T21:59:00Z',
      '2026-10-24',
      '2026-10-23',
    ],
    [
      '01:00 on the day the clocks go back',
      '2026-10-24T22:00:00Z',
      '2026-10-24',
      '2026-10-23',
    ],
    [
      'the first minute after the clocks go back',
      '2026-10-25T22:00:00Z',
      '2026-10-25',
      '2026-10-24',
    ],
    [
      'the first hour after the clocks go forward',
      '2026-03-29T01:30:00Z',
      '2026-03-28',
      '2026-03-27',
    ],
    [
      'the day after the clocks go forward',
      '2026-03-29T21:00:00Z',
      '2026-03-29',
      '2026-03-28',
    ],
    [
      '03:30 on the day the clocks go forward',
      '2026-03-29T00:30:00Z',
      '2026-03-28',
      '2026-03-27',
    ],
  ])('fills D-1 and D-2 at %s', async (_, now, d1, d2) => {
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, d1, ['a']);
    await seen(g.id, d2, ['a', 'b']);

    await writeDailyFigures(prisma, redis, new Date(now));

    expect((await rowAt(g.id, d1))?.profileViews).toBe(1);
    expect((await rowAt(g.id, d2))?.profileViews).toBe(2);
    expect(await prisma.garageDailyFigures.count()).toBe(2);
  });

  it('writes the same rows when run at 01:00 on the night of the change and an hour later', async () => {
    const g = await world.garage('Atelier Dinamo');
    await seen(g.id, '2026-10-24', ['a']);

    await writeDailyFigures(prisma, redis, new Date('2026-10-24T22:00:00Z'));
    const first = await prisma.garageDailyFigures.count();
    await writeDailyFigures(prisma, redis, new Date('2026-10-24T23:00:00Z'));

    expect(await prisma.garageDailyFigures.count()).toBe(first);
  });
});
