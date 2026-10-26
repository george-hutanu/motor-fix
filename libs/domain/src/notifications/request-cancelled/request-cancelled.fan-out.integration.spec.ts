import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  REQUEST_CANCELLED_CONSUMER,
  RequestCancelledFanOut,
} from './request-cancelled.fan-out';
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
import { bellText } from '../templates';

const redisUrl = redisUrlFor(9);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

// 23:00 in Bucharest, inside quiet hours.
const NIGHT = new Date('2026-10-09T20:00:00Z');

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
        push: null,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  app.get(NotificationsService).now = () => NIGHT;
  return app.get(RequestCancelledFanOut);
}

// A garage with an owner, a receptionist and a mechanic who has an account.
async function staffed(name: string) {
  const garage = await world.garage(name);
  const owner = await account(`${name} Owner`, ['garage']);
  const desk = await account(`${name} Desk`, ['receptionist']);
  const fixer = await account(`${name} Fixer`, ['mechanic']);
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
  return { desk, fixer, garage, owner };
}

// Andrei's request, closed when his account closed, and the event it left.
async function cancelled(reason = 'account_closed') {
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const dinamo = await staffed('Atelier Dinamo');
  const nord = await staffed('Service Nord');
  const request = await world.request(driverId, { status: 'closed' });
  const payload = {
    garageIds: [dinamo.garage.id, nord.garage.id],
    reason,
    requestId: request.id,
  };
  const event = await prisma.outboxEvent.create({
    data: {
      audience: [`account:${driverId}`],
      kind: 'request.cancelled',
      payload,
      subjectId: request.id,
    },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: request.id,
    },
  };
  return { dinamo, driverId, job, nord };
}

const bells = (accountId: string) =>
  prisma.notification.findMany({
    where: {
      accountId,
      channel: 'in_app',
      fallbackOf: null,
      kind: 'REQUEST_CANCELLED',
    },
  });

// @traces 428-FR-009 428-FR-011
describe('telling the garages a closed account’s request is cancelled', () => {
  it('listens to request.cancelled on its own queue', () => {
    expect(REQUEST_CANCELLED_CONSUMER.kinds).toEqual(['request.cancelled']);
    expect(REQUEST_CANCELLED_CONSUMER.queue).toBe('request-cancelled');
  });

  it('tells each owner and receptionist of every garage once, with the reason', async () => {
    const { dinamo, job, nord } = await cancelled();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const person of [dinamo.owner, dinamo.desk, nord.owner, nord.desk]) {
      const mine = await bells(person);
      expect(mine).toHaveLength(1);
      expect(mine[0].params).toMatchObject({ reason: 'account_closed' });
    }
  });

  it('tells no mechanic and not the driver', async () => {
    const { dinamo, driverId, job, nord } = await cancelled();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const person of [dinamo.fixer, nord.fixer, driverId]) {
      expect(await bells(person)).toEqual([]);
    }
  });

  it('holds nothing for the night', async () => {
    const { job } = await cancelled();
    const fanOut = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: { kind: 'REQUEST_CANCELLED', status: 'held' },
      }),
    ).toBe(0);
  });

  // @traces 428-FR-007 223-FR-013
  it('builds each message once when the same event is handled twice', async () => {
    const { job } = await cancelled();
    const fanOut = await start();
    const count = () =>
      prisma.notification.count({ where: { kind: 'REQUEST_CANCELLED' } });

    await fanOut.handle(job);
    const once = await count();
    await fanOut.handle(job);

    expect(once).toBeGreaterThan(0);
    expect(await count()).toBe(once);
  });
});

// @traces 1258-driver-cancel-FR-007
describe('telling the garages the driver cancelled the request', () => {
  it('tells each owner and receptionist of every garage once, with the reason driver, and no mechanic', async () => {
    const { dinamo, driverId, job, nord } = await cancelled('driver');
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    for (const person of [dinamo.owner, dinamo.desk, nord.owner, nord.desk]) {
      const mine = await bells(person);
      expect(mine).toHaveLength(1);
      expect(mine[0].params).toMatchObject({ reason: 'driver' });
    }
    for (const person of [dinamo.fixer, nord.fixer, driverId]) {
      expect(await bells(person)).toEqual([]);
    }
  });
});

// Each owner has a confirmed phone and chose WhatsApp for this garage.
async function onWhatsApp(
  ...garages: { garage: { id: string }; owner: string }[]
) {
  for (const [n, { garage, owner }] of garages.entries()) {
    await prisma.account.update({
      data: {
        phone: testPhone(n + 1),
        phoneVerifiedAt: new Date('2026-09-01T00:00:00Z'),
      },
      where: { id: owner },
    });
    await prisma.notificationPreference.create({
      data: {
        accountId: owner,
        channel: 'whatsapp',
        enabled: true,
        garageId: garage.id,
        type: 'REQUEST_CANCELLED',
      },
    });
  }
}

// @traces 223-FR-005 223-FR-010
describe('the cancelled request’s own wording', () => {
  it('reads that the request was closed when the account closed', async () => {
    const { dinamo, job } = await cancelled('account_closed');
    const fanOut = await start();

    await fanOut.handle(job);

    const [bell] = await bells(dinamo.owner);
    const params = bell.params as Record<string, unknown>;
    expect(bellText(bell.kind, 'ro', params)).toBe(
      'Cererea a fost închisă · Mini Cooper S',
    );
    expect(bellText(bell.kind, 'en', params)).toBe(
      'The request was closed · Mini Cooper S',
    );
  });

  it('names the driver who cancelled for any other reason', async () => {
    const { nord, job } = await cancelled('cancelled');
    const fanOut = await start();

    await fanOut.handle(job);

    const [bell] = await bells(nord.desk);
    const params = bell.params as Record<string, unknown>;
    expect(bellText(bell.kind, 'ro', params)).toBe(
      'Andrei M. a anulat cererea · Mini Cooper S',
    );
    expect(bellText(bell.kind, 'en', params)).toBe(
      'Andrei M. cancelled the request · Mini Cooper S',
    );
  });

  it('sends no WhatsApp for a garage whose WhatsApp is off, and no SMS', async () => {
    const { dinamo, job, nord } = await cancelled();
    await onWhatsApp(dinamo, nord);
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: dinamo.garage.id, key: 'whatsapp' },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    const channels = async (accountId: string) =>
      (
        await prisma.notification.findMany({
          where: { accountId, fallbackOf: null, kind: 'REQUEST_CANCELLED' },
        })
      )
        .map((r) => r.channel)
        .sort();
    expect(await channels(dinamo.owner)).toEqual(['email', 'in_app']);
    expect(await channels(nord.owner)).toEqual(['email', 'in_app', 'whatsapp']);
    expect(
      await prisma.notification.count({
        where: { channel: 'sms', kind: 'REQUEST_CANCELLED' },
      }),
    ).toBe(0);
  });
});
