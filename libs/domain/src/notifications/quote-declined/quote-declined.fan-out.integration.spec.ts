import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  QUOTE_DECLINED_CONSUMER,
  QUOTE_DECLINED_QUEUE,
  QuoteDeclinedFanOut,
} from './quote-declined.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(4);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const jobs = new Queue(QUOTE_DECLINED_QUEUE, {
  connection: { url: redisUrl },
});

// Noon in Bucharest, so nothing waits for the morning.
const NOON = new Date('2026-10-09T09:00:00Z');

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await jobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  await jobs.obliterate({ force: true });
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: null,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  const service = app.get(NotificationsService);
  service.now = () => NOON;
  return { fanOut: app.get(QuoteDeclinedFanOut) };
}

// Andrei declined the quote Volt Auto sent him. The garage has an owner, a
// receptionist reading English, a mechanic who may answer quotes and one who
// may not.
async function declinedQuote() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Volt Auto');
  const owner = await account('Volt Owner', ['garage']);
  const desk = await account('Volt Desk', ['receptionist'], {
    language: 'en',
  });
  const fixer = await account('Volt Fixer', ['mechanic']);
  const hand = await account('Volt Hand', ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.createMany({
    data: [
      {
        accountId: fixer,
        canAnswerQuotes: true,
        garageId: garage.id,
        name: 'Fixer',
      },
      { accountId: hand, garageId: garage.id, name: 'Hand' },
    ],
  });
  const request = await world.request(driverId, { status: 'quoted' });
  const quote = await world.quote(request.id, garage.id, 'declined_by_driver');
  const payload = {
    garageId: garage.id,
    quoteId: quote.id,
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'quote.declined_by_driver',
      payload,
      subjectId: quote.id,
    },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: quote.id,
    },
  };
  return { desk, fixer, hand, job, owner, quote };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'QUOTE_DECLINED_BY_DRIVER' },
  });

// @traces 314-accept-quote-FR-014
describe('telling the garage the driver declined its quote', () => {
  it('listens to quote.declined_by_driver', () => {
    expect(QUOTE_DECLINED_CONSUMER.kinds).toEqual(['quote.declined_by_driver']);
    expect(QUOTE_DECLINED_CONSUMER.queue).toBe(QUOTE_DECLINED_QUEUE);
  });

  it('tells the owner, the receptionist and the mechanic who may answer quotes, about the quote', async () => {
    const { desk, fixer, job, owner, quote } = await declinedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);

    for (const person of [owner, desk, fixer]) {
      const built = await messages(person);
      expect(built.map((m) => m.channel)).toContain('in_app');
      for (const message of built) expect(message.subjectId).toBe(quote.id);
    }
  });

  it('tells no mechanic who may not answer quotes', async () => {
    const { hand, job } = await declinedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await messages(hand)).toEqual([]);
  });

  it('names the driver by the short name, and the car', async () => {
    const { job, owner } = await declinedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);

    const bell = (await messages(owner)).find((m) => m.channel === 'in_app');
    expect(bell?.params).toMatchObject({
      car: 'Mini Cooper S',
      driverShortName: 'Andrei M.',
    });
  });

  it('never sends an SMS', async () => {
    const { job } = await declinedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { channel: 'sms', kind: 'QUOTE_DECLINED_BY_DRIVER' },
      }),
    ).toBe(0);
  });

  it('tells nobody when the quote is no longer declined or gone', async () => {
    const { job, quote } = await declinedQuote();
    await prisma.quote.update({
      data: { status: 'waiting' },
      where: { id: quote.id },
    });
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { kind: 'QUOTE_DECLINED_BY_DRIVER' },
      }),
    ).toBe(0);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await declinedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const once = await prisma.notification.count({
      where: { kind: 'QUOTE_DECLINED_BY_DRIVER' },
    });
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(
      await prisma.notification.count({
        where: { kind: 'QUOTE_DECLINED_BY_DRIVER' },
      }),
    ).toBe(once);
  });
});
