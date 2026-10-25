import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  REVIEW_POSTED_CONSUMER,
  REVIEW_POSTED_QUEUE,
  ReviewPostedFanOut,
} from './review-posted.fan-out';
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
import { render, templateName } from '../templates';

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
const reviews = garageReviews(world);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_review_announced_total', { outcome });

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
  return app.get(ReviewPostedFanOut);
}

// A garage with an owner who reads English, a receptionist and a mechanic,
// and a review of it by Andrei Ion Marin.
async function reviewed(
  options: { source?: 'job' | 'profile'; owner?: boolean } = {},
) {
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('dinamo-owner', ['garage'], { language: 'en' });
  const receptionist = await account('dinamo-reception', ['garage']);
  const mechanic = await account('dinamo-mechanic', ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      ...(options.owner === false
        ? []
        : [{ accountId: owner, garageId: garage.id, role: 'owner' as const }]),
      { accountId: receptionist, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.create({
    data: {
      accountId: mechanic,
      canAnswerQuotes: true,
      garageId: garage.id,
      name: 'Mihai',
    },
  });
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const review = await reviews.review(garage.id, driverId, {
    rating: 4,
    source: options.source ?? 'job',
  });
  const job = (id = '41') => ({
    data: {
      id,
      kind: 'review.posted',
      payload: { garageId: garage.id, rating: 4, reviewId: review.id },
      subjectId: review.id,
    },
  });
  return { garage, job, mechanic, owner, receptionist, review };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REVIEW_POSTED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const bell = async (accountId: string, language: 'ro' | 'en') => {
  const [row] = (await messages(accountId)).filter(
    (m) => m.channel === 'in_app',
  );
  const params = row.params as Record<string, unknown>;
  return render(
    templateName('REVIEW_POSTED', params),
    'bell',
    language,
    params,
  );
};

// @traces 074-FR-012 074-FR-013 074-FR-017
describe('telling the owner about a new review', () => {
  it('builds REVIEW_POSTED for the owner only, not the receptionist or the mechanic', async () => {
    const { job, mechanic, owner, receptionist, review } = await reviewed();
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await channels(owner)).toEqual(['email', 'in_app']);
    for (const message of await messages(owner)) {
      expect(message.subjectId).toBe(review.id);
    }
    expect(await messages(receptionist)).toEqual([]);
    expect(await messages(mechanic)).toEqual([]);
  });

  it('names the rating, the author by short name and the car in the owner’s language', async () => {
    const { job, owner } = await reviewed();
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await bell(owner, 'en')).toBe(
      'New 4-star review from Andrei M. for a BMW 320d',
    );
    const [email] = (await messages(owner)).filter(
      (m) => m.channel === 'email',
    );
    expect(email.params).toEqual({
      author: 'Andrei M.',
      car: 'BMW 320d',
      link: 'https://motorfix.test/app/garage/reviews',
      rating: 4,
      source: 'job',
    });
    expect(JSON.stringify(email.params)).not.toContain('Marin');
  });

  it('names a deleted author by the stand-in', async () => {
    const { job, owner, review } = await reviewed();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: review.driverId },
    });
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await bell(owner, 'ro')).toBe(
      'Recenzie nouă de 4 de la Șofer MotorFix pentru BMW 320d',
    );
  });

  it('names no car for a profile review', async () => {
    const { job, owner } = await reviewed({ source: 'profile' });
    const fanOut = await start();

    await fanOut.handle(job());

    expect(await bell(owner, 'ro')).toBe('Recenzie nouă de 4 de la Andrei M.');
  });

  it('writes nothing more for the same event run twice', async () => {
    const { job, owner } = await reviewed();
    const fanOut = await start();

    await fanOut.handle(job());
    const before = {
      built: await counted('built'),
      muted: await counted('muted'),
    };
    await fanOut.handle(job());

    expect(await channels(owner)).toEqual(['email', 'in_app']);
    expect(await counted('muted')).toBe(before.muted);
    expect(await counted('built')).toBe(before.built);
  });

  it('sends nothing outside to an owner who muted it, and counts muted', async () => {
    const { garage, job, owner } = await reviewed();
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        garageId: garage.id,
        type: 'REVIEW_POSTED',
      })),
    });
    const fanOut = await start();
    const before = {
      built: await counted('built'),
      muted: await counted('muted'),
    };

    await fanOut.handle(job());

    expect(await channels(owner)).toEqual(['in_app']);
    expect(await counted('muted')).toBe(before.muted + 1);
    expect(await counted('built')).toBe(before.built);
  });

  it('counts a built message once', async () => {
    const { job } = await reviewed();
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job());

    expect(await counted('built')).toBe(before + 1);
  });
});

// @traces 074-FR-013
describe('a review with nobody to tell', () => {
  it('writes nothing for a review that no longer exists, and counts skipped', async () => {
    const { job, owner, review } = await reviewed();
    await prisma.review.delete({ where: { id: review.id } });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it.each([['deleted_by_author'], ['removed']] as const)(
    'writes nothing for a review %s before the job ran, and counts skipped',
    async (status) => {
      const { job, owner, review } = await reviewed();
      await prisma.review.update({
        data: { status },
        where: { id: review.id },
      });
      const fanOut = await start();
      const before = await counted('skipped');

      await fanOut.handle(job());

      expect(await messages(owner)).toEqual([]);
      expect(await counted('skipped')).toBe(before + 1);
    },
  );

  it('writes nothing for a garage with no owner, and counts skipped', async () => {
    const { job, receptionist } = await reviewed({ owner: false });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(receptionist)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('logs one line with the review id and no name or text', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { job, review } = await reviewed();
    const fanOut = await start();
    log.mockClear();

    await fanOut.handle(job());

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(review.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/Andrei|Treabă|BMW/);
  });
});

describe('the review queue', () => {
  it('takes review.posted alone from the outbox relay', () => {
    expect(REVIEW_POSTED_CONSUMER).toMatchObject({
      kinds: ['review.posted'],
      queue: REVIEW_POSTED_QUEUE,
    });
    expect(REVIEW_POSTED_QUEUE).toBe('review-posted');
  });
});
