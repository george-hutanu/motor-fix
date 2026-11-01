// @traces 140-FR-003 140-FR-004 140-FR-005 140-FR-006 140-FR-008 140-FR-016 140-FR-017
import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  DATA_EXPORT_CONSUMER,
  DataExportBuilder,
  type DataExportEvent,
} from './data-export.builder';
import { DataExportModule } from './data-export.module';
import {
  type Driver,
  dataExportWorld,
  foreignValuesIn,
  readZip,
} from './data-export.testing';
import type { DataExportStatus } from '../../generated/prisma/enums';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../../notifications/notifications.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(10);
const webUrl = 'https://motorfix.test';
const DAY = 24 * 60 * 60_000;
const FILES = [
  'README.txt',
  'account.json',
  'audit.json',
  'bookings-and-jobs.json',
  'cars.json',
  'consents.json',
  'messages.json',
  'notifications-and-preferences.json',
  'requests-and-quotes.json',
  'reviews.json',
];
const prisma = createPrisma(databaseUrl);
const { reset, twoDrivers, world } = dataExportWorld(prisma);
const store = new S3TestStore();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const exportsCounted = (outcome: string) =>
  counterTotal(reader, 'motorfix_data_exports_total', { outcome });

let app: TestingModule | undefined;
let log: jest.SpyInstance;

beforeAll(() => store.start());

afterAll(async () => {
  await store.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
  store.objects.clear();
  store.beforeDelete = undefined;
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

// Compiled, never started: no worker takes the queue, so each case hands the
// builder its job itself.
async function start() {
  app = await Test.createTestingModule({
    imports: [
      StorageModule.register(store.env()),
      DataExportModule.registerWorker({
        notifications: NotificationsModule.registerWorker({
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
          redisUrl,
        }),
        redisUrl,
        webUrl,
      }),
    ],
  }).compile();
  return app.get(DataExportBuilder);
}

const queued = (accountId: string) =>
  prisma.dataExport.create({ data: { accountId } });

// The job as the outbox relay queues it.
const requested = (
  accountId: string,
  exportId: string,
  attemptsMade = 0,
): { data: DataExportEvent; attemptsMade: number; name: string } => ({
  attemptsMade,
  data: {
    id: String(Math.floor(Math.random() * 1e9)),
    kind: 'data_export.requested',
    payload: { accountId, exportId },
    subjectId: exportId,
  },
  name: 'event',
});

const deleted = (accountId: string) => ({
  attemptsMade: 0,
  data: {
    id: String(Math.floor(Math.random() * 1e9)),
    kind: 'account.deleted',
    payload: { accountId },
    subjectId: accountId,
  },
  name: 'event',
});

async function built(builder: DataExportBuilder, accountId: string) {
  const row = await queued(accountId);
  await builder.onEvent(requested(accountId, row.id));
  const after = await prisma.dataExport.findUniqueOrThrow({
    where: { id: row.id },
  });
  const object = after.zipKey ? store.objects.get(after.zipKey) : undefined;
  if (!object) throw new Error('no file stored');
  return { files: readZip(object.body), object, row: after };
}

const json = (files: Map<string, Buffer>, name: string) =>
  JSON.parse(files.get(name)?.toString('utf8') ?? 'null');

// A stored export, as the build leaves it.
async function readyExport(accountId: string, expiresIn: number) {
  const row = await queued(accountId);
  const zipKey = `data-exports/${accountId}/${row.id}.zip`;
  store.put(zipKey, Buffer.from('PK'), 'application/zip');
  const readyAt = new Date(Date.now() + expiresIn - 7 * DAY);
  return prisma.dataExport.update({
    data: {
      expiresAt: new Date(readyAt.getTime() + 7 * DAY),
      readyAt,
      status: 'ready',
      zipKey,
    },
    where: { id: row.id },
  });
}

const statusOf = async (id: string): Promise<DataExportStatus> =>
  (await prisma.dataExport.findUniqueOrThrow({ where: { id } })).status;

describe('the consumer the relay feeds', () => {
  it('takes the requests and the deletions, three tries with back-off', () => {
    expect(DATA_EXPORT_CONSUMER).toEqual({
      jobs: expect.objectContaining({
        attempts: 3,
        backoff: { delay: 60_000, type: 'exponential' },
      }),
      kinds: ['data_export.requested', 'account.deleted'],
      queue: 'data-export',
    });
  });
});

describe('building the file', () => {
  it('holds exactly the ten files, and no media', async () => {
    const builder = await start();
    const { a } = await twoDrivers();

    const { files, object } = await built(builder, a.id);

    expect([...files.keys()].sort()).toEqual(FILES);
    expect([...files.keys()].some((name) => name.includes('/'))).toBe(false);
    expect(object.contentType).toBe('application/zip');
  });

  it('writes an area with no rows as an empty list', async () => {
    const builder = await start();
    const driverId = await world.account('Elena Vasile');

    const { files } = await built(builder, driverId);

    for (const name of FILES.filter(
      (file) => file.endsWith('.json') && file !== 'account.json',
    )) {
      const area = json(files, name);
      const lists = Array.isArray(area) ? [area] : Object.values(area);
      for (const list of lists) {
        expect({ [name]: list }).toEqual({ [name]: expect.any(Array) });
      }
    }
    expect(json(files, 'cars.json')).toEqual([]);
    expect(json(files, 'reviews.json')).toEqual([]);
  });

  // @traces 406-FR-009 406-FR-011
  it('says when a job’s final price was corrected, never who recorded it', async () => {
    const builder = await start();
    const { a, b } = await twoDrivers();
    const correctedAt = new Date('2026-10-20T08:30:00.000Z');
    await prisma.job.updateMany({
      data: {
        finalPriceBani: 115_000,
        finalPriceCorrectedAt: correctedAt,
        finalPriceRecordedById: b.id,
        handedOverAt: new Date('2026-10-19T08:30:00.000Z'),
      },
      where: { driverId: a.id },
    });

    const forA = json(
      (await built(builder, a.id)).files,
      'bookings-and-jobs.json',
    );
    const forB = json(
      (await built(builder, b.id)).files,
      'bookings-and-jobs.json',
    );

    expect(forA.jobs).toEqual([
      expect.objectContaining({
        finalPriceBani: 115_000,
        finalPriceCorrectedAt: correctedAt.toISOString(),
      }),
    ]);
    expect(forB.jobs).toEqual([
      expect.objectContaining({ finalPriceCorrectedAt: null }),
    ]);
    const text = JSON.stringify(forA);
    expect(text).not.toContain('finalPriceRecordedBy');
    expect(text).not.toContain('final_price_recorded_by');
    expect(text).not.toContain(b.id);
  });

  it('holds none of the other driver’s ids, names, e-mails, phones or plates, in any file', async () => {
    const builder = await start();
    const { a, b } = await twoDrivers();

    const forA = await built(builder, a.id);
    const forB = await built(builder, b.id);

    for (const [mine, theirs, other] of [
      [forA, a, b],
      [forB, b, a],
    ] as [Awaited<ReturnType<typeof built>>, Driver, Driver][]) {
      for (const [name, body] of mine.files) {
        expect({
          [name]: foreignValuesIn(body.toString('utf8'), other),
        }).toEqual({ [name]: [] });
      }
      const all = [...mine.files.values()].map((b) => b.toString()).join('\n');
      expect(all).toContain(theirs.plate);
      expect(all).toContain(theirs.email);
    }
  });

  it('gives the account, its roles and how it signs in, never a secret', async () => {
    const builder = await start();
    const { a } = await twoDrivers();

    const { files } = await built(builder, a.id);

    const account = json(files, 'account.json');
    expect(account).toEqual(
      expect.objectContaining({
        email: a.email,
        hasPassword: false,
        id: a.id,
        language: 'ro',
        name: a.name,
        phone: a.phone,
        roles: ['driver'],
        signInMethods: ['google'],
      }),
    );
    expect(files.get('account.json')?.toString()).not.toMatch(
      /subject|passwordHash|token/i,
    );
  });

  it('shows the garage by name and city and the mechanic by first name only', async () => {
    const builder = await start();
    const { a, garage, mechanic } = await twoDrivers();

    const { files } = await built(builder, a.id);

    const text = [...files.values()].map((b) => b.toString()).join('\n');
    expect(text).toContain('Atelier Dinamo');
    expect(text).toContain('Cluj-Napoca');
    expect(text).toContain('Mihai');
    expect(text).not.toContain('Dobre');
    expect(text).not.toContain(garage.id);
    expect(text).not.toContain(mechanic.id);
  });

  // @traces 091-FR-014
  it("lists each car's odometer readings, oldest first, with their day and source", async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const car = await prisma.car.findFirstOrThrow({ where: { ownerId: a.id } });
    const reading = (km: number, readOn: string) => ({
      carId: car.id,
      km,
      readOn: new Date(`${readOn}T00:00:00Z`),
      source: 'driver' as const,
    });
    await prisma.odometerReading.createMany({
      data: [reading(149_000, '2026-10-08'), reading(131_900, '2025-10-08')],
    });

    const { files } = await built(builder, a.id);

    const [exported] = json(files, 'cars.json') as {
      readings: Record<string, unknown>[];
    }[];
    expect(exported.readings).toEqual([
      { km: 131_900, readOn: '2025-10-08T00:00:00.000Z', source: 'driver' },
      { km: 149_000, readOn: '2026-10-08T00:00:00.000Z', source: 'driver' },
    ]);
  });

  // @traces 1374-FR-006
  // @traces 1374-FR-007
  it('lists the last fallback kept per notification type', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    await prisma.notificationFallback.create({
      data: {
        accountId: a.id,
        at: new Date('2026-10-20T08:00:00Z'),
        from: 'push',
        reason: 'no_device',
        to: 'email',
        type: 'DUE_ITP',
      },
    });

    const { files } = await built(builder, a.id);

    const notes = json(files, 'notifications-and-preferences.json') as {
      fallbacks: unknown[];
    };
    expect(notes.fallbacks).toEqual([
      {
        at: '2026-10-20T08:00:00.000Z',
        from: 'push',
        reason: 'no_device',
        to: 'email',
        type: 'DUE_ITP',
      },
    ]);
  });

  it('lists push subscriptions without their keys', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const push = await prisma.pushSubscription.findFirstOrThrow({
      where: { accountId: a.id },
    });

    const { files } = await built(builder, a.id);

    const text = files.get('notifications-and-preferences.json')?.toString();
    expect(text).toContain('Telefon');
    expect(text).not.toContain(push.endpoint);
    expect(text).not.toContain(push.p256dh);
    expect(text).not.toContain(push.auth);
  });

  it('gives the history as the driver sees it, with no garage id', async () => {
    const builder = await start();
    const { a } = await twoDrivers();

    const { files } = await built(builder, a.id);

    const audit = json(files, 'audit.json') as Record<string, unknown>[];
    expect(audit.length).toBeGreaterThan(0);
    for (const entry of audit) {
      expect(entry).not.toHaveProperty('garageId');
    }
  });

  it('writes the summary in the account’s language, naming each file and the request date', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: a.id },
    });

    const { files, row } = await built(builder, a.id);

    const readme = files.get('README.txt')?.toString() ?? '';
    expect(readme).toContain('MotorFix');
    expect(readme).toContain(row.requestedAt.toISOString().slice(0, 10));
    expect(readme).toMatch(/your data/i);
    for (const name of FILES.filter((file) => file !== 'README.txt')) {
      expect(readme).toContain(name);
    }
  });

  it('is ready on the first try, for seven days, with its event and one e-mail', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const before = await exportsCounted('ready');

    const { row } = await built(builder, a.id);

    expect(row).toEqual(
      expect.objectContaining({
        attempts: 1,
        status: 'ready',
        zipKey: `data-exports/${a.id}/${row.id}.zip`,
      }),
    );
    expect(row.expiresAt?.getTime()).toBe(
      (row.readyAt?.getTime() ?? 0) + 7 * DAY,
    );
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'data_export.ready', subjectId: row.id },
    });
    expect(events.map((e) => e.payload)).toEqual([
      { accountId: a.id, exportId: row.id },
    ]);
    const mails = await prisma.notification.findMany({
      where: { accountId: a.id, channel: 'email', kind: 'DATA_EXPORT_READY' },
    });
    expect(mails).toEqual([
      expect.objectContaining({
        channel: 'email',
        eventId: row.id,
        params: expect.objectContaining({
          link: `${webUrl}/app/driver/settings`,
        }),
      }),
    ]);
    expect(await exportsCounted('ready')).toBe(before + 1);
  });

  it('sends no second e-mail when the same job comes again', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const row = await queued(a.id);

    await builder.onEvent(requested(a.id, row.id));
    await builder.onEvent(requested(a.id, row.id));

    expect(
      await prisma.notification.count({
        where: { accountId: a.id, channel: 'email', kind: 'DATA_EXPORT_READY' },
      }),
    ).toBe(1);
  });

  it('skips the e-mail of an account with no address, and says so', async () => {
    const builder = await start();
    const driverId = await world.account('Elena Vasile');

    const { row } = await built(builder, driverId);

    expect(row.status).toBe('ready');
    expect(
      await prisma.notification.count({
        where: { accountId: driverId, kind: 'DATA_EXPORT_READY' },
      }),
    ).toBe(0);
    expect(log).toHaveBeenCalledWith(
      `data export ${row.id}: no e-mail address, ready e-mail skipped`,
    );
  });

  it('still builds the file of a suspended account', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: a.id },
    });

    const { row } = await built(builder, a.id);

    expect(row.status).toBe('ready');
  });

  it('expires the export of a deleted account without a file', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const row = await queued(a.id);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: a.id },
    });

    await builder.onEvent(requested(a.id, row.id));

    expect(await statusOf(row.id)).toBe('expired');
    expect(store.objects.size).toBe(0);
  });

  it('leaves the export queued after a failed try, to be tried again', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const row = await queued(a.id);
    jest
      .spyOn(StorageService.prototype, 'putObject')
      .mockRejectedValue(new Error('store down'));

    await expect(builder.onEvent(requested(a.id, row.id, 0))).rejects.toThrow(
      'store down',
    );

    const after = await prisma.dataExport.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after).toEqual(
      expect.objectContaining({ attempts: 1, status: 'queued' }),
    );
  });

  it('fails the export after the third failed try, logging no personal value', async () => {
    const builder = await start();
    const { a } = await twoDrivers();
    const row = await queued(a.id);
    const error = jest.spyOn(Logger.prototype, 'error');
    jest
      .spyOn(StorageService.prototype, 'putObject')
      .mockRejectedValue(new TypeError(`no store for ${a.email}`));
    const before = await exportsCounted('failed');

    await expect(builder.onEvent(requested(a.id, row.id, 2))).rejects.toThrow();

    const after = await prisma.dataExport.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after).toEqual(
      expect.objectContaining({ attempts: 3, status: 'failed' }),
    );
    expect(error).toHaveBeenCalledWith(
      `data export ${row.id}: failed after 3 attempts: TypeError`,
    );
    const said = JSON.stringify([...error.mock.calls, ...log.mock.calls]);
    expect(said).not.toContain(a.email);
    expect(await exportsCounted('failed')).toBe(before + 1);
  });
});

describe('expiring the files', () => {
  it('deletes every file past its seven days and expires its export, once', async () => {
    const builder = await start();
    const driverId = await world.account('Andrei Ion Marin');
    const old = await readyExport(driverId, -60_000);
    const before = await exportsCounted('expired');

    await builder.sweep();
    await builder.sweep();

    expect(await statusOf(old.id)).toBe('expired');
    expect(store.objects.has(old.zipKey ?? '')).toBe(false);
    expect(await exportsCounted('expired')).toBe(before + 1);
  });

  it('leaves a file still within its seven days', async () => {
    const builder = await start();
    const driverId = await world.account('Andrei Ion Marin');
    const fresh = await readyExport(driverId, DAY);

    await builder.sweep();

    expect(await statusOf(fresh.id)).toBe('ready');
    expect(store.objects.has(fresh.zipKey ?? '')).toBe(true);
  });

  it('expires a file the store no longer holds', async () => {
    const builder = await start();
    const driverId = await world.account('Andrei Ion Marin');
    const old = await readyExport(driverId, -60_000);
    store.objects.clear();

    await builder.sweep();

    expect(await statusOf(old.id)).toBe('expired');
  });

  it('fails the sweep naming the export whose file could not be deleted, after the others', async () => {
    const builder = await start();
    const a = await world.account('Andrei Ion Marin');
    const b = await world.account('Bianca Elena Pop');
    const stuck = await readyExport(a, -60_000);
    const other = await readyExport(b, -60_000);
    store.beforeDelete = (key) => {
      if (key === stuck.zipKey) throw new Error('store down');
    };

    await expect(builder.sweep()).rejects.toThrow(stuck.id);

    expect(await statusOf(stuck.id)).toBe('ready');
    expect(await statusOf(other.id)).toBe('expired');
  });

  it('expires a deleted account’s queued and ready exports at once, deleting the file', async () => {
    const builder = await start();
    const a = await world.account('Andrei Ion Marin');
    const b = await world.account('Bianca Elena Pop');
    const ready = await readyExport(a, 5 * DAY);
    await prisma.dataExport.update({
      data: { requestedAt: new Date(Date.now() - 3 * DAY) },
      where: { id: ready.id },
    });
    const waiting = await queued(a);
    const others = await readyExport(b, 5 * DAY);

    await builder.onEvent(deleted(a));

    expect(await statusOf(ready.id)).toBe('expired');
    expect(await statusOf(waiting.id)).toBe('expired');
    expect(store.objects.has(ready.zipKey ?? '')).toBe(false);
    expect(await statusOf(others.id)).toBe('ready');
  });

  it('ignores a request whose export is gone or already built', async () => {
    const builder = await start();
    const a = await world.account('Andrei Ion Marin');
    const ready = await readyExport(a, 5 * DAY);

    await builder.onEvent(requested(a, randomUUID()));
    await builder.onEvent(requested(a, ready.id));

    expect(await statusOf(ready.id)).toBe('ready');
    expect(store.objects.size).toBe(1);
  });
});
