import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { RequestCancelledFanOut } from './request-cancelled.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(9);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
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
        push: null,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(RequestCancelledFanOut);
}

async function owned(name: string) {
  const garage = await world.garage(name);
  const owner = await account(`${name} Owner`, ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  return { garage, owner };
}

async function jobFor(garageIds: string[], driverId: string) {
  const request = await world.request(driverId, { status: 'closed' });
  const payload = {
    garageIds,
    reason: 'account_closed',
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
  return {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload,
      subjectId: request.id,
    },
  };
}

const told = () =>
  prisma.notification.count({ where: { kind: 'REQUEST_CANCELLED' } });

// @traces 428-FR-009
describe('who hears about a cancelled request', () => {
  it('tells nobody of a garage that declined and is not in the garage ids', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const dinamo = await owned('Atelier Dinamo');
    const sud = await owned('Garaj Sud');
    const job = await jobFor([dinamo.garage.id], driverId);
    await world.recipient(
      job.data.subjectId,
      sud.garage.id,
      'declined',
      driverId,
    );
    const fanOut = await start();

    await fanOut.handle(job);

    const bells = (accountId: string) =>
      prisma.notification.count({
        where: { accountId, kind: 'REQUEST_CANCELLED' },
      });
    expect(await bells(dinamo.owner)).toBeGreaterThan(0);
    expect(await bells(sud.owner)).toBe(0);
  });

  it('sends nothing when the garage ids are empty', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    await owned('Atelier Dinamo');
    const job = await jobFor([], driverId);
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await told()).toBe(0);
  });

  it('sends nothing for a garage id that does not exist', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const job = await jobFor([randomUUID()], driverId);
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await told()).toBe(0);
  });

  it('tells a garage listed twice once', async () => {
    const driverId = await account('Andrei Ion Marin', ['driver']);
    const dinamo = await owned('Atelier Dinamo');
    const job = await jobFor([dinamo.garage.id, dinamo.garage.id], driverId);
    const fanOut = await start();

    await fanOut.handle(job);

    expect(
      await prisma.notification.count({
        where: {
          accountId: dinamo.owner,
          channel: 'in_app',
          fallbackOf: null,
          kind: 'REQUEST_CANCELLED',
        },
      }),
    ).toBe(1);
  });
});
