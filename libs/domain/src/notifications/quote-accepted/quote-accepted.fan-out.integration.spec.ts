import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  QUOTE_ACCEPTED_CONSUMER,
  QUOTE_ACCEPTED_QUEUE,
  QuoteAcceptedFanOut,
} from './quote-accepted.fan-out';
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

const jobs = new Queue(QUOTE_ACCEPTED_QUEUE, {
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
  // Brevo's address answers nothing, so the notifications worker never
  // starts and every message stays as the fan-out built it.
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
  return { fanOut: app.get(QuoteAcceptedFanOut) };
}

// Andrei's request, the quote Atelier Dinamo sent him, accepted, and the
// event the accept wrote. The garage has an owner, a receptionist and a
// mechanic who may answer quotes.
async function acceptedQuote() {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const garage = await world.garage('Atelier Dinamo');
  const owner = await account('Dinamo Owner', ['garage']);
  const desk = await account('Dinamo Desk', ['receptionist'], {
    language: 'en',
  });
  const fixer = await account('Dinamo Fixer', ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.create({
    data: {
      accountId: fixer,
      canAnswerQuotes: true,
      garageId: garage.id,
      name: 'Fixer',
    },
  });
  const request = await world.request(driverId, { status: 'booked' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  const booking = await world.booking(quote.id);
  const payload = {
    bookingId: booking.id,
    from: 'waiting',
    historyShared: false,
    quoteId: quote.id,
    requestId: request.id,
    to: 'accepted',
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'quote.accepted',
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
  return { booking, desk, fixer, garage, job, owner, quote };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'QUOTE_ACCEPTED' },
  });

// @traces 222-FR-010
describe('telling the garage its quote was accepted', () => {
  it('listens to quote.accepted', () => {
    expect(QUOTE_ACCEPTED_CONSUMER.kinds).toEqual(['quote.accepted']);
    expect(QUOTE_ACCEPTED_CONSUMER.queue).toBe(QUOTE_ACCEPTED_QUEUE);
  });

  it('builds one QUOTE_ACCEPTED for each owner and receptionist, about the quote', async () => {
    const { desk, job, owner, quote } = await acceptedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);

    for (const person of [owner, desk]) {
      const built = await messages(person);
      expect(built.length).toBeGreaterThan(0);
      expect(built.map((m) => m.channel)).toContain('in_app');
      for (const message of built) {
        expect(message.subjectId).toBe(quote.id);
      }
    }
  });

  it('names the driver, the car and the slot in Romania’s time, in each reader’s language', async () => {
    const { booking, desk, job, owner } = await acceptedQuote();
    await prisma.booking.update({
      data: { startsAt: new Date('2026-10-16T06:00:00Z') },
      where: { id: booking.id },
    });
    const { fanOut } = await start();

    await fanOut.handle(job);

    const bell = async (accountId: string) =>
      (await messages(accountId)).find((m) => m.channel === 'in_app');
    expect((await bell(owner))?.params).toMatchObject({
      car: 'Mini Cooper S',
      driver: 'Andrei M.',
      slot: '2026-10-16T06:00:00.000Z',
    });
    expect((await bell(desk))?.params).toMatchObject({ driver: 'Andrei M.' });
  });

  it('tells no mechanic, even one who may answer quotes', async () => {
    const { fixer, job } = await acceptedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await messages(fixer)).toEqual([]);
  });

  it.each(['confirmed', 'lapsed', 'cancelled'] as const)(
    'tells nobody once the booking is %s',
    async (status) => {
      const { booking, job } = await acceptedQuote();
      await prisma.booking.update({
        data: {
          status,
          ...(status === 'confirmed' && { confirmedAt: new Date() }),
          ...(status === 'cancelled' && {
            cancelledAt: new Date(),
            cancelledBySide: 'driver',
            cancelReason: 'plans_changed',
          }),
        },
        where: { id: booking.id },
      });
      const { fanOut } = await start();

      await fanOut.handle(job);

      expect(
        await prisma.notification.count({ where: { kind: 'QUOTE_ACCEPTED' } }),
      ).toBe(0);
    },
  );

  it('tells nobody when the booking is gone', async () => {
    const { job } = await acceptedQuote();
    const { fanOut } = await start();

    await fanOut.handle({
      data: {
        ...job.data,
        payload: { ...job.data.payload, bookingId: randomUUID() },
      },
    });

    expect(
      await prisma.notification.count({ where: { kind: 'QUOTE_ACCEPTED' } }),
    ).toBe(0);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await acceptedQuote();
    const { fanOut } = await start();

    await fanOut.handle(job);
    const once = await prisma.notification.count({
      where: { kind: 'QUOTE_ACCEPTED' },
    });
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(
      await prisma.notification.count({ where: { kind: 'QUOTE_ACCEPTED' } }),
    ).toBe(once);
  });
});
