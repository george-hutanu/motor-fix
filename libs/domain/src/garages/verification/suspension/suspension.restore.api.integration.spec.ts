import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SuspensionService } from './suspension.service';
import { staffedGarage } from './suspension.testing';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { addDays, localDay } from '../../../bucharest';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

// @traces 067-FR-004 067-FR-005

const redisUrl = redisUrlFor(13);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const REASON = 'Autorizație RAR expirată pe 12 sept. 2026';
const NOTE = 'A refăcut autorizația, verificată pe loc.';

let app: NestExpressApplication;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      StorageModule.register(UNUSED_STORAGE),
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
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
  await prisma.$disconnect();
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const today = () => localDay(new Date());

let adminId: string;
let admin: string;
let garage: Awaited<ReturnType<typeof staffedGarage>>;

beforeEach(async () => {
  await reset();
  await prisma.outboxEvent.deleteMany();
  garage = await staffedGarage(prisma, account);
  await prisma.garage.update({
    data: {
      lastCheckedOn: new Date(addDays(today(), -40)),
      rarActivities: ['mechanics', 'brakes'],
    },
    where: { id: garage.id },
  });
  adminId = await account('Ana Popescu', ['admin']);
  admin = bearer(adminId, 'admin');
});

const restore = (
  garageId: string,
  body: Record<string, unknown>,
  as: string | null = admin,
) => {
  const call = http().post(`/admin/garages/${garageId}/restore`);
  return (as === null ? call : call.set('Authorization', as)).send(body);
};

async function suspendedFor(cause: 'recheck_failed' | 'admin') {
  await app.get(SuspensionService).suspend(
    {
      accountId: adminId,
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'admin',
      roles: ['admin'],
    },
    garage.id,
    cause,
    REASON,
  );
  const [row] = await prisma.garageSuspension.findMany({
    where: { garageId: garage.id },
  });
  if (!row) throw new Error('no suspension');
  return row;
}

const stillSuspended = async () => {
  expect(
    (await prisma.garage.findUniqueOrThrow({ where: { id: garage.id } }))
      .status,
  ).toBe('suspended');
  expect(
    await prisma.activityLog.findMany({
      where: { kind: 'garage_restored', subjectId: garage.id },
    }),
  ).toEqual([]);
};

describe('POST /admin/garages/:id/restore', () => {
  it('answers 200 with the lifted suspension', async () => {
    const open = await suspendedFor('recheck_failed');

    const res = await restore(garage.id, {
      note: NOTE,
      recheck: { activities: ['mechanics', 'brakes'], checkedOn: today() },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cause: 'recheck_failed',
      fromTime: open.fromTime.toISOString(),
      garageId: garage.id,
      id: open.id,
      lastCheckedOn: today(),
      liftedBy: { name: 'Ana P.' },
      note: NOTE,
      untilTime: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(res.body.untilTime))).toBe(false);
  });

  it('answers null for no note and the garage date when nothing was re-checked', async () => {
    await suspendedFor('admin');
    await prisma.garageSuspension.updateMany({
      data: { cause: 'documents_overdue' },
      where: { garageId: garage.id },
    });
    await prisma.documentCycle.create({
      data: {
        dueOn: new Date(addDays(today(), 300)),
        garageId: garage.id,
        state: 'due',
      },
    });

    const res = await restore(garage.id, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      cause: 'documents_overdue',
      lastCheckedOn: addDays(today(), -40),
      note: null,
    });
  });

  it('answers 401 sign_in_required without a session', async () => {
    await suspendedFor('admin');

    const res = await restore(garage.id, { note: NOTE }, null);

    expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
    await stillSuspended();
  });

  it.each([
    ['a driver', 'driverId', 'driver'],
    ['the owner', 'ownerId', 'garage'],
    ['a receptionist', 'receptionistId', 'receptionist'],
    ['a mechanic', 'mechanicId', 'mechanic'],
  ] as const)('answers %s 404 with no garage data', async (_, key, role) => {
    // The role guard answers before the use case, as on every admin route.
    await suspendedFor('admin');

    const res = await restore(
      garage.id,
      { note: NOTE },
      bearer(garage[key], role),
    );

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(garage.name);
    expect(JSON.stringify(res.body)).not.toContain(REASON);
    await stillSuspended();
  });

  it('answers an admin 404 for a malformed id', async () => {
    const res = await restore('not-a-uuid', { note: NOTE });

    expect([res.status, res.body.code]).toEqual([404, 'not_found']);
  });

  it.each([
    ['a blank note', { note: '   ' }, 'note'],
    ['a note of 1,001 characters', { note: 'a'.repeat(1001) }, 'note'],
    ['a note with a bell character', { note: 'gata\u0007' }, 'note'],
    [
      'a re-check with no activities',
      { recheck: { activities: [], checkedOn: '2026-10-03' } },
      'recheck',
    ],
    [
      'a re-check dated on no calendar day',
      { recheck: { activities: ['mechanics'], checkedOn: '2026-02-30' } },
      'recheck',
    ],
    ['an unknown field', { note: NOTE, status: 'approved' }, 'status'],
  ])('answers 400 naming the field for %s', async (_, body, field) => {
    await suspendedFor('admin');

    const res = await restore(garage.id, body);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(field);
    await stillSuspended();
  });

  it('refuses a body that is not JSON', async () => {
    await suspendedFor('admin');

    const res = await http()
      .post(`/admin/garages/${garage.id}/restore`)
      .set('Authorization', admin)
      .set('Content-Type', 'text/plain')
      .send(`note=${NOTE}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await stillSuspended();
  });

  it('answers 400 validation_failed naming the note when the cause needs one', async () => {
    await suspendedFor('admin');

    const res = await restore(garage.id, {});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      field: 'note',
    });
    await stillSuspended();
  });

  it('answers 409 with the code and the message in the admin language', async () => {
    await suspendedFor('recheck_failed');
    const english = bearer(
      await account('Jane Doe', ['admin'], { language: 'en' }),
      'admin',
    );

    const res = await restore(garage.id, {}, english);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'recheck_missing',
      message: 'A valid RAR re-check is missing',
    });
  });

  it('answers 422 naming the field for a re-check on another cause', async () => {
    await suspendedFor('admin');

    const res = await restore(garage.id, {
      note: NOTE,
      recheck: { activities: ['mechanics'], checkedOn: today() },
    });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: 'recheck_not_expected',
      field: 'recheck',
    });
  });
});
