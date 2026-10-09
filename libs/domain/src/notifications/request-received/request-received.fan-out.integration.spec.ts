import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';

import {
  REQUEST_RECEIVED_CONSUMER,
  REQUEST_RECEIVED_QUEUE,
  RequestReceivedFanOut,
} from './request-received.fan-out';
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
  counterTotal(reader, 'motorfix_request_received_total', { outcome });

const jobs = new Queue(REQUEST_RECEIVED_QUEUE, {
  connection: { url: redisUrl },
});

const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};

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
              consumers: [REQUEST_RECEIVED_CONSUMER],
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
  return {
    fanOut: app.get(RequestReceivedFanOut),
    service: app.get(NotificationsService),
  };
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

// A garage with an owner, a receptionist, a mechanic who may answer quotes
// and one who may not; every account has an e-mail address.
async function staffedGarage(key = 'dinamo') {
  const garage = await world.garage(`Atelier ${key}`);
  const owner = await account(`${key}-owner`, ['garage']);
  const receptionist = await account(`${key}-reception`, ['garage'], {
    language: 'en',
  });
  const answering = await account(`${key}-answering`, ['mechanic']);
  const silent = await account(`${key}-silent`, ['mechanic']);
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: receptionist, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.createMany({
    data: [
      {
        accountId: answering,
        canAnswerQuotes: true,
        garageId: garage.id,
        name: 'Mihai',
      },
      { accountId: silent, garageId: garage.id, name: 'Dan' },
    ],
  });
  return { answering, garage, owner, receptionist, silent };
}

// A sent request from a driver to the given garages, and its outbox event.
async function sent(
  garageIds: readonly string[],
  options: { description?: string | null } = {},
) {
  const driverId = await account('driver', ['driver'], {
    email: 'driver@example.test',
  });
  await prisma.account.update({
    data: { phone: testPhone(9), phoneVerifiedAt: new Date() },
    where: { id: driverId },
  });
  const request = await world.request(driverId, options);
  for (const garageId of garageIds) await world.recipient(request.id, garageId);
  const payload = {
    driverId,
    garageIds: [...garageIds],
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`, ...garageIds.map((g) => `garage:${g}`)],
      kind: 'request.created',
      payload,
      subjectId: request.id,
    },
  });
  // The job as the relay queues it.
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: request.id,
    },
  };
  return { event, job, request };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REQUEST_RECEIVED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

// @traces 343-live-quote-requests-FR-012 343-live-quote-requests-FR-018
describe('telling a garage’s staff about a new request', () => {
  it('builds REQUEST_RECEIVED for the owner, the receptionist and the mechanic who may answer, not the other mechanic', async () => {
    const { answering, garage, owner, receptionist, silent } =
      await staffedGarage();
    const { job, request } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    for (const person of [owner, receptionist, answering]) {
      expect(await channels(person)).toEqual(['email', 'in_app']);
      for (const message of await messages(person)) {
        expect(message.subjectId).toBe(request.id);
      }
    }
    expect(await messages(silent)).toEqual([]);
  });

  it('never sends staff an SMS, even with a verified phone', async () => {
    const { garage, owner } = await staffedGarage();
    await prisma.account.update({
      data: { phone: testPhone(1), phoneVerifiedAt: new Date() },
      where: { id: owner },
    });
    const { job } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { channel: 'sms', kind: 'REQUEST_RECEIVED' },
      }),
    ).toBe(0);
  });

  it('sends a push to a person with a device and an e-mail to one without', async () => {
    const { garage, owner, receptionist } = await staffedGarage();
    await withDevice(owner);
    const { job } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(owner)).toEqual(['email', 'in_app', 'push']);
    expect(await channels(receptionist)).toEqual(['email', 'in_app']);
  });

  it('sends WhatsApp to a person who chose it while the garage allows it, and none once it is off', async () => {
    const first = await staffedGarage('unu');
    const second = await staffedGarage('doi');
    for (const { garage, owner } of [first, second]) {
      await prisma.account.update({
        data: {
          phone: testPhone(garage === first.garage ? 2 : 3),
          phoneVerifiedAt: new Date(),
        },
        where: { id: owner },
      });
      await prisma.notificationPreference.create({
        data: {
          accountId: owner,
          channel: 'whatsapp',
          enabled: true,
          garageId: garage.id,
          type: 'REQUEST_RECEIVED',
        },
      });
    }
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: second.garage.id, key: 'whatsapp' },
    });
    const { job } = await sent([first.garage.id, second.garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(first.owner)).toContain('whatsapp');
    expect(await channels(second.owner)).not.toContain('whatsapp');
  });

  // @traces 343-live-quote-requests-FR-014
  it('builds nothing outside for a person who muted it at that garage, and keeps the bell row', async () => {
    const { garage, owner, receptionist } = await staffedGarage();
    await withDevice(owner);
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        garageId: garage.id,
        type: 'REQUEST_RECEIVED',
      })),
    });
    const { job } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await channels(owner)).toEqual(['in_app']);
    expect(await channels(receptionist)).toEqual(['email', 'in_app']);
  });

  // @traces 343-live-quote-requests-FR-013
  it('sends at once at 23:30 Bucharest time, holding nothing for the morning', async () => {
    const { garage, owner } = await staffedGarage();
    await withDevice(owner);
    const { job } = await sent([garage.id]);
    const { fanOut, service } = await start();
    service.now = () => new Date('2026-10-09T20:30:00Z');

    await fanOut.handle(job);

    const outside = (await messages(owner)).filter(
      (m) => m.channel !== 'in_app',
    );
    expect(outside.map((m) => m.channel).sort()).toEqual(['email', 'push']);
    for (const message of outside) {
      expect(message.status).not.toBe('held');
      expect(message.sendAfter).toBeNull();
    }
  });

  it('tells a suspended garage nothing', async () => {
    const { garage, owner } = await staffedGarage();
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: garage.id },
    });
    const { job } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await messages(owner)).toEqual([]);
  });

  it('tells a garage nothing once its recipient row is no longer waiting', async () => {
    const declined = await staffedGarage('unu');
    const waiting = await staffedGarage('doi');
    const { job, request } = await sent([
      declined.garage.id,
      waiting.garage.id,
    ]);
    await prisma.requestRecipient.update({
      data: {
        answeredAt: new Date(),
        declinedAt: new Date(),
        declinedBy: declined.owner,
        declineReason: 'fully_booked',
        status: 'declined',
      },
      where: {
        requestId_garageId: {
          garageId: declined.garage.id,
          requestId: request.id,
        },
      },
    });
    const { fanOut } = await start();

    await fanOut.handle(job);

    expect(await messages(declined.owner)).toEqual([]);
    expect(await channels(waiting.owner)).toEqual(['email', 'in_app']);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { garage, owner } = await staffedGarage();
    const { job } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(owner)).toEqual(['email', 'in_app']);
  });

  it('builds the message from the event the relay queued, once when relayed twice', async () => {
    const handled = jest.spyOn(RequestReceivedFanOut.prototype, 'handle');
    const { garage, owner } = await staffedGarage();
    const { event } = await sent([garage.id]);
    await start(true);

    await until('the first run', () => handled.mock.calls.length >= 1);
    await handled.mock.results[0].value;
    await prisma.outboxEvent.update({
      data: { relayedAt: null },
      where: { id: event.id },
    });
    await until('the second run', () => handled.mock.calls.length >= 2);
    await handled.mock.results[1].value;

    expect(await channels(owner)).toEqual(['email', 'in_app']);
  });
});

// @traces 343-live-quote-requests-FR-012 343-live-quote-requests-FR-013
describe('what the message says', () => {
  it('carries the car and the first job in the person’s language, and a link to the requests view', async () => {
    const { garage, owner, receptionist } = await staffedGarage();
    const { job } = await sent([garage.id]);
    const { fanOut } = await start();

    await fanOut.handle(job);

    const [email] = (await messages(owner)).filter(
      (m) => m.channel === 'email',
    );
    expect(email.params).toEqual({
      car: 'Mini Cooper S',
      job: 'Schimb ulei',
      link: 'https://motorfix.test/app/garage/requests',
    });
    const [english] = (await messages(receptionist)).filter(
      (m) => m.channel === 'email',
    );
    expect(english.params).toMatchObject({ job: 'Oil change' });
  });

  it('carries no plate, phone or description', async () => {
    const { garage, owner } = await staffedGarage();
    const { job } = await sent([garage.id], {
      description: 'Scârțâie la frânare',
    });
    const { fanOut } = await start();

    await fanOut.handle(job);

    for (const message of await messages(owner)) {
      const text = JSON.stringify(message.params);
      expect(text).not.toContain('B123ABC');
      expect(text).not.toContain(testPhone(9));
      expect(text).not.toContain('Scârțâie');
    }
  });

  it('names the description’s first line, cut at 40 characters, when the request has no job', async () => {
    const { garage, owner } = await staffedGarage();
    const line = 'Se aude un zgomot metalic la roata din față stânga';
    const { job, request } = await sent([garage.id], {
      description: `${line}\nmai ales când frânez în curbă`,
    });
    await prisma.requestJob.deleteMany({ where: { requestId: request.id } });
    const { fanOut } = await start();

    await fanOut.handle(job);

    const [email] = (await messages(owner)).filter(
      (m) => m.channel === 'email',
    );
    expect(email.params).toMatchObject({ job: line.slice(0, 40) });
    expect(JSON.stringify(email.params)).not.toContain('frânez');
  });
});

// @traces 343-live-quote-requests-FR-017
describe('what the fan-out reports', () => {
  it('counts each garage as built, muted or skipped', async () => {
    const built = await staffedGarage('unu');
    const muted = await staffedGarage('doi');
    const skipped = await staffedGarage('trei');
    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: skipped.garage.id },
    });
    // Every person of the second garage turned the e-mail off there.
    for (const person of [muted.owner, muted.receptionist, muted.answering]) {
      await prisma.notificationPreference.create({
        data: {
          accountId: person,
          channel: 'email',
          enabled: false,
          garageId: muted.garage.id,
          type: 'REQUEST_RECEIVED',
        },
      });
    }
    const { job } = await sent([
      built.garage.id,
      muted.garage.id,
      skipped.garage.id,
    ]);
    const { fanOut } = await start();
    const before = {
      built: await counted('built'),
      muted: await counted('muted'),
      skipped: await counted('skipped'),
    };

    await fanOut.handle(job);

    expect(await counted('built')).toBe(before.built + 1);
    expect(await counted('muted')).toBe(before.muted + 1);
    expect(await counted('skipped')).toBe(before.skipped + 1);
  });

  it('logs one line with the request id and how many people it told, and nothing about the car or the driver', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const { garage } = await staffedGarage();
    const { job, request } = await sent([garage.id]);
    const { fanOut } = await start();
    log.mockClear();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(request.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\b3\b/);
    expect(lines[0]).not.toMatch(/Mini|Cooper|Scârțâie|driver/);
  });
});
