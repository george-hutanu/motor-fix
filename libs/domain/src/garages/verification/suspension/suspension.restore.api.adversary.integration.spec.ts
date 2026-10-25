import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { SuspensionService } from './suspension.service';
import { staffedGarage } from './suspension.testing';
import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
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

describe('POST /admin/garages/:id/restore under hostile input', () => {
  it.each([
    ['a null note', { note: null }],
    ['a null re-check', { recheck: null }],
    ['a re-check that is a list', { recheck: [] }],
    ['a re-check that is text', { recheck: 'today' }],
    ['a number for a note', { note: 12 }],
    ['a list for a note', { note: ['a'] }],
    [
      'an unknown field inside the re-check',
      {
        recheck: {
          activities: ['mechanics'],
          checkedOn: '2026-10-03',
          result: 'failed',
        },
      },
    ],
    [
      'full-width digits in the date',
      { recheck: { activities: ['mechanics'], checkedOn: '２０２６-10-03' } },
    ],
    [
      'a date without zero padding',
      { recheck: { activities: ['mechanics'], checkedOn: '2026-10-3' } },
    ],
    [
      'activities that are objects',
      {
        recheck: {
          activities: [{ code: 'mechanics' }],
          checkedOn: '2026-10-03',
        },
      },
    ],
    [
      'a code of 41 characters',
      { recheck: { activities: ['a'.repeat(41)], checkedOn: '2026-10-03' } },
    ],
  ])('answers 400 for %s and writes nothing', async (_, body) => {
    await suspendedFor('recheck_failed');

    const res = await restore(garage.id, body);

    expect(res.status).toBe(400);
    await stillSuspended();
  });

  it('answers 400 for a body that is a list', async () => {
    await suspendedFor('admin');

    const res = await restore(garage.id, [{ note: NOTE }] as never);

    expect(res.status).toBe(400);
    await stillSuspended();
  });

  it('refuses with 413 or 422, not a server error, ten thousand activity codes', async () => {
    await suspendedFor('recheck_failed');
    const activities = Array.from({ length: 10_000 }, (_, i) => `code-${i}`);

    const res = await restore(garage.id, {
      recheck: { activities, checkedOn: today() },
    });

    expect([413, 422]).toContain(res.status);
    await stillSuspended();
  });

  it('refuses a note of two megabytes without a server error', async () => {
    await suspendedFor('admin');

    const res = await restore(garage.id, { note: 'a'.repeat(2_000_000) });

    expect([400, 413]).toContain(res.status);
    await stillSuspended();
  });

  it.each([
    ["' OR '1'='1"],
    ['00000000-0000-0000-0000-000000000000'],
    ['%00'],
    ['..%2f..%2fadmin'],
  ])('answers an admin 404 for the id %s', async (id) => {
    const res = await restore(id, { note: NOTE });

    expect(res.status).toBe(404);
  });

  it('never answers 200 to a token for an admin account that does not exist', async () => {
    await suspendedFor('admin');
    const ghost = bearer('7d3c1a52-8d6e-4f0b-9d5e-2f7f3c8b1a90', 'admin');

    const res = await restore(garage.id, { note: NOTE }, ghost);

    expect([401, 404]).toContain(res.status);
    await stillSuspended();
  });

  it('never answers 200 to a token signed with another secret', async () => {
    await suspendedFor('admin');
    const forged = `Bearer ${signAccessToken({ accountId: adminId, role: 'admin' }, 'other-secret')}`;

    const res = await restore(garage.id, { note: NOTE }, forged);

    expect(res.status).toBe(401);
    await stillSuspended();
  });

  it('answers the second identical call 409 naming the first admin', async () => {
    await suspendedFor('admin');
    expect((await restore(garage.id, { note: NOTE })).status).toBe(200);

    const res = await restore(garage.id, { note: NOTE });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'garage_already_restored',
      message: 'Deja repus pe hartă de Ana P.',
    });
  });

  it('answers the already restored message in English to an English admin', async () => {
    await suspendedFor('admin');
    await restore(garage.id, { note: NOTE });
    const english = bearer(
      await account('Jane Doe', ['admin'], { language: 'en' }),
      'admin',
    );

    const res = await restore(garage.id, { note: NOTE }, english);

    expect(res.body.message).toBe('Already put back on the map by Ana P.');
  });

  it('answers 409 garage_not_suspended for an approved garage that never was', async () => {
    const res = await restore(garage.id, { note: NOTE });

    expect([res.status, res.body.code]).toEqual([409, 'garage_not_suspended']);
  });

  it('keeps a note of 1,000 emoji whole through the wire', async () => {
    await suspendedFor('admin');
    const note = '🚗'.repeat(1000);

    const res = await restore(garage.id, { note });

    expect(res.status).toBe(200);
    expect(res.body.note).toBe(note);
  });

  it('answers 400 for a note of 1,001 emoji', async () => {
    await suspendedFor('admin');

    const res = await restore(garage.id, { note: '🚗'.repeat(1001) });

    expect(res.status).toBe(400);
    await stillSuspended();
  });

  it('refuses a form-encoded body', async () => {
    await suspendedFor('admin');

    const res = await http()
      .post(`/admin/garages/${garage.id}/restore`)
      .set('Authorization', admin)
      .type('form')
      .send({ note: NOTE });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await stillSuspended();
  });

  it('refuses with 400 a note holding half of a surrogate pair', async () => {
    await suspendedFor('admin');

    const res = await http()
      .post(`/admin/garages/${garage.id}/restore`)
      .set('Authorization', admin)
      .set('Content-Type', 'application/json')
      .send('{"note":"gata \\ud83d"}');

    expect(res.status).toBe(400);
    await stillSuspended();
  });

  it('refuses with 400 a re-check dated in the year 0 of a never checked garage', async () => {
    await prisma.garage.update({
      data: { lastCheckedOn: null },
      where: { id: garage.id },
    });
    await suspendedFor('recheck_failed');

    const res = await restore(garage.id, {
      recheck: { activities: ['mechanics'], checkedOn: '0000-01-01' },
    });

    expect(res.status).toBe(400);
    await stillSuspended();
  });
});
