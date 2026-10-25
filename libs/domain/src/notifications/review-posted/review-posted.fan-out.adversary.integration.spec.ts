import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { ReviewPostedFanOut } from './review-posted.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { garageReviews } from '../../reviews/reviews.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
const reviews = garageReviews(world);
serialDatabase(databaseUrl);

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(ReviewPostedFanOut);
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REVIEW_POSTED' },
  });

async function reviewed(authorName = 'Andrei Ion Marin') {
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('dinamo-owner', ['garage'], { language: 'en' });
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const driverId = await account(authorName, ['driver']);
  const review = await reviews.review(garage.id, driverId, { rating: 4 });
  const job = (id = '51') => ({
    data: { id, payload: { reviewId: review.id } },
  });
  return { driverId, garage, job, owner, review };
}

// @traces 074-FR-012 074-FR-013
describe('telling the owners about a review, awkwardly', () => {
  it('tells each of two owners the same messages, once, when the event runs twice', async () => {
    const { garage, job, owner } = await reviewed();
    const second = await account('dinamo-owner-two', ['garage']);
    await prisma.garageMember.create({
      data: { accountId: second, garageId: garage.id, role: 'owner' },
    });
    const fanOut = await start();

    await fanOut.handle(job());
    await fanOut.handle(job());

    expect((await messages(owner)).map((m) => m.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
    expect((await messages(second)).map((m) => m.channel).sort()).toEqual([
      'email',
      'in_app',
    ]);
  });

  it('still tells an owner when another garage’s owner muted the group', async () => {
    const { job, owner } = await reviewed();
    const nord = await world.garage('Service Nord');
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        garageId: nord.id,
        type: 'REVIEW_POSTED',
      })),
    });
    const fanOut = await start();

    await fanOut.handle(job());

    const channels = (await messages(owner)).map((m) => m.channel);
    expect(channels).toContain('email');
  });

  it('writes nothing for an owner whose account is deleted', async () => {
    const { job, owner } = await reviewed();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: owner },
    });
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await messages(owner)).toEqual([]);
  });

  it('puts only the short name of an author with a long unicode surname in every message', async () => {
    const { job, owner } = await reviewed('Ștefan Ionescu-Păunescu');
    const fanOut = await start();

    await fanOut.handle(job());

    const all = JSON.stringify(await messages(owner), (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(all).toContain('Ștefan I.');
    expect(all).not.toContain('Păunescu');
  });

  it('ends without throwing for a job whose review id is not an id at all', async () => {
    const { owner } = await reviewed();
    const fanOut = await start();

    await expect(
      fanOut.handle({
        data: { id: '52', payload: { reviewId: 'not-a-uuid' } },
      }),
    ).resolves.toBeUndefined();
    expect(await messages(owner)).toEqual([]);
  });

  it('ends without throwing for a job with no review id', async () => {
    const { owner } = await reviewed();
    const fanOut = await start();

    await expect(
      fanOut.handle({
        data: { id: '53', payload: {} as { reviewId: string } },
      }),
    ).resolves.toBeUndefined();
    expect(await messages(owner)).toEqual([]);
  });

  it('builds the message from the stored rating, not from a stale payload', async () => {
    const { owner, review } = await reviewed();
    const fanOut = await start();

    await fanOut.handle({
      data: {
        id: '54',
        payload: { garageId: 'x', rating: 1, reviewId: review.id } as {
          reviewId: string;
        },
      },
    });

    const [row] = await prisma.notification.findMany({
      where: { accountId: owner, channel: 'email', kind: 'REVIEW_POSTED' },
    });
    expect((row.params as { rating: number }).rating).toBe(4);
  });
});
