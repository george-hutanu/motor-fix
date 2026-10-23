// @traces 129-FR-011
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  CAR_ACCOUNT_DELETED_CONSUMER,
  CarAccountDeleted,
} from './account-deleted';
import { CarAccountDeletedModule } from './account-deleted.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { quotesWorld } from '../../quotes/quotes.testing';

const redisUrl = redisUrlFor(10);
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

let app: TestingModule | undefined;

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  await world.reset();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

// Compiled, never started: each case hands the handler its event itself.
async function start() {
  app = await Test.createTestingModule({
    imports: [
      CarAccountDeletedModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
      }),
    ],
  }).compile();
  return app.get(CarAccountDeleted);
}

const deleted = (accountId: string, id = '1') => ({
  data: {
    id,
    kind: 'account.deleted',
    payload: { accountId },
    subjectId: accountId,
  },
});

const platesOf = async (ownerId: string) =>
  (await prisma.car.findMany({ where: { ownerId } })).map((car) => car.plate);

describe('the plates of a deleted account', () => {
  it('takes account.deleted on its own queue', () => {
    expect(CAR_ACCOUNT_DELETED_CONSUMER).toMatchObject({
      kinds: ['account.deleted'],
      queue: 'car-account-deleted',
    });
  });

  it("clears the plate of every car of the account and no one else's", async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    const other = await world.account('Ioana Pop', ['driver']);
    const first = await world.car(driver, 'B123ABC');
    await world.car(driver, 'CJ01XYZ');
    await world.car(other, 'B999ZZZ');
    const handler = await start();

    await handler.onEvent(deleted(driver));

    expect(await platesOf(driver)).toEqual([null, null]);
    expect(await platesOf(other)).toEqual(['B999ZZZ']);
    expect(
      await prisma.car.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ model: 'Cooper S', ownerId: driver });
  });

  it('is harmless when the same event comes again', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();

    await handler.onEvent(deleted(driver));
    await handler.onEvent(deleted(driver));

    expect(await platesOf(driver)).toEqual([null]);
  });

  it('does nothing for an event that names no account', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();

    await handler.onEvent({
      data: { id: '2', kind: 'account.deleted', payload: {}, subjectId: 'x' },
    });

    expect(await platesOf(driver)).toEqual(['B123ABC']);
  });
});
