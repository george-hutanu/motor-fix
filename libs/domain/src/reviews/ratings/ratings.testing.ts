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

// The review-ratings handler compiled over an empty database for each case,
// with the review rows and the figures a spec reads.
export function ratingsHarness() {
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
    // Compiled, never started: each case hands the handler its event itself.
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

  // A finished job at the garage and its review; each needs its own job.
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

  // The job as the outbox relay queues it.
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

  return {
    elena,
    garageFigures,
    get handler() {
      return handler;
    },
    mechanicFigures,
    prisma,
    review,
    reviews,
    run,
    updates,
    get warn() {
      return warn;
    },
    world,
  };
}
