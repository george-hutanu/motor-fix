// @traces 140-FR-001 140-FR-002 140-FR-007 140-FR-010 140-FR-011 140-FR-016 140-FR-017
import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { HttpException, Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DataExportModule } from './data-export.module';
import { DataExportService } from './data-export.service';
import { dataExportWorld } from './data-export.testing';
import type { DataExportStatus } from '../../generated/prisma/enums';
import {
  databaseUrl,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { S3TestStore } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { signAccessToken } from '../access-token';
import { AuthModule } from '../auth.module';
import type { Actor } from '../policy';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(11);
const tokenSecret = 'test-secret';
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const prisma = createPrisma(databaseUrl);
const { reset, world } = dataExportWorld(prisma);
const store = new S3TestStore();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const exportsCounted = (outcome: string) =>
  counterTotal(reader, 'motorfix_data_exports_total', { outcome });

let app: NestExpressApplication;

beforeAll(async () => {
  await store.start();
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      StorageModule.register(store.env()),
      DataExportModule.register(),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await store.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  store.objects.clear();
  store.beforeGet = undefined;
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

const http = () => request(app.getHttpServer());
const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

const ask = (accountId: string) =>
  http().post('/me/data-export').set('Authorization', bearer(accountId));
const state = (accountId: string) =>
  http().get('/me/data-export').set('Authorization', bearer(accountId));
const download = (accountId: string) =>
  http()
    .get('/me/data-export/download')
    .set('Authorization', bearer(accountId))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });

const actorOf = (accountId: string, extra: Partial<Actor> = {}): Actor => ({
  accountId,
  garageId: null,
  permissions: {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  },
  role: 'driver',
  roles: ['driver'],
  ...extra,
});

async function refusedBy(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (error instanceof HttpException) {
      return { body: error.getResponse(), status: error.getStatus() };
    }
    throw error;
  }
  throw new Error('not refused');
}

const exportsOf = (accountId: string) =>
  prisma.dataExport.findMany({
    orderBy: { requestedAt: 'asc' },
    where: { accountId },
  });

// An export as the worker leaves it; a ready one has its file in the store.
async function exportOf(
  accountId: string,
  status: DataExportStatus,
  ago = 2 * DAY,
  file = Buffer.from('PK zip of the driver'),
) {
  const requestedAt = new Date(Date.now() - ago);
  const row = await prisma.dataExport.create({
    data: { accountId, requestedAt, status },
  });
  if (status !== 'ready') return row;
  const zipKey = `data-exports/${accountId}/${row.id}.zip`;
  store.put(zipKey, file, 'application/zip');
  const readyAt = new Date(requestedAt.getTime() + 60_000);
  return prisma.dataExport.update({
    data: { expiresAt: new Date(readyAt.getTime() + 7 * DAY), readyAt, zipKey },
    where: { id: row.id },
  });
}

describe('asking for a copy of my data', () => {
  it('creates one queued export, its audit entry and its event, together', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    const before = await exportsCounted('requested');

    const res = await ask(driverId).expect(201);

    const [row] = await exportsOf(driverId);
    expect(row).toEqual(
      expect.objectContaining({
        attempts: 0,
        expiresAt: null,
        readyAt: null,
        status: 'queued',
        zipKey: null,
      }),
    );
    expect(res.body).toEqual({
      canRequestAt: new Date(row.requestedAt.getTime() + DAY).toISOString(),
      expiresAt: null,
      readyAt: null,
      requestedAt: row.requestedAt.toISOString(),
      status: 'queued',
    });
    const audit = await prisma.activityLog.findMany({
      where: { kind: 'data_export_requested', subjectId: driverId },
    });
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'create',
        actorId: driverId,
        actorRole: 'driver',
        subjectType: 'account',
      }),
    ]);
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'data_export.requested', subjectId: row.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      accountId: driverId,
      exportId: row.id,
    });
    expect(await exportsCounted('requested')).toBe(before + 1);
  });

  it.each([
    ['queued', 'queued' as const],
    ['ready long ago but expired', 'expired' as const],
  ])(
    'answers 429 export_too_soon within 24 hours of a request %s, writing nothing',
    async (_, status) => {
      const driverId = await world.account('Andrei Ion Marin');
      await exportOf(driverId, status, 23 * HOUR);
      const before = await exportsCounted('too_soon');

      const res = await ask(driverId).expect(429);

      expect(res.body.code).toBe('export_too_soon');
      expect(await exportsOf(driverId)).toHaveLength(1);
      expect(await exportsCounted('too_soon')).toBe(before + 1);
      expect(
        // This driver's only: the log keeps other specs' entries.
        await prisma.activityLog.count({
          where: { kind: 'data_export_requested', subjectId: driverId },
        }),
      ).toBe(0);
    },
  );

  it('lets a failed export be asked for again at once', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'failed', HOUR);

    await ask(driverId).expect(201);

    expect((await exportsOf(driverId)).map((e) => e.status)).toEqual([
      'failed',
      'queued',
    ]);
  });

  it('lets an expired export older than 24 hours be followed by a new one', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'expired', 8 * DAY);

    await ask(driverId).expect(201);

    expect(await exportsOf(driverId)).toHaveLength(2);
  });

  it('answers 409 export_ready while a ready file waits, writing nothing', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'ready', 3 * DAY);
    const before = await exportsCounted('already_ready');

    const res = await ask(driverId).expect(409);

    expect(res.body.code).toBe('export_ready');
    expect(await exportsOf(driverId)).toHaveLength(1);
    expect(await exportsCounted('already_ready')).toBe(before + 1);
  });

  it('creates one export for two requests sent at the same moment, the other answered 429', async () => {
    const driverId = await world.account('Andrei Ion Marin');

    const answers = await Promise.all([ask(driverId), ask(driverId)]);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 429]);
    const exports = await exportsOf(driverId);
    expect(exports).toHaveLength(1);
    // This export's only: the outbox keeps other specs' events.
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'data_export.requested', subjectId: exports[0]?.id },
      }),
    ).toBe(1);
  });

  it('counts one driver’s request apart from another’s', async () => {
    const a = await world.account('Andrei Ion Marin');
    const b = await world.account('Bianca Elena Pop');
    await exportOf(a, 'queued', HOUR);

    await ask(b).expect(201);

    expect(await exportsOf(b)).toHaveLength(1);
  });

  it('answers 401 sign_in_required without a session', async () => {
    const res = await http().post('/me/data-export').expect(401);

    expect(res.body.code).toBe('sign_in_required');
  });
});

describe('the state of my copy', () => {
  it('is null before any request', async () => {
    const driverId = await world.account('Andrei Ion Marin');

    const res = await state(driverId).expect(200);

    expect(res.text).toBe('');
  });

  it('is the newest export, with its times and no wait once a day has passed', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'expired', 10 * DAY);
    const ready = await exportOf(driverId, 'ready', 2 * DAY);

    const res = await state(driverId).expect(200);

    expect(res.body).toEqual({
      canRequestAt: null,
      expiresAt: ready.expiresAt?.toISOString(),
      readyAt: ready.readyAt?.toISOString(),
      requestedAt: ready.requestedAt.toISOString(),
      status: 'ready',
    });
  });

  it('says when a new request is allowed after a recent one', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    const row = await exportOf(driverId, 'expired', 5 * HOUR);

    const res = await state(driverId).expect(200);

    expect(res.body.canRequestAt).toBe(
      new Date(row.requestedAt.getTime() + DAY).toISOString(),
    );
  });

  it('never counts a failed export toward the wait', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'failed', HOUR);

    const res = await state(driverId).expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({ canRequestAt: null, status: 'failed' }),
    );
  });

  it('never shows another driver’s export', async () => {
    const a = await world.account('Andrei Ion Marin');
    const b = await world.account('Bianca Elena Pop');
    await exportOf(b, 'ready', HOUR);

    const res = await state(a).expect(200);

    expect(res.text).toBe('');
  });

  it('answers 401 sign_in_required without a session', async () => {
    await http().get('/me/data-export').expect(401);
  });
});

describe('downloading my copy', () => {
  it('serves my ready file as a ZIP attachment that is never cached', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    const file = Buffer.from('PK the file of Andrei');
    const ready = await exportOf(driverId, 'ready', 2 * DAY, file);
    const before = await exportsCounted('downloaded');

    const res = await download(driverId).expect(200);

    expect(res.headers['content-type']).toMatch(/^application\/zip/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="motorfix-date-${ready.readyAt?.toISOString().slice(0, 10)}.zip"`,
    );
    expect(res.body).toEqual(file);
    expect(await exportsCounted('downloaded')).toBe(before + 1);
  });

  it('answers 404 not_found when there is no export', async () => {
    const driverId = await world.account('Andrei Ion Marin');

    const res = await http()
      .get('/me/data-export/download')
      .set('Authorization', bearer(driverId))
      .expect(404);

    expect(res.body.code).toBe('not_found');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(['queued', 'expired', 'failed'] as const)(
    'answers 404 not_found for a %s export',
    async (status) => {
      const driverId = await world.account('Andrei Ion Marin');
      await exportOf(driverId, status, HOUR);

      const res = await http()
        .get('/me/data-export/download')
        .set('Authorization', bearer(driverId))
        .expect(404);

      expect(res.body.code).toBe('not_found');
    },
  );

  it('answers 404 to another driver, whose own export is not ready', async () => {
    const a = await world.account('Andrei Ion Marin');
    const b = await world.account('Bianca Elena Pop');
    await exportOf(a, 'ready', HOUR);

    await http()
      .get('/me/data-export/download')
      .set('Authorization', bearer(b))
      .expect(404);
  });

  it('answers 503 storage_unavailable when the store fails, the export staying ready', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    const ready = await exportOf(driverId, 'ready', HOUR);
    store.beforeGet = () => {
      throw new Error('store down');
    };

    const res = await http()
      .get('/me/data-export/download')
      .set('Authorization', bearer(driverId))
      .expect(503);

    expect(res.body.code).toBe('storage_unavailable');
    const row = await prisma.dataExport.findUniqueOrThrow({
      where: { id: ready.id },
    });
    expect(row.status).toBe('ready');
  });

  it('answers 401 sign_in_required without a session', async () => {
    await http().get('/me/data-export/download').expect(401);
  });
});

describe('an assistant acting for the account', () => {
  it('may not ask for a copy, and nothing is written', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    const before = await exportsCounted('forbidden');

    const refused = await refusedBy(
      app
        .get(DataExportService)
        .request(actorOf(driverId, { via: 'assistant' })),
    );

    expect(refused).toEqual({
      body: expect.objectContaining({ code: 'forbidden' }),
      status: 403,
    });
    expect(await exportsOf(driverId)).toHaveLength(0);
    expect(await exportsCounted('forbidden')).toBe(before + 1);
  });

  it('may not read the state of the copy', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'ready', HOUR);

    const refused = await refusedBy(
      app
        .get(DataExportService)
        .latest(actorOf(driverId, { via: 'assistant' })),
    );

    expect(refused).toEqual(expect.objectContaining({ status: 403 }));
  });

  it('may not download the copy', async () => {
    const driverId = await world.account('Andrei Ion Marin');
    await exportOf(driverId, 'ready', HOUR);

    const refused = await refusedBy(
      app
        .get(DataExportService)
        .download(actorOf(driverId, { via: 'assistant' })),
    );

    expect(refused).toEqual({
      body: expect.objectContaining({ code: 'forbidden' }),
      status: 403,
    });
  });
});
