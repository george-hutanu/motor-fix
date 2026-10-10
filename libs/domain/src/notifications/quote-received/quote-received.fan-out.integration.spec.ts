import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  QUOTE_RECEIVED_CONSUMER,
  QUOTE_RECEIVED_QUEUE,
  QuoteReceivedFanOut,
} from './quote-received.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { OutboxRelayModule } from '../../events/outbox-relay/outbox-relay.module';
import { quotesWorld } from '../../quotes/quotes.testing';
import { until } from '../../waits.testing';
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

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_quote_received_total', { outcome });

const jobs = new Queue(QUOTE_RECEIVED_QUEUE, {
  connection: { url: redisUrl },
});

const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};

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

async function start(withRelay = false) {
  app = await Test.createTestingModule({
    imports: [
      ...(withRelay
        ? [
            OutboxRelayModule.register({
              consumers: [QUOTE_RECEIVED_CONSUMER],
              databaseUrl,
              redisUrl,
            }),
          ]
        : []),
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: pushConfig,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  const service = app.get(NotificationsService);
  service.now = () => NOON;
  return { fanOut: app.get(QuoteReceivedFanOut), service };
}

const withDevice = (accountId: string) =>
  prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });

// A driver's request quoted by one garage, and the quote's outbox event.
async function quoted(
  options: { language?: 'ro' | 'en'; note?: string | null } = {},
) {
  const driverId = await account('Ioana Popescu', ['driver'], {
    email: 'driver@example.test',
    language: options.language,
  });
  await prisma.account.update({
    data: { phone: testPhone(9), phoneVerifiedAt: new Date() },
    where: { id: driverId },
  });
  const garage = await world.garage('Atelier Dinamo');
  const request = await world.request(driverId);
  const quote = await world.quote(request.id, garage.id);
  if (options.note !== undefined) {
    await prisma.quote.update({
      data: { note: options.note },
      where: { id: quote.id },
    });
  }
  const payload = {
    driverId,
    garageId: garage.id,
    quoteId: quote.id,
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, `garage:${garage.id}`],
      kind: 'quote.sent',
      payload,
      subjectId: quote.id,
    },
  });
  // The job as the relay queues it.
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: quote.id,
    },
  };
  return { driverId, event, garage, job, quote, request };
}

// A driver picks one channel per type, or turns the type off.
const choose = (
  accountId: string,
  channel: 'email' | 'push' | 'whatsapp',
  enabled = true,
) =>
  prisma.notificationPreference.create({
    data: { accountId, channel, enabled, type: 'QUOTE_RECEIVED' },
  });

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'QUOTE_RECEIVED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

// @traces 344-FR-016
describe('telling the driver about a sent quote', () => {
  it('builds one QUOTE_RECEIVED for the request’s driver, about the quote', async () => {
    const { driverId, job, quote } = await quoted();
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
    for (const message of await messages(driverId)) {
      expect(message.subjectId).toBe(quote.id);
    }
    expect(
      await prisma.notification.count({ where: { kind: 'QUOTE_RECEIVED' } }),
    ).toBe(2);
  });

  it('sends a push to a driver who chose push and has a device', async () => {
    const { driverId, job } = await quoted();
    await choose(driverId, 'push');
    await withDevice(driverId);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(driverId)).toEqual(['in_app', 'push']);
  });

  it('sends the e-mail instead to a driver who chose push but has no device', async () => {
    const { driverId, job } = await quoted();
    await choose(driverId, 'push');
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
  });

  it('never sends the driver an SMS, even with a verified phone', async () => {
    const { job } = await quoted();
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { channel: 'sms', kind: 'QUOTE_RECEIVED' },
      }),
    ).toBe(0);
  });

  it('sends WhatsApp to a driver who chose it', async () => {
    const { driverId, job } = await quoted();
    await choose(driverId, 'whatsapp');
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(driverId)).toContain('whatsapp');
  });

  it('builds nothing outside once the driver turned it off, and keeps the bell row', async () => {
    const { driverId, job } = await quoted();
    await withDevice(driverId);
    await choose(driverId, 'push', false);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(driverId)).toEqual(['in_app']);
  });

  it('tells the driver nothing once the quote no longer waits', async () => {
    const { driverId, job, quote } = await quoted();
    await prisma.quote.update({
      data: { status: 'withdrawn', withdrawnAt: new Date() },
      where: { id: quote.id },
    });
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await messages(driverId)).toEqual([]);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { driverId, job } = await quoted();
    const { fanOut } = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
  });

  it('builds the message from the event the relay queued, once when relayed twice', async () => {
    const handled = jest.spyOn(QuoteReceivedFanOut.prototype, 'handle');
    const { driverId, event } = await quoted();
    await start(true);

    await until('the first run', () => handled.mock.calls.length >= 1);
    await handled.mock.results[0].value;
    await prisma.outboxEvent.update({
      data: { relayedAt: null },
      where: { id: event.id },
    });
    await until('the second run', () => handled.mock.calls.length >= 2);
    await handled.mock.results[1].value;

    expect(await channels(driverId)).toEqual(['email', 'in_app']);
  });
});

// @traces 344-FR-016
describe('what the quote message says', () => {
  it('carries the garage’s name, the range in lei and a link to the driver’s request', async () => {
    const { driverId, job, request } = await quoted();
    const { fanOut } = await start();

    await fanOut.handle(job);

    const [email] = (await messages(driverId)).filter(
      (m) => m.channel === 'email',
    );
    expect(email.params).toEqual({
      garage: 'Atelier Dinamo',
      link: `https://motorfix.test/app/driver/requests/${request.id}`,
      range: '450–600',
    });
  });

  it('carries the same parameters for a driver who reads English', async () => {
    const { driverId, job } = await quoted({ language: 'en' });
    const { fanOut } = await start();

    await fanOut.handle(job);

    const [email] = (await messages(driverId)).filter(
      (m) => m.channel === 'email',
    );
    expect(email.params).toMatchObject({
      garage: 'Atelier Dinamo',
      range: '450–600',
    });
  });

  // @traces 344-FR-018
  it('carries no note, phone, plate or driver name', async () => {
    const { driverId, job } = await quoted({ note: 'Piesele le aducem noi' });
    await withDevice(driverId);
    const { fanOut } = await start();

    await fanOut.handle(job);

    const all = await prisma.notification.findMany({
      where: { accountId: driverId, kind: 'QUOTE_RECEIVED' },
    });
    expect(all.length).toBeGreaterThan(0);
    for (const message of all) {
      const text = JSON.stringify(message.params);
      expect(text).not.toContain('Piesele');
      expect(text).not.toContain(testPhone(9));
      expect(text).not.toContain('B123ABC');
      expect(text).not.toContain('Ioana');
    }
  });
});

// @traces 344-FR-018
describe('what the quote fan-out reports', () => {
  it('counts a message built for the driver as built', async () => {
    const { job } = await quoted();
    const { fanOut } = await start();
    const before = await counted('built');

    await fanOut.handle(job);

    expect(await counted('built')).toBe(before + 1);
  });

  it('counts a driver who muted every outside channel as muted', async () => {
    const { driverId, job } = await quoted();
    await choose(driverId, 'email', false);
    const { fanOut } = await start();
    const before = {
      built: await counted('built'),
      muted: await counted('muted'),
    };

    await fanOut.handle(job);

    expect(await counted('muted')).toBe(before.muted + 1);
    expect(await counted('built')).toBe(before.built);
  });

  it('logs one line with the quote id, and nothing about the range, the note or the driver', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { job, quote } = await quoted({ note: 'Piesele le aducem noi' });
    const { fanOut } = await start();
    log.mockClear();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(quote.id));
    expect(lines).toHaveLength(1);
    // The quote id is a random UUID and may itself hold 450 or 600.
    expect(lines[0].replace(quote.id, '<id>')).not.toMatch(
      /450|600|Piesele|Ioana|Dinamo/,
    );
  });
});
