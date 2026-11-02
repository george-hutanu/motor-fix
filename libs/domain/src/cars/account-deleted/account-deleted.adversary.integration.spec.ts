import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { CarAccountDeleted } from './account-deleted';
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
let lines: string[];

beforeEach(async () => {
  lines = [];
  vi.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
    lines.push(String(message));
  });
  await world.reset();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

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

const event = (kind: string, payload: Record<string, unknown>) => ({
  data: { id: '1', kind, payload, subjectId: 'x' },
});

const platesOf = async (ownerId: string) =>
  (await prisma.car.findMany({ where: { ownerId } })).map((car) => car.plate);

// @traces 129-FR-011
describe('the plates of a deleted account, attacked', () => {
  it('does nothing for an account that owns no car', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    const handler = await start();

    await handler.onEvent(event('account.deleted', { accountId: driver }));

    expect(await prisma.car.count()).toBe(0);
  });

  it('does nothing for an account id nobody holds', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();

    await handler.onEvent(
      event('account.deleted', {
        accountId: '00000000-0000-4000-8000-000000000000',
      }),
    );

    expect(await platesOf(driver)).toEqual(['B123ABC']);
  });

  it.each([
    ['another kind of event', 'account.updated'],
    ['a booking event', 'booking.cancelled'],
  ])('ignores %s that names the account', async (_, kind) => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();

    await handler.onEvent(event(kind, { accountId: driver }));

    expect(await platesOf(driver)).toEqual(['B123ABC']);
  });

  it.each([
    ['an empty id', ''],
    ['a null id', null],
    ['a number', 7],
    ['an object', { id: 'x' }],
  ])('leaves every plate alone for %s', async (_, accountId) => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();

    await handler.onEvent(event('account.deleted', { accountId } as never));

    expect(await platesOf(driver)).toEqual(['B123ABC']);
  });

  it('answers a replay of an event from a long time ago the same way, once the account holds a new car', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();
    await handler.onEvent(event('account.deleted', { accountId: driver }));
    await world.car(driver, 'CJ01NEW');

    await handler.onEvent(event('account.deleted', { accountId: driver }));

    expect(await platesOf(driver)).toEqual([null, null]);
  });

  it('runs twice at once and leaves the same result', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    await world.car(driver, 'CJ01XYZ');
    const handler = await start();

    await Promise.all([
      handler.onEvent(event('account.deleted', { accountId: driver })),
      handler.onEvent(event('account.deleted', { accountId: driver })),
    ]);

    expect(await platesOf(driver)).toEqual([null, null]);
  });

  it('keeps the plate out of its log lines', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    await world.car(driver, 'B123ABC');
    const handler = await start();

    await handler.onEvent(event('account.deleted', { accountId: driver }));

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain('B123ABC');
      expect(line).not.toContain('Andrei');
    }
  });

  it('clears the plates of two thousand and one cars of one account', async () => {
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    const one = await world.car(driver, 'B000AAA');
    await prisma.car.createMany({
      data: Array.from({ length: 2000 }, (_, i) => ({
        brandId: one.brandId,
        engine: '2.0',
        fuel: 'petrol' as const,
        idempotencyKey: `bulk-${i}`,
        model: 'Cooper S',
        odometerKm: 1,
        ownerId: driver,
        plate: `B${String(i).padStart(3, '0')}ZZZ`,
        year: 2019,
      })),
    });
    const handler = await start();

    await handler.onEvent(event('account.deleted', { accountId: driver }));

    expect(
      await prisma.car.count({
        where: { ownerId: driver, plate: { not: null } },
      }),
    ).toBe(0);
    expect(await prisma.car.count({ where: { ownerId: driver } })).toBe(2001);
  });
});
