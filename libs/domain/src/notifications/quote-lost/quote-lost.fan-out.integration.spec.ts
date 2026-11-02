import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  QUOTE_LOST_CONSUMER,
  QUOTE_LOST_QUEUE,
  QuoteLostFanOut,
} from './quote-lost.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(10);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

// 23:00 in Bucharest, inside quiet hours.
const NIGHT = new Date('2026-10-09T20:00:00Z');

let app: TestingModule | undefined;
let phones = 0;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
        push: null,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  app.get(NotificationsService).now = () => NIGHT;
  return app.get(QuoteLostFanOut);
}

// A garage with an owner who chose WhatsApp for lost quotes and has a
// confirmed phone, an English receptionist, and a mechanic who may answer
// quotes.
async function staffed(name: string) {
  const garage = await world.garage(name);
  const owner = await account(`${name} Owner`, ['garage']);
  const desk = await account(`${name} Desk`, ['receptionist'], {
    language: 'en',
  });
  const fixer = await account(`${name} Fixer`, ['mechanic']);
  phones += 1;
  await prisma.account.update({
    data: {
      phone: testPhone(phones % 10),
      phoneVerifiedAt: new Date('2026-09-01T00:00:00Z'),
    },
    where: { id: owner },
  });
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
      name,
    },
  });
  await prisma.notificationPreference.create({
    data: {
      accountId: owner,
      channel: 'whatsapp',
      enabled: true,
      garageId: garage.id,
      type: 'QUOTE_LOST',
    },
  });
  return { desk, fixer, garage, owner };
}

// Andrei confirmed Atelier Dinamo's quote: the quotes Service Nord and
// Service Vest sent him were closed, and the confirm left the event.
async function closed() {
  phones = 0;
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const dinamo = await staffed('Atelier Dinamo');
  const nord = await staffed('Service Nord');
  const vest = await staffed('Service Vest');
  const request = await world.request(driverId, { status: 'booked' });
  await world.quote(request.id, dinamo.garage.id, 'accepted');
  const nordQuote = await world.quote(request.id, nord.garage.id, 'lost');
  const vestQuote = await world.quote(request.id, vest.garage.id, 'lost');
  const payload = {
    quoteIds: [nordQuote.id, vestQuote.id],
    requestId: request.id,
  };
  const job = await event(request.id, payload, [nord, vest]);
  return { dinamo, driverId, job, nord, nordQuote, request, vest, vestQuote };
}

async function event(
  requestId: string,
  payload: { quoteIds: string[]; requestId: string },
  garages: { garage: { id: string } }[],
) {
  const row = await prisma.outboxEvent.create({
    data: {
      audience: garages.map((g) => `garage:${g.garage.id}`),
      kind: 'quote.closed',
      payload,
      subjectId: requestId,
    },
  });
  return {
    data: { id: String(row.id), kind: row.kind, payload, subjectId: requestId },
  };
}

const rows = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'QUOTE_LOST' },
  });
const channels = async (accountId: string) =>
  (await rows(accountId)).map((r) => r.channel).sort();

// The quote's car, and its link only while the message is in flight: no
// plate, phone or driver.
const aboutQuote = (
  row: { params: unknown; subjectId: string | null },
  quoteId: string,
) => {
  expect(row.subjectId).toBe(quoteId);
  const { link = '/app/garage/requests', ...rest } = row.params as Record<
    string,
    unknown
  >;
  expect(rest).toEqual({ car: 'Mini Cooper S' });
  expect(link).toMatch(/\/app\/garage\/requests$/);
};

// @traces 223-FR-002 223-FR-006 223-FR-010 223-FR-012 223-FR-013
describe('telling the garages their quote lost', () => {
  it('listens to quote.closed on its own queue', () => {
    expect(QUOTE_LOST_CONSUMER.kinds).toEqual(['quote.closed']);
    expect(QUOTE_LOST_CONSUMER.queue).toBe(QUOTE_LOST_QUEUE);
    expect(QUOTE_LOST_QUEUE).toBe('quote-lost');
  });

  it('tells each owner and receptionist of a losing garage once per channel, about its quote', async () => {
    const { job, nord, nordQuote, vest, vestQuote } = await closed();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const [garage, quote] of [
      [nord, nordQuote],
      [vest, vestQuote],
    ] as const) {
      expect(await channels(garage.owner)).toEqual([
        'email',
        'in_app',
        'whatsapp',
      ]);
      expect(await channels(garage.desk)).toEqual(['email', 'in_app']);
      for (const person of [garage.owner, garage.desk]) {
        for (const row of await rows(person)) aboutQuote(row, quote.id);
      }
    }
  });

  it('tells no mechanic, not the winning garage and not the driver', async () => {
    const { dinamo, driverId, job, nord, vest } = await closed();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const person of [
      dinamo.owner,
      dinamo.desk,
      dinamo.fixer,
      nord.fixer,
      vest.fixer,
      driverId,
    ]) {
      expect(await rows(person)).toEqual([]);
    }
  });

  it('never sends an SMS and holds nothing for the night', async () => {
    const { job } = await closed();
    const fanOut = await start();

    await fanOut.handle(job);

    const all = await prisma.notification.findMany({
      where: { kind: 'QUOTE_LOST' },
    });
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((r) => r.channel === 'sms')).toEqual([]);
    expect(all.filter((r) => r.status === 'held')).toEqual([]);
  });

  it('keeps the bell and the other channels when a receptionist muted e-mail for her garage', async () => {
    const { job, nord, vest } = await closed();
    await prisma.notificationPreference.create({
      data: {
        accountId: nord.desk,
        channel: 'email',
        enabled: false,
        garageId: nord.garage.id,
        type: 'QUOTE_LOST',
      },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(nord.desk)).toEqual(['in_app']);
    expect(await channels(vest.desk)).toEqual(['email', 'in_app']);
  });

  it('sends no WhatsApp for a garage whose WhatsApp is off', async () => {
    const { job, nord, vest } = await closed();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: nord.garage.id, key: 'whatsapp' },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(nord.owner)).toEqual(['email', 'in_app']);
    expect(await channels(vest.owner)).toEqual(['email', 'in_app', 'whatsapp']);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await closed();
    const fanOut = await start();
    const count = () =>
      prisma.notification.count({ where: { kind: 'QUOTE_LOST' } });

    await fanOut.handle(job);
    const once = await count();
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(await count()).toBe(once);
  });

  it('sends nothing and succeeds when no quote was closed', async () => {
    const { nord, request } = await closed();
    const job = await event(
      request.id,
      { quoteIds: [], requestId: request.id },
      [nord],
    );
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect(
      await prisma.notification.count({ where: { kind: 'QUOTE_LOST' } }),
    ).toBe(0);
  });

  it('sends nothing and succeeds for a garage with no staff', async () => {
    const driverId = await account('Ana Pop', ['driver']);
    const empty = await world.garage('Service Gol');
    const request = await world.request(driverId, { status: 'booked' });
    const quote = await world.quote(request.id, empty.id, 'lost');
    const job = await event(
      request.id,
      { quoteIds: [quote.id], requestId: request.id },
      [{ garage: empty }],
    );
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect(
      await prisma.notification.count({ where: { kind: 'QUOTE_LOST' } }),
    ).toBe(0);
  });
});
