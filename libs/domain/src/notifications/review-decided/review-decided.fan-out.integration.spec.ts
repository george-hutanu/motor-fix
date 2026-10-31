import { DELETED_AUTHOR } from '@motor-fix/contracts';
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  REVIEW_DECIDED_CONSUMER,
  REVIEW_DECIDED_QUEUE,
  ReviewDecidedFanOut,
} from './review-decided.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { garageReviews, reviewReply } from '../../reviews/reviews.testing';
import { bellLink } from '../bell/bell.link';
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
  counterTotal(reader, 'motorfix_review_decision_announced_total', { outcome });

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
  return app.get(ReviewDecidedFanOut);
}

// Andrei's review of Atelier Dinamo, which an admin removed (or whose reply
// it removed), two owners and a receptionist on the garage.
async function decided(target: 'review' | 'reply' = 'review') {
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('dinamo-owner', ['garage']);
  const second = await account('dinamo-second', ['garage'], { language: 'en' });
  const desk = await account('dinamo-desk', ['receptionist']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: second, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  const driverId = await account('Andrei Ion Marin', ['driver'], {
    language: 'en',
  });
  const review = await reviews.review(garage.id, driverId, {
    rating: 1,
    status: target === 'review' ? 'removed' : 'published',
  });
  const answer = await reply(review.id, { status: 'removed' });
  const reporter = await account('Reporter Person', ['garage']);
  const report = await prisma.reviewReport.create({
    data: {
      decidedAt: new Date(),
      decision: 'removed',
      dueAt: new Date(),
      reason: 'insults',
      reporterId: reporter,
      reviewId: review.id,
      source: target === 'review' ? 'garage' : 'author',
      status: 'decided',
      target,
    },
  });
  const payload = {
    decision: 'removed',
    driverId,
    garageId: garage.id,
    mechanicId: null,
    reason: 'insults',
    replyId: answer.id,
    reportId: report.id,
    reviewId: review.id,
    target,
  };
  const job = (id = '71') => ({ data: { id, payload } });
  return { desk, driverId, garage, job, owner, review, second };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REVIEW_DECIDED' },
  });

const bellOf = async (accountId: string) =>
  (await messages(accountId)).find((m) => m.channel === 'in_app');

const bellText = async (accountId: string, language: string) => {
  const row = await bellOf(accountId);
  const params = row?.params as { variant: string } & Record<string, unknown>;
  return render(`REVIEW_DECIDED.${params.variant}`, 'bell', language, params);
};

// @traces 179-FR-011 179-FR-012
describe('telling both sides a review was removed', () => {
  it('tells the author once and each owner once, in their own language', async () => {
    const { desk, driverId, job, owner, review, second } = await decided();
    const fanOut = await start();

    await fanOut.handle(job());

    for (const id of [driverId, owner, second]) {
      const all = await messages(id);
      expect(all.filter((m) => m.channel === 'in_app')).toHaveLength(1);
      for (const message of all) expect(message.subjectId).toBe(review.id);
    }
    expect(await messages(desk)).toEqual([]);
    expect(await bellText(driverId, 'en')).toBe(
      'MotorFix removed your review of Atelier Dinamo: Insults. You can appeal once, within 14 days.',
    );
    expect(await bellText(owner, 'ro')).toBe(
      'Recenzia lui Andrei M. a fost ștearsă: Insulte.',
    );
    expect(await bellText(second, 'en')).toBe(
      "Andrei M.'s review was removed: Insults.",
    );
  });

  it('names nobody who reported it', async () => {
    const { driverId, job, owner } = await decided();
    const fanOut = await start();

    await fanOut.handle(job());

    for (const id of [driverId, owner]) {
      for (const message of await messages(id)) {
        expect(JSON.stringify(message.params)).not.toMatch(
          /Reporter|garage'|source/,
        );
      }
    }
  });

  it('opens the driver’s reviews for the author and the garage’s for the owner', async () => {
    const { driverId, job, owner } = await decided();
    const fanOut = await start();

    await fanOut.handle(job());

    const author = await bellOf(driverId);
    const staff = await bellOf(owner);
    expect(
      bellLink({
        kind: 'REVIEW_DECIDED',
        params: author?.params ?? null,
        subjectId: author?.subjectId ?? null,
      }),
    ).toBe('/app/driver/reviews');
    expect(
      bellLink({
        kind: 'REVIEW_DECIDED',
        params: staff?.params ?? null,
        subjectId: staff?.subjectId ?? null,
      }),
    ).toBe('/app/garage/reviews');
    const mail = (await messages(owner)).find((m) => m.channel === 'email');
    expect(mail?.params).toMatchObject({
      link: 'https://motorfix.test/app/garage/reviews',
    });
  });

  it('writes nothing more for the same event run twice', async () => {
    const { driverId, job, owner } = await decided();
    const fanOut = await start();

    await fanOut.handle(job());
    const built = await counted('built');
    await fanOut.handle(job());

    expect(
      (await messages(driverId)).filter((m) => m.channel === 'in_app'),
    ).toHaveLength(1);
    expect(
      (await messages(owner)).filter((m) => m.channel === 'in_app'),
    ).toHaveLength(1);
    expect(await counted('built')).toBe(built);
  });

  it('skips a deleted author and still tells the owners', async () => {
    const { driverId, job, owner } = await decided();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: driverId },
    });
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await messages(driverId)).toEqual([]);
    expect(await bellOf(owner)).toBeDefined();
    expect(await bellText(owner, 'ro')).toContain(DELETED_AUTHOR);
  });

  it('skips a garage with no active owner and still tells the author', async () => {
    const { driverId, job, owner, second } = await decided();
    await prisma.garageMember.deleteMany({ where: { role: 'owner' } });
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await messages(owner)).toEqual([]);
    expect(await messages(second)).toEqual([]);
    expect(await bellOf(driverId)).toBeDefined();
  });

  it('writes nothing for a payload with no review id, and counts skipped', async () => {
    const { driverId } = await decided();
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle({
      data: { id: '72', payload: { target: 'review' } as never },
    });

    expect(await messages(driverId)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('logs one line with the review id and no name', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { job, review } = await decided();
    const fanOut = await start();
    log.mockClear();

    await fanOut.handle(job());

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(review.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Andrei|Dinamo/);
  });
});

// @traces 179-FR-011
describe('telling both sides a reply was removed', () => {
  it('tells the owners their reply went and the author the garage’s reply went', async () => {
    const { driverId, job, owner } = await decided('reply');
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await bellText(owner, 'ro')).toBe(
      'MotorFix a șters răspunsul tău la recenzia lui Andrei M.: Insulte.',
    );
    expect(await bellText(driverId, 'en')).toBe(
      "Atelier Dinamo's reply to your review was removed: Insults.",
    );
  });
});

describe('the decision queue', () => {
  it('takes review.decided alone from the outbox relay', () => {
    expect(REVIEW_DECIDED_CONSUMER).toMatchObject({
      jobs: { attempts: 6, backoff: { delay: 60_000, type: 'exponential' } },
      kinds: ['review.decided'],
      queue: REVIEW_DECIDED_QUEUE,
    });
    expect(REVIEW_DECIDED_QUEUE).toBe('review-decided');
  });
});
