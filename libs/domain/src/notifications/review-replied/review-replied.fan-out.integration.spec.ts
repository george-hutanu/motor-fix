import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  REVIEW_REPLIED_CONSUMER,
  REVIEW_REPLIED_QUEUE,
  ReviewRepliedFanOut,
} from './review-replied.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { garageReviews, reviewReply } from '../../reviews/reviews.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';
import { render } from '../templates';

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
const reviews = garageReviews(world);
const reply = reviewReply(world);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_review_reply_announced_total', { outcome });

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  // Brevo's address answers nothing, so the notifications worker never
  // starts and every message stays as the fan-out built it.
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
  return app.get(ReviewRepliedFanOut);
}

// Andrei's review of Atelier Dinamo, which its owner answered.
async function replied() {
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('dinamo-owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  const driverId = await account('Andrei Ion Marin', ['driver'], {
    language: 'en',
  });
  const review = await reviews.review(garage.id, driverId, { rating: 3 });
  const one = await reply(review.id);
  const payload = {
    authorId: driverId,
    garageId: garage.id,
    replyId: one.id,
    reviewId: review.id,
  };
  const job = (id = '51') => ({ data: { id, payload } });
  return { driverId, garage, job, owner, review };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REVIEW_REPLIED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

// @traces 075-FR-008
describe('telling the review’s author about the garage’s reply', () => {
  it('builds REVIEW_REPLIED for the author only, naming the garage in the author’s language', async () => {
    const { driverId, job, owner, review } = await replied();
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
    const all = await messages(driverId);
    for (const message of all) expect(message.subjectId).toBe(review.id);
    // The link rides with the e-mail in flight only, never in the bell's row.
    expect(all.find((m) => m.channel === 'email')?.params).toEqual({
      garage: 'Atelier Dinamo',
      link: 'https://motorfix.test/app/driver/reviews',
    });
    const bell = all.find((m) => m.channel === 'in_app');
    expect(bell?.params).toEqual({ garage: 'Atelier Dinamo' });
    expect(
      render(
        'REVIEW_REPLIED',
        'bell',
        'en',
        bell?.params as Record<string, unknown>,
      ),
    ).toBe('Atelier Dinamo replied to your review.');
    expect(await messages(owner)).toEqual([]);
  });

  it('writes nothing more for the same event run twice', async () => {
    const { driverId, job } = await replied();
    const fanOut = await start();

    await fanOut.handle(job());
    const built = await counted('built');
    await fanOut.handle(job());

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
    expect(await counted('built')).toBe(built);
  });

  it('sends nothing outside to an author who muted it, and counts muted', async () => {
    const { driverId, job } = await replied();
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: driverId,
        channel,
        enabled: false,
        type: 'REVIEW_REPLIED',
      })),
    });
    const fanOut = await start();
    const before = await counted('muted');

    await fanOut.handle(job());

    expect(await channels(driverId)).toEqual(['in_app']);
    expect(await counted('muted')).toBe(before + 1);
  });

  it('counts a built message once', async () => {
    const { job } = await replied();
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job());

    expect(await counted('built')).toBe(before + 1);
  });
});

// @traces 075-FR-008
describe('a reply with nobody to tell', () => {
  it('writes nothing for a deleted author, and counts skipped', async () => {
    const { driverId, job } = await replied();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driverId },
    });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(driverId)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it.each([['reported'], ['removed']] as const)(
    'writes nothing for a reply %s before the job ran',
    async (status) => {
      const { driverId, job, review } = await replied();
      await prisma.reviewReply.update({
        data: { status },
        where: { reviewId: review.id },
      });
      const fanOut = await start();

      await fanOut.handle(job());

      expect(await messages(driverId)).toEqual([]);
    },
  );

  it('writes nothing for a review its author deleted before the job ran', async () => {
    const { driverId, job, review } = await replied();
    await prisma.review.update({
      data: { status: 'deleted_by_author' },
      where: { id: review.id },
    });
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await messages(driverId)).toEqual([]);
  });

  it('writes nothing for a payload with no reply id, and counts skipped', async () => {
    const { driverId, review } = await replied();
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle({
      data: { id: '52', payload: { reviewId: review.id } as never },
    });

    expect(await messages(driverId)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('logs one line with the review id and no name or text', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { job, review } = await replied();
    const fanOut = await start();
    log.mockClear();

    await fanOut.handle(job());

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(review.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Andrei|Dinamo|Mulțumim/);
  });
});

describe('the reply queue', () => {
  it('takes review.replied alone from the outbox relay, never review.reply_edited', () => {
    expect(REVIEW_REPLIED_CONSUMER).toMatchObject({
      kinds: ['review.replied'],
      queue: REVIEW_REPLIED_QUEUE,
    });
    expect(REVIEW_REPLIED_QUEUE).toBe('review-replied');
  });
});
