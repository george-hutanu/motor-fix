import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  CAR_TRANSFER_ACCEPTED_CONSUMER,
  CarTransferAcceptedFanOut,
} from './car-transfer-accepted.fan-out';
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
import { render } from '../templates';

// @traces 1265-FR-009

const redisUrl = redisUrlFor(7);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_car_transfer_accepted_notices_total', {
    outcome,
  });

const BUYER_PHONE = '+40722123456';
const BUYER_NAME = 'Maria Ionescu';

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  // Brevo's address answers nothing, so the notifications worker never
  // starts and every message stays as the fan-out built it.
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
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(CarTransferAcceptedFanOut);
}

// Andrei's Mini taken over by Maria, and the job the relay queues for the
// event the acceptance wrote.
async function accepted(language: 'ro' | 'en' = 'en') {
  const seller = await account('Andrei Marin', ['driver'], { language });
  const buyer = await account(BUYER_NAME, ['driver']);
  await prisma.account.update({
    data: { phone: BUYER_PHONE },
    where: { id: buyer },
  });
  const car = await world.car(buyer);
  const brand = await prisma.brand.findUniqueOrThrow({
    where: { id: car.brandId },
  });
  const transfer = await prisma.carTransfer.create({
    data: {
      buyerId: buyer,
      buyerPhone: BUYER_PHONE,
      carId: car.id,
      expiresAt: new Date(Date.now() + 86_400_000),
      saleDate: new Date(),
      sellerId: seller,
      status: 'accepted',
      tokenHash: `hash-${car.id}`,
    },
  });
  const payload = {
    buyerAccountId: buyer,
    carId: car.id,
    sellerAccountId: seller,
    status: 'accepted',
    transferId: transfer.id,
  };
  const job = (id = '71') => ({
    data: {
      id,
      kind: 'car_transfer.accepted',
      payload,
      subjectId: transfer.id,
    },
  });
  return { buyer, carName: `${brand.name} Cooper S`, job, seller, transfer };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'CAR_TRANSFER_ACCEPTED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

describe('telling the seller the buyer took the car over', () => {
  it('listens to car_transfer.accepted alone, on its own queue', () => {
    expect(CAR_TRANSFER_ACCEPTED_CONSUMER.kinds).toEqual([
      'car_transfer.accepted',
    ]);
    expect(CAR_TRANSFER_ACCEPTED_CONSUMER.queue).toBe('car-transfer-accepted');
  });

  it('builds CAR_TRANSFER_ACCEPTED for the seller only, naming the car in the seller’s language', async () => {
    const { buyer, carName, job, seller, transfer } = await accepted('en');
    const fanOut = await start();
    const before = await counted('built');

    await fanOut.handle(job());

    expect(await channels(seller)).toEqual(['email', 'in_app']);
    const all = await messages(seller);
    for (const message of all) expect(message.subjectId).toBe(transfer.id);
    expect(all.find((m) => m.channel === 'email')?.params).toEqual({
      car: carName,
      link: 'https://motorfix.test/app/driver?view=cars',
    });
    const bell = all.find((m) => m.channel === 'in_app');
    expect(bell?.params).toEqual({ car: carName });
    expect(
      render(
        'CAR_TRANSFER_ACCEPTED',
        'bell',
        'en',
        bell?.params as Record<string, unknown>,
      ),
    ).toBe(
      `The buyer has taken over your ${carName}. Its history stays with you, read-only, up to the sale date.`,
    );
    expect(await messages(buyer)).toEqual([]);
    const text = JSON.stringify(all, (_, value) =>
      typeof value === 'bigint' ? String(value) : value,
    );
    expect(text).not.toContain(BUYER_PHONE);
    expect(text).not.toContain(BUYER_NAME);
    expect(await counted('built')).toBe(before + 1);
  });

  it('writes nothing more for the same event run twice', async () => {
    const { job, seller } = await accepted();
    const fanOut = await start();

    await fanOut.handle(job());
    await fanOut.handle(job());

    expect(await channels(seller)).toEqual(['email', 'in_app']);
  });

  it('keeps only the bell for a seller who muted reviews and history, and counts muted', async () => {
    const { job, seller } = await accepted('ro');
    await prisma.notificationPreference.createMany({
      data: (['email', 'push', 'whatsapp'] as const).map((channel) => ({
        accountId: seller,
        channel,
        enabled: false,
        type: 'CAR_TRANSFER_ACCEPTED',
      })),
    });
    const fanOut = await start();
    const before = await counted('muted');

    await fanOut.handle(job());

    expect(await channels(seller)).toEqual(['in_app']);
    expect(await counted('muted')).toBe(before + 1);
  });

  it('writes nothing for a deleted seller, and counts skipped', async () => {
    const { job, seller } = await accepted();
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: seller },
    });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(seller)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('writes nothing for a car gone before the job ran, and counts skipped', async () => {
    const { job, seller, transfer } = await accepted();
    await prisma.car.delete({ where: { id: transfer.carId } });
    const fanOut = await start();
    const before = await counted('skipped');

    await fanOut.handle(job());

    expect(await messages(seller)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });
});
