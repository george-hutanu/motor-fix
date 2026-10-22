import { randomUUID } from 'node:crypto';

import { inMemory } from '@motor-fix/observability/testing';
import { HttpException } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { CopyVoicesService } from './copy-voices.service';
import { AuditService } from '../../../audit/audit.service';
import type { Actor } from '../../../auth/policy';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import {
  databaseUrl,
  fixtures,
} from '../../../notifications/notifications.testing';
import { quotesWorld } from '../../../quotes/quotes.testing';

const { account, prisma, reset } = fixtures();
const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));
serialDatabase(databaseUrl);
const world = quotesWorld(prisma);

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const DAY = 86_400_000;
const ON = { enabled: true, pinned: false };

const voices = () => new CopyVoicesService(prisma, new AuditService(), outbox);
let admin: Actor;
let driver: string;

const ago = (ms: number) => new Date(Date.now() - ms);

const draft = (copyVoice: number | null, createdAt: Date, status = 'open') =>
  prisma.listingDraft.create({
    data: {
      copyVoice,
      createdAt,
      data: {},
      email: `${randomUUID()}@example.test`,
      language: 'ro',
      status: status as 'open',
      step: 1,
      updatedAt: createdAt,
    },
  });

const request = async (copyVoice: number | null, createdAt: Date) => {
  const row = await world.request(driver, { createdAt });
  await prisma.$executeRaw`
    UPDATE quote_request SET copy_voice = ${copyVoice} WHERE id = ${row.id}::uuid`;
};

const totals = async () =>
  (await voices().list(admin)).voices.map((v) => [v.requests, v.listings]);

beforeEach(async () => {
  await reset();
  await prisma.copyVoiceSetting.updateMany({
    data: { enabled: true, pinned: false, updatedAt: null, updatedBy: null },
  });
  admin = {
    accountId: await account('Ioana Popa', ['admin']),
    garageId: null,
    permissions: NONE,
    role: 'admin',
    roles: ['admin'],
  };
  driver = await account('Andrei Marin');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// @traces 009-FR-008
describe('the 30-day totals per voice', () => {
  it('are zero for every voice on an empty database', async () => {
    expect(await totals()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('count a row a minute inside the window and not one a minute outside', async () => {
    await request(2, ago(30 * DAY - 60_000));
    await request(2, ago(30 * DAY + 60_000));
    await draft(4, ago(30 * DAY - 60_000));
    await draft(4, ago(30 * DAY + 60_000));

    expect(await totals()).toEqual([
      [0, 0],
      [1, 0],
      [0, 0],
      [0, 1],
      [0, 0],
    ]);
  });

  it('count a submitted draft and an open one alike, and a request in any status', async () => {
    await draft(1, ago(DAY), 'submitted');
    await draft(1, ago(DAY), 'open');
    await request(1, ago(DAY));
    const closed = await world.request(driver, {
      createdAt: ago(DAY),
      status: 'closed',
    });
    await prisma.$executeRaw`
      UPDATE quote_request SET copy_voice = 1 WHERE id = ${closed.id}::uuid`;

    expect((await totals())[0]).toEqual([2, 2]);
  });

  it('count a voiceless row nowhere', async () => {
    await request(null, ago(DAY));
    await draft(null, ago(DAY));

    expect(await totals()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('keep requests and listings apart', async () => {
    await request(3, ago(DAY));
    await request(3, ago(2 * DAY));
    await draft(3, ago(DAY));

    expect((await totals())[2]).toEqual([2, 1]);
  });

  it('count the rows of every driver together', async () => {
    const other = await account('Maria Ene');
    await request(5, ago(DAY));
    const row = await world.request(other, { createdAt: ago(DAY) });
    await prisma.$executeRaw`
      UPDATE quote_request SET copy_voice = 5 WHERE id = ${row.id}::uuid`;

    expect((await totals())[4]?.[0]).toBe(2);
  });

  it('count a voice that is switched off', async () => {
    await request(2, ago(DAY));
    await prisma.copyVoiceSetting.update({
      data: { enabled: false },
      where: { voice: 2 },
    });

    expect((await totals())[1]).toEqual([1, 0]);
  });

  it('come back with the answer of a change', async () => {
    await request(2, ago(DAY));
    await draft(2, ago(DAY));

    const list = await voices().change(admin, 3, {
      enabled: false,
      pinned: false,
      seen: ON,
    });

    expect(list.voices.map((v) => [v.requests, v.listings])).toEqual([
      [0, 0],
      [1, 1],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
  });

  it('are not read by anyone who is not an admin', async () => {
    const caught = await voices()
      .list({ ...admin, role: 'driver', roles: ['driver'] })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(caught).toBeInstanceOf(HttpException);
    expect([403, 404]).toContain((caught as HttpException).getStatus());
  });
});

// @traces 009-FR-007
describe('the voice stored on a draft', () => {
  it('cannot be stored outside 1 to 5 by a direct write', async () => {
    const write = draft(7, new Date());

    await expect(write).rejects.toThrow();
  });
});
