import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { ReviewRatings } from './ratings';
import { ReviewRatingsModule } from './ratings.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { ReviewSource, ReviewStatus } from '../../generated/prisma/enums';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { databaseUrl, quotesWorld } from '../../quotes/quotes.testing';

const redisUrl = redisUrlFor(10);
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

let app: TestingModule | undefined;
let handler: ReviewRatings;
let warn: jest.SpyInstance;
let driverId: string;

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  await world.reset();
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  driverId = await world.account('Andrei Ion Marin');
  app = await Test.createTestingModule({
    imports: [
      ReviewRatingsModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
      }),
    ],
  }).compile();
  handler = app.get(ReviewRatings);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

interface Reviewed {
  garageId: string;
  mechanicId?: string | null;
  rating: number;
  status?: ReviewStatus;
  source?: ReviewSource;
}

async function review({
  garageId,
  mechanicId = null,
  rating,
  source = 'job',
  status = 'published',
}: Reviewed) {
  const { booking } = await world.chain(driverId, garageId);
  const job = await world.job(booking.id, 'done', {
    mechanicId: mechanicId ?? undefined,
  });
  return prisma.review.create({
    data: {
      driverId,
      garageId,
      jobId: job.id,
      mechanicId,
      rating,
      source,
      status,
    },
  });
}

const reviews = (base: Omit<Reviewed, 'rating'>, ratings: number[]) =>
  Promise.all(ratings.map((rating) => review({ ...base, rating })));

const run = (reviewId: string, kind = 'review.posted') =>
  handler.onEvent({
    data: { id: '1', kind, payload: { reviewId }, subjectId: reviewId },
  });

const shown = (row: { rating: unknown; reviewCount: number }) => ({
  count: row.reviewCount,
  rating: row.rating === null ? null : Number(row.rating),
});

const garageFigures = async (id: string) =>
  shown(await prisma.garage.findUniqueOrThrow({ where: { id } }));

const mechanicFigures = async (id: string) =>
  shown(await prisma.mechanic.findUniqueOrThrow({ where: { id } }));

const updates = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: 'rating.updated' },
  });

async function elena(garageId: string) {
  const accountId = await world.account('Elena Pop', ['mechanic']);
  return prisma.mechanic.create({
    data: { accountId, garageId, name: 'Elena', onProfile: true },
  });
}

const rawEvent = (data: unknown) =>
  handler.onEvent({ data } as Parameters<ReviewRatings['onEvent']>[0]);

// @traces 025-FR-006
describe('rounding at the edges of a decimal', () => {
  it.each([
    ['1,05 up to 1,1', [...Array(19).fill(1), 2], 1.1],
    ['1,04 down to 1,0', [...Array(24).fill(1), 2], 1],
    ['4,95 up to 5,0', [...Array(19).fill(5), 4], 5],
    ['2,25 up to 2,3', [2, 2, 2, 3], 2.3],
    ['2,75 up to 2,8', [2, 3, 3, 3], 2.8],
  ])(
    'rounds %s for the mechanic and the garage',
    async (_, ratings, rating) => {
      const g = await world.garage('Atelier Dinamo');
      const m = await elena(g.id);
      const [one] = await reviews(
        { garageId: g.id, mechanicId: m.id },
        ratings,
      );

      await run(one.id);

      expect(await mechanicFigures(m.id)).toEqual({
        count: ratings.length,
        rating,
      });
      expect(await garageFigures(g.id)).toEqual({
        count: ratings.length,
        rating,
      });
    },
  );
});

// @traces 025-FR-006 025-FR-009
describe('figures that were wrong before the run', () => {
  it('replaces a stale count and rating with what the rows say', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [one] = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 3]);
    await prisma.mechanic.update({
      data: { rating: 1, reviewCount: 99 },
      where: { id: m.id },
    });
    await prisma.garage.update({
      data: { rating: 2, reviewCount: 7 },
      where: { id: g.id },
    });

    await run(one.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 4 });
    expect(await garageFigures(g.id)).toEqual({ count: 2, rating: 4 });
  });

  it('records an event when only the count moved and the rating stayed', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [one] = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 5]);
    await run(one.id);
    const third = await review({ garageId: g.id, mechanicId: m.id, rating: 5 });

    await run(third.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 3, rating: 5 });
    expect((await updates()).map((e) => e.subjectId)).toEqual([
      g.id,
      m.id,
      g.id,
      m.id,
    ]);
  });

  it('records an event when only the rating moved and the count stayed', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [one, two] = await reviews(
      { garageId: g.id, mechanicId: m.id },
      [5, 5],
    );
    await run(one.id);
    await prisma.review.update({ data: { rating: 4 }, where: { id: two.id } });

    await run(two.id, 'review.edited');

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 4.5 });
    expect(await updates()).toHaveLength(4);
  });
});

// @traces 025-FR-006 025-FR-009
describe('every published review taken away', () => {
  it.each(['reported', 'removed', 'deleted_by_author'] as const)(
    'empties the garage and the mechanic once the reviews are %s, with one event each',
    async (status) => {
      const g = await world.garage('Atelier Dinamo');
      const m = await elena(g.id);
      const all = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 4]);
      await run(all[0].id);
      await prisma.review.updateMany({
        data: { status },
        where: { garageId: g.id },
      });
      await run(all[0].id, 'review.decided');
      await run(all[1].id, 'review.decided');

      expect(await mechanicFigures(m.id)).toEqual({ count: 0, rating: null });
      expect(await garageFigures(g.id)).toEqual({ count: 0, rating: null });
      expect(await updates()).toHaveLength(4);
    },
  );

  it('leaves the garage the other mechanic’s reviews when one mechanic’s are all hidden', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const other = await prisma.mechanic.create({
      data: { garageId: g.id, name: 'Ionuț' },
    });
    const [mine] = await reviews({ garageId: g.id, mechanicId: m.id }, [2]);
    const [theirs] = await reviews(
      { garageId: g.id, mechanicId: other.id },
      [5],
    );
    await run(mine.id);
    await run(theirs.id);
    await prisma.review.update({
      data: { status: 'reported' },
      where: { id: mine.id },
    });

    await run(mine.id, 'review.reported');

    expect(await mechanicFigures(m.id)).toEqual({ count: 0, rating: null });
    expect(await mechanicFigures(other.id)).toEqual({ count: 1, rating: 5 });
    expect(await garageFigures(g.id)).toEqual({ count: 1, rating: 5 });
  });
});

// @traces 025-FR-010
describe('events that name no usable review', () => {
  it.each([
    ['a payload id that is not a uuid', { reviewId: 'not-a-uuid' }],
    ['an empty payload id', { reviewId: '' }],
    ['a numeric payload id', { reviewId: 42 }],
    ['a null payload id', { reviewId: null }],
    [
      'an upper-case uuid nobody has',
      {
        reviewId: '00000000-0000-4000-8000-00000000ABCD',
      },
    ],
    ['a sql-looking payload id', { reviewId: "'; DROP TABLE review;--" }],
  ])('logs and writes nothing for %s', async (_, payload) => {
    const g = await world.garage('Atelier Dinamo');
    await review({ garageId: g.id, rating: 4 });

    await expect(
      rawEvent({ id: '1', kind: 'review.posted', payload }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(await garageFigures(g.id)).toEqual({ count: 0, rating: null });
    expect(await updates()).toEqual([]);
    expect(await prisma.review.count()).toBe(1);
  });

  it('logs and writes nothing for an event with neither a review id nor a subject', async () => {
    await expect(
      rawEvent({ id: '1', kind: 'review.posted', payload: {} }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(await updates()).toEqual([]);
  });

  it('logs and writes nothing for an event with no payload at all', async () => {
    await expect(
      rawEvent({ id: '1', kind: 'review.posted' }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reads the subject when the payload id is absent', async () => {
    const g = await world.garage('Atelier Dinamo');
    const one = await review({ garageId: g.id, rating: 4 });

    await rawEvent({
      id: '1',
      kind: 'review.posted',
      payload: {},
      subjectId: one.id,
    });

    expect(await garageFigures(g.id)).toEqual({ count: 1, rating: 4 });
  });

  it('ignores an event of a kind it does not consume without reading the review', async () => {
    const g = await world.garage('Atelier Dinamo');
    const one = await review({ garageId: g.id, rating: 4 });

    await run(one.id, 'garage.updated');
    await run(one.id, '');
    await run(one.id, 'REVIEW.POSTED');

    expect(await garageFigures(g.id)).toEqual({ count: 0, rating: null });
    expect(await updates()).toEqual([]);
  });

  it('ends without a write when the garage went with the review', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const one = await review({ garageId: g.id, mechanicId: m.id, rating: 4 });
    await prisma.garage.delete({ where: { id: g.id } });

    await expect(run(one.id)).resolves.toBeUndefined();

    expect(await updates()).toEqual([]);
  });

  it('writes the garage and ends when the review’s mechanic row is gone', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const one = await review({ garageId: g.id, mechanicId: m.id, rating: 4 });
    await prisma.mechanic.delete({ where: { id: m.id } });

    await run(one.id);

    expect(await garageFigures(g.id)).toEqual({ count: 1, rating: 4 });
    expect((await updates()).map((e) => e.subjectId)).toEqual([g.id]);
  });
});

// @traces 025-FR-002
describe('a profile review among job reviews', () => {
  it('never moves a mechanic although the mechanic’s garage gets its figure', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const profile = await review({
      garageId: g.id,
      rating: 1,
      source: 'profile',
    });

    await run(profile.id);

    expect(await mechanicFigures(m.id)).toEqual({ count: 0, rating: null });
    expect(await garageFigures(g.id)).toEqual({ count: 1, rating: 1 });
    expect((await updates()).map((e) => e.subjectId)).toEqual([g.id]);
  });
});

// @traces 025-FR-008
describe('runs at once over mixed garages', () => {
  it('ends a mechanic’s reviews at three garages with one figure and one event per subject', async () => {
    const garages = await Promise.all([
      world.garage('Atelier Dinamo'),
      world.garage('Service Nord'),
      world.garage('Garage Sud'),
    ]);
    const m = await elena(garages[0].id);
    const all = [];
    for (const [i, garage] of garages.entries()) {
      all.push(
        ...(await reviews({ garageId: garage.id, mechanicId: m.id }, [
          5 - i,
          4 - i,
        ])),
      );
    }

    await Promise.all(all.map((r) => run(r.id)));

    expect(await mechanicFigures(m.id)).toEqual({ count: 6, rating: 3.5 });
    for (const [i, garage] of garages.entries()) {
      expect(await garageFigures(garage.id)).toEqual({
        count: 2,
        rating: 4.5 - i,
      });
    }
    const subjects = (await updates()).map((e) => e.subjectId).sort();
    expect(subjects).toEqual([...garages.map((g) => g.id), m.id].sort());
  });

  it('ends twenty runs of one event with one event per subject', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [one] = await reviews({ garageId: g.id, mechanicId: m.id }, [4, 2]);

    await Promise.all(Array.from({ length: 20 }, () => run(one.id)));

    expect(await mechanicFigures(m.id)).toEqual({ count: 2, rating: 3 });
    expect(await updates()).toHaveLength(2);
  });

  it('ends a run racing a status change with figures matching the final rows', async () => {
    const g = await world.garage('Atelier Dinamo');
    const m = await elena(g.id);
    const [a, b] = await reviews({ garageId: g.id, mechanicId: m.id }, [5, 1]);
    await run(a.id);

    await prisma.review.update({
      data: { status: 'reported' },
      where: { id: b.id },
    });
    await Promise.all([
      run(b.id, 'review.reported'),
      run(a.id, 'review.posted'),
      run(b.id, 'review.reported'),
    ]);

    expect(await mechanicFigures(m.id)).toEqual({ count: 1, rating: 5 });
    expect(await garageFigures(g.id)).toEqual({ count: 1, rating: 5 });
  });
});
