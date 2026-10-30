import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  REPAIR_UPDATED_CONSUMER,
  RepairUpdatedFanOut,
} from './repair-updated.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from '../notifications.testing';
import { bellText } from '../templates';

// @traces 409-FR-013
// @traces 409-FR-017
// @traces 1267-FR-012

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_repair_updated_notices_total', { outcome });

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
  return app.get(RepairUpdatedFanOut);
}

// Andrei's Mini with a repair Garaj Nordic corrected, and the job the relay
// queues for the event the correction wrote.
async function corrected(language: 'ro' | 'en' = 'en') {
  const owner = await account('Andrei Marin', ['driver'], { language });
  const car = await world.car(owner);
  const garage = await world.garage('Garaj Nordic');
  const brand = await prisma.brand.findUniqueOrThrow({
    where: { id: car.brandId },
  });
  const repair = await prisma.repair.create({
    data: {
      carId: car.id,
      doneOn: new Date('2026-10-01T00:00:00Z'),
      garageId: garage.id,
      garageName: 'Garaj Nordic',
      sharedWithGarage: true,
      source: 'logged',
      what: 'Schimb ulei',
    },
  });
  const payload = (over: Record<string, unknown> = {}) => ({
    by: 'owner',
    carId: car.id,
    changed: ['odometerKm'],
    garageId: garage.id,
    ownerId: owner,
    repairId: repair.id,
    ...over,
  });
  const job = (id = '81', over: Record<string, unknown> = {}) => ({
    data: {
      id,
      kind: 'repair.updated',
      payload: payload(over),
      subjectId: repair.id,
    },
  });
  return {
    carName: `${brand.name} Cooper S 2019`,
    job,
    owner,
    repair,
  };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'REPAIR_UPDATED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

describe('telling the driver a garage corrected a repair', () => {
  it('listens to repair.updated alone, on its own queue', () => {
    expect(REPAIR_UPDATED_CONSUMER.kinds).toEqual(['repair.updated']);
    expect(REPAIR_UPDATED_CONSUMER.queue).toBe('repair-updated');
  });

  it('builds REPAIR_UPDATED for the owner the event names, naming the garage and the car', async () => {
    const { carName, job, owner, repair } = await corrected('en');
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job());

    expect(await channels(owner)).toEqual(['email', 'in_app']);
    const all = await messages(owner);
    for (const message of all) expect(message.subjectId).toBe(repair.id);
    expect(all.find((m) => m.channel === 'email')?.params).toEqual({
      by: 'owner',
      car: carName,
      garage: 'Garaj Nordic',
      link: 'https://motorfix.test/app/driver?view=cars',
    });
    const bell = all.find((m) => m.channel === 'in_app');
    expect(
      bellText('REPAIR_UPDATED', 'en', bell?.params as Record<string, unknown>),
    ).toBe(`Garaj Nordic corrected a repair in ${carName}'s history.`);
    expect(await counted('built')).toBe(before + 1);
  });

  it('names MotorFix, not the garage, for an admin’s correction', async () => {
    const { carName, job, owner } = await corrected('ro');
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job('83', { by: 'admin' }));

    expect(await channels(owner)).toEqual(['email', 'in_app']);
    const all = await messages(owner);
    expect(all.find((m) => m.channel === 'email')?.params).toMatchObject({
      by: 'admin',
      garage: 'MotorFix',
    });
    const bell = all.find((m) => m.channel === 'in_app');
    expect(
      bellText('REPAIR_UPDATED', 'ro', bell?.params as Record<string, unknown>),
    ).toBe(`MotorFix a corectat o reparație din istoricul ${carName}.`);
    expect(await counted('built')).toBe(before + 1);
  });

  it('keeps only the bell of an admin’s correction for an owner who muted reviews and history', async () => {
    const { job, owner } = await corrected();
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        type: 'REPAIR_UPDATED',
      })),
    });
    const fanOut = await start();

    await fanOut.handle(job('84', { by: 'admin' }));
    await fanOut.handle(job('84', { by: 'admin' }));

    expect(await channels(owner)).toEqual(['in_app']);
  });

  it('writes an admin’s correction to the new owner after a sale, never the seller', async () => {
    const { job, owner } = await corrected();
    const buyer = await account('Maria Ionescu', ['driver']);
    const fanOut = await start();

    await fanOut.handle(job('85', { by: 'admin', ownerId: buyer }));

    expect(await channels(buyer)).toEqual(['email', 'in_app']);
    expect(
      (await messages(buyer)).find((m) => m.channel === 'email')?.params,
    ).toMatchObject({ by: 'admin', garage: 'MotorFix' });
    expect(await messages(owner)).toEqual([]);
  });

  it('writes nothing for an admin’s correction on a car with no owner, and counts skipped', async () => {
    const { job, owner } = await corrected();
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job('86', { by: 'admin', ownerId: null }));

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('sends an admin’s correction by WhatsApp when the owner chose it, never by SMS', async () => {
    const { job, owner } = await corrected();
    await prisma.account.update({
      data: { phone: testPhone(7), phoneVerifiedAt: new Date('2026-09-01') },
      where: { id: owner },
    });
    await prisma.notificationPreference.create({
      data: {
        accountId: owner,
        channel: 'whatsapp',
        enabled: true,
        type: 'REPAIR_UPDATED',
      },
    });
    const fanOut = await start();

    await fanOut.handle(job('87', { by: 'admin' }));

    const sent = await channels(owner);
    expect(sent).toContain('whatsapp');
    expect(sent).not.toContain('sms');
    expect(
      (await messages(owner)).find((m) => m.channel === 'whatsapp')?.params,
    ).toMatchObject({ by: 'admin', garage: 'MotorFix' });
  });

  it('writes nothing more for the same event run twice', async () => {
    const { job, owner } = await corrected();
    const fanOut = await start();

    await fanOut.handle(job());
    await fanOut.handle(job());

    expect(await channels(owner)).toEqual(['email', 'in_app']);
  });

  it('keeps only the bell for an owner who muted reviews and history, and counts muted', async () => {
    const { job, owner } = await corrected('ro');
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: owner,
        channel,
        enabled: false,
        type: 'REPAIR_UPDATED',
      })),
    });
    const fanOut = await start();
    const before = await counted('muted');

    await fanOut.handle(job());

    expect(await channels(owner)).toEqual(['in_app']);
    expect(await counted('muted')).toBe(before + 1);
  });

  it('writes to the new owner after a sale, as the event names them, never the seller', async () => {
    const { job, owner } = await corrected();
    const buyer = await account('Maria Ionescu', ['driver']);
    const fanOut = await start();

    await fanOut.handle(job('82', { ownerId: buyer }));

    expect(await channels(buyer)).toEqual(['email', 'in_app']);
    expect(await messages(owner)).toEqual([]);
  });

  it('writes nothing for a car with no owner, and counts skipped', async () => {
    const { job, owner } = await corrected();
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job('83', { ownerId: null }));

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('writes nothing for a deleted owner, and counts skipped', async () => {
    const { job, owner } = await corrected();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: owner },
    });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('writes nothing for the driver’s own edit, and counts skipped', async () => {
    const { job, owner } = await corrected();
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job('84', { by: 'driver' }));

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('writes nothing for a repair gone before the job ran, and counts skipped', async () => {
    const { job, owner, repair } = await corrected();
    await prisma.repair.delete({ where: { id: repair.id } });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(owner)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });
});
