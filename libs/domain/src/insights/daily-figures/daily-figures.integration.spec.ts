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

// 01:00 in Bucharest on 17 June: the night that keeps the 16th and the 15th.
const NIGHT = new Date('2030-06-16T22:00:00Z');
const D1 = '2030-06-16';
const D2 = '2030-06-15';

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
  visitors: Record<string, string[]>,
) {
  for (const [source, keys] of Object.entries(visitors)) {
    await redis.pfadd(`insights:pv:${garageId}:${day}`, ...keys);
    await redis.pfadd(`insights:pv:${garageId}:${day}:${source}`, ...keys);
  }
}

const rows = () =>
  prisma.garageDailyFigures.findMany({
    orderBy: [{ day: 'asc' }, { garageId: 'asc' }],
  });
const row = (garageId: string, day: string) =>
  prisma.garageDailyFigures.findUnique({
    where: { garageId_day: { day: new Date(day), garageId } },
  });

// @traces 143-FR-011
describe('the night that keeps the daily figures', () => {
  it("writes each garage's distinct visitors and the sources they came from", async () => {
    const a = await world.garage('Atelier Dinamo');
    const b = await world.garage('Service Militari');
    await seen(a.id, D1, { home: ['v3'], search: ['v1', 'v2'] });
    await seen(b.id, D1, { profile_direct: ['v1'] });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await row(a.id, D1)).toEqual({
      day: new Date(D1),
      garageId: a.id,
      profileViews: 3,
      profileViewsBySource: { home: 1, search: 2 },
      writtenAt: NIGHT,
    });
    expect(await row(b.id, D1)).toMatchObject({
      profileViews: 1,
      profileViewsBySource: { profile_direct: 1 },
    });
  });

  it('counts a visitor who came from two places once in the total', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { home: ['v1'], search: ['v1'] });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await row(a.id, D1)).toMatchObject({
      profileViews: 1,
      profileViewsBySource: { home: 1, search: 1 },
    });
  });

  it('writes a row of nothing for an approved garage nobody opened', async () => {
    const a = await world.garage('Atelier Dinamo');

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await row(a.id, D1)).toMatchObject({
      profileViews: 0,
      profileViewsBySource: {},
    });
  });

  it('writes no row for a draft garage nobody could open', async () => {
    const a = await world.garage('Atelier Dinamo');
    await prisma.garage.update({
      data: { status: 'draft' },
      where: { id: a.id },
    });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await rows()).toEqual([]);
  });

  it('keeps the views of a garage suspended after they were counted', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { search: ['v1', 'v2'] });
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: a.id },
    });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await row(a.id, D1)).toMatchObject({ profileViews: 2 });
  });

  it('skips a counter whose garage no longer exists', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen('00000000-0000-4000-8000-000000000000', D1, { search: ['v1'] });

    const result = await writeDailyFigures(prisma, redis, NIGHT);

    expect((await rows()).map((r) => r.garageId)).toEqual([a.id, a.id]);
    expect(result.written).toBe(2);
  });

  it('ignores the day secret and the throttle kept beside the counters', async () => {
    const a = await world.garage('Atelier Dinamo');
    await redis.set(`insights:pv:secret:${D1}`, 'secret');
    await redis.set('insights:pv:address:abc', '3');
    await seen(a.id, D1, { search: ['v1'] });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect((await rows()).map((r) => r.garageId)).toEqual([a.id, a.id]);
  });

  it('gives the same rows when it runs twice, never the sum', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { search: ['v1', 'v2'] });

    await writeDailyFigures(prisma, redis, NIGHT);
    const first = await rows();
    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await rows()).toEqual(first);
    expect(await row(a.id, D1)).toMatchObject({ profileViews: 2 });
  });

  it('replaces a row written earlier with the counters as they stand now', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { search: ['v1'] });
    await writeDailyFigures(prisma, redis, new Date('2030-06-15T22:00:00Z'));
    await seen(a.id, D1, { search: ['v2'] });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await row(a.id, D1)).toMatchObject({
      profileViews: 2,
      writtenAt: NIGHT,
    });
  });

  it('leaves the live counters where they are', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { search: ['v1'] });

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await redis.pfcount(`insights:pv:${a.id}:${D1}`)).toBe(1);
  });

  it('holds no address, agent or visitor key in a row', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { search: ['acc-visitor-1'] });

    await writeDailyFigures(prisma, redis, NIGHT);

    const written = await row(a.id, D1);
    expect(Object.keys(written ?? {}).sort()).toEqual([
      'day',
      'garageId',
      'profileViews',
      'profileViewsBySource',
      'writtenAt',
    ]);
    expect(JSON.stringify(written)).not.toContain('acc-visitor-1');
  });

  it('logs the rows it wrote for each day, naming no garage', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const a = await world.garage('Atelier Dinamo');

    await writeDailyFigures(prisma, redis, NIGHT);

    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`written 1 for ${D1}`)),
        expect.stringMatching(new RegExp(`written 1 for ${D2}`)),
      ]),
    );
    expect(lines.join('\n')).not.toContain(a.id);
    log.mockRestore();
  });

  // @traces 143-FR-015
  it('writes no activity, no outbox event and no notification', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D1, { search: ['v1'] });
    const counts = async () => ({
      activity: await prisma.activityLog.count(),
      notifications: await prisma.notification.count(),
      outbox: await prisma.outboxEvent.count(),
    });
    const before = await counts();

    await writeDailyFigures(prisma, redis, NIGHT);

    expect(await counts()).toEqual(before);
  });

  it('fails the run when Redis is down', async () => {
    await world.garage('Atelier Dinamo');
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => undefined);

    await expect(writeDailyFigures(prisma, dead, NIGHT)).rejects.toThrow();
    expect(await rows()).toEqual([]);
    dead.disconnect();
  });
});

// @traces 143-FR-012
describe('a night that did not run', () => {
  it('is caught up by the next, which writes the day before yesterday too', async () => {
    const a = await world.garage('Atelier Dinamo');
    await seen(a.id, D2, { search: ['v1', 'v2'] });
    await seen(a.id, D1, { home: ['v3'] });

    const result = await writeDailyFigures(prisma, redis, NIGHT);

    expect(await row(a.id, D2)).toMatchObject({
      profileViews: 2,
      profileViewsBySource: { search: 2 },
    });
    expect(await row(a.id, D1)).toMatchObject({ profileViews: 1 });
    expect(result).toEqual({ gaps: [], written: 2 });
  });

  it('logs the days older than that as gaps and writes nothing for them', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const a = await world.garage('Atelier Dinamo');
    await prisma.garageDailyFigures.create({
      data: {
        day: new Date('2030-06-12'),
        garageId: a.id,
        profileViews: 4,
        profileViewsBySource: { search: 4 },
        writtenAt: new Date('2030-06-12T22:00:00Z'),
      },
    });

    const result = await writeDailyFigures(prisma, redis, NIGHT);

    expect(result.gaps).toEqual(['2030-06-13', '2030-06-14']);
    expect((await rows()).map((r) => r.day.toISOString().slice(0, 10))).toEqual(
      ['2030-06-12', D2, D1],
    );
    const lines = [...warn.mock.calls, ...log.mock.calls].map(([line]) =>
      String(line),
    );
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringContaining('gap 2030-06-13'),
        expect.stringContaining('gap 2030-06-14'),
      ]),
    );
    warn.mockRestore();
    log.mockRestore();
  });

  it('logs no gap on the first night there is', async () => {
    await world.garage('Atelier Dinamo');

    expect((await writeDailyFigures(prisma, redis, NIGHT)).gaps).toEqual([]);
  });

  it('logs no gap when the night before ran', async () => {
    const a = await world.garage('Atelier Dinamo');
    await writeDailyFigures(prisma, redis, new Date('2030-06-15T22:00:00Z'));

    expect((await writeDailyFigures(prisma, redis, NIGHT)).gaps).toEqual([]);
    expect(await row(a.id, '2030-06-14')).not.toBeNull();
  });
});
