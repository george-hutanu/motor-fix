import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { featureOn } from './feature-on';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outboxMark } from '../../events/outbox.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../storage/s3-test-store';
import { StorageModule } from '../../storage/storage.module';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(4);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
// The history and the outbox are never emptied: each test reads its own.
let since: Date;
let mark: bigint;

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

beforeEach(async () => {
  await reset();
  const [{ at }] = await prisma.$queryRaw<
    { at: Date }[]
  >`SELECT clock_timestamp() AS at`;
  since = at;
  mark = await outboxMark(prisma);
});

const ALL_ON = {
  day_sheets: true,
  lift_schedule: true,
  live_media: true,
  team_mechanics: true,
  whatsapp: true,
};

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

// Service Auto Nord with its owner Mihai and his receptionist; Atelier Dinamo
// with its owner Radu; a driver and an admin. No mechanic unless a test adds one.
async function world() {
  const nord = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
  });
  const dinamo = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: nord.id, role: 'receptionist' },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  const andrei = await account('andrei', ['driver']);
  const ana = await account('ana', ['admin']);
  return {
    admin: bearer(ana, 'admin'),
    dinamo,
    driver: bearer(andrei, 'driver'),
    mihai,
    nord,
    other: bearer(radu, 'garage'),
    owner: bearer(mihai, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

async function addMechanic(w: World, withAccount = true) {
  const accountId = withAccount
    ? await account(`vlad-${randomUUID()}`, ['mechanic'])
    : null;
  const row = await prisma.mechanic.create({
    data: { accountId, garageId: w.nord.id, name: 'Vlad' },
  });
  return { accountId, id: row.id };
}

const put = (
  w: World,
  feature: string,
  body: object,
  as: string | null = w.owner,
  garageId = w.nord.id,
) => {
  const req = http().put(`/garages/${garageId}/features/${feature}`).send(body);
  return as ? req.set('Authorization', as) : req;
};

const rows = (garageId: string) =>
  prisma.garageFeature.findMany({
    orderBy: { key: 'asc' },
    select: { enabled: true, key: true },
    where: { garageId },
  });

const history = (garageId: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { at: { gte: since }, garageId, subjectType: 'garage_feature' },
  });

const events = (garageId: string) =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: {
      id: { gt: mark },
      kind: 'garage.features_changed',
      subjectId: garageId,
    },
  });

async function expectNothingWritten(w: World) {
  expect(await rows(w.nord.id)).toEqual([]);
  expect(await history(w.nord.id)).toEqual([]);
  expect(await events(w.nord.id)).toEqual([]);
}

// @traces 398-FR-007
describe('featureOn', () => {
  it('is on for every key of a garage with no rows', async () => {
    const w = await world();

    for (const key of Object.keys(ALL_ON)) {
      expect(await featureOn(prisma, w.nord.id, key)).toBe(true);
    }
  });

  it('follows each stored row, key by key', async () => {
    const w = await world();
    await prisma.garageFeature.createMany({
      data: [
        { enabled: false, garageId: w.nord.id, key: 'lift_schedule' },
        { enabled: true, garageId: w.nord.id, key: 'whatsapp' },
        { enabled: false, garageId: w.nord.id, key: 'day_sheets' },
      ],
    });

    expect(await featureOn(prisma, w.nord.id, 'lift_schedule')).toBe(false);
    expect(await featureOn(prisma, w.nord.id, 'whatsapp')).toBe(true);
    expect(await featureOn(prisma, w.nord.id, 'day_sheets')).toBe(false);
    expect(await featureOn(prisma, w.nord.id, 'team_mechanics')).toBe(true);
    expect(await featureOn(prisma, w.dinamo.id, 'lift_schedule')).toBe(true);
  });

  it('reads inside a transaction', async () => {
    const w = await world();

    const seen = await prisma.$transaction(async (tx) => {
      await tx.garageFeature.create({
        data: { enabled: false, garageId: w.nord.id, key: 'live_media' },
      });
      return featureOn(tx, w.nord.id, 'live_media');
    });

    expect(seen).toBe(false);
  });

  it('refuses a mechanic invite once the owner switched the team off', async () => {
    const w = await world();
    await put(w, 'team_mechanics', { enabled: false });

    const res = await http()
      .post(`/garages/${w.nord.id}/invites`)
      .set('Authorization', w.owner)
      .send({ email: 'elena@example.test', kind: 'mechanic', name: 'Elena' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('feature_off');
  });
});

// @traces 398-FR-003 398-FR-006
describe('PUT /garages/:garageId/features/:feature', () => {
  it('answers the five switches, all on, for a garage with no rows', async () => {
    const w = await world();

    const res = await put(w, 'whatsapp', { enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ features: ALL_ON });
  });

  it('creates the row on the first change and updates it on the next', async () => {
    const w = await world();

    const off = await put(w, 'lift_schedule', { enabled: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({
      features: { ...ALL_ON, lift_schedule: false },
    });
    expect(await rows(w.nord.id)).toEqual([
      { enabled: false, key: 'lift_schedule' },
    ]);

    const on = await put(w, 'lift_schedule', { enabled: true });
    expect(on.body).toEqual({ features: ALL_ON });
    expect(await rows(w.nord.id)).toEqual([
      { enabled: true, key: 'lift_schedule' },
    ]);
  });

  it('writes one audit entry and one event with the change', async () => {
    const w = await world();

    await put(w, 'lift_schedule', { enabled: false });

    expect(await history(w.nord.id)).toEqual([
      expect.objectContaining({
        action: 'update',
        actorId: w.mihai,
        actorRole: 'owner',
        field: 'lift_schedule',
        garageId: w.nord.id,
        newValue: false,
        oldValue: true,
        subjectId: w.nord.id,
        subjectType: 'garage_feature',
      }),
    ]);
    expect(await events(w.nord.id)).toEqual([
      expect.objectContaining({
        audience: [`garage:${w.nord.id}`],
        kind: 'garage.features_changed',
        payload: {
          enabled: false,
          feature: 'lift_schedule',
          garageId: w.nord.id,
        },
      }),
    ]);
  });

  it('records the stored value as the old one when a row exists', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.nord.id, key: 'day_sheets' },
    });

    await put(w, 'day_sheets', { enabled: true });

    expect(await history(w.nord.id)).toEqual([
      expect.objectContaining({
        field: 'day_sheets',
        newValue: true,
        oldValue: false,
      }),
    ]);
  });

  it('writes nothing when the switch already holds the value', async () => {
    const w = await world();
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: w.nord.id, key: 'whatsapp' },
    });

    const off = await put(w, 'whatsapp', { enabled: false });
    const on = await put(w, 'live_media', { enabled: true });

    expect(off.status).toBe(200);
    expect(off.body).toEqual({ features: { ...ALL_ON, whatsapp: false } });
    expect(on.status).toBe(200);
    expect(await rows(w.nord.id)).toEqual([
      { enabled: false, key: 'whatsapp' },
    ]);
    expect(await history(w.nord.id)).toEqual([]);
    expect(await events(w.nord.id)).toEqual([]);
  });

  it('records one change when the same switch is turned off twice at once', async () => {
    const w = await world();

    const answers = await Promise.all([
      put(w, 'lift_schedule', { enabled: false }),
      put(w, 'lift_schedule', { enabled: false }),
    ]);

    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(await history(w.nord.id)).toHaveLength(1);
    expect(await events(w.nord.id)).toHaveLength(1);
  });

  it('keeps neither the row, the entry nor the event when the entry cannot be written', async () => {
    const w = await world();
    const audit = app.get<AuditPort>(AUDIT_PORT);
    const failing = jest
      .spyOn(audit, 'record')
      .mockRejectedValueOnce(new Error('the entry write failed'));

    const res = await put(w, 'live_media', { enabled: false });
    failing.mockRestore();

    expect(res.status).toBe(500);
    await expectNothingWritten(w);
  });

  it('answers 400 validation_failed for a key that is not one of the five', async () => {
    const w = await world();

    const res = await put(w, 'parking', { enabled: false });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'validation_failed',
      errors: [{ code: 'unknown_feature', field: 'feature' }],
    });
    await expectNothingWritten(w);
  });

  // The API's problem filter names these validation_failed (apps/api).
  it('answers 400 naming enabled for a missing or non-boolean value', async () => {
    const w = await world();

    for (const body of [{}, { enabled: 'yes' }, { enabled: 0 }]) {
      const res = await put(w, 'whatsapp', body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('enabled');
    }
    await expectNothingWritten(w);
  });

  it('answers 400 to an extra property', async () => {
    const w = await world();

    const res = await put(w, 'whatsapp', {
      enabled: false,
      garageId: w.dinamo.id,
    });

    expect(res.status).toBe(400);
    await expectNothingWritten(w);
  });
});

// @traces 398-FR-005
describe('switching the team off', () => {
  it('is refused with 409 while another mechanic with an account is on the team', async () => {
    const w = await world();
    await addMechanic(w);

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('mechanics_on_team');
    await expectNothingWritten(w);
  });

  it('is refused while a mechanic card with no account is on the team', async () => {
    const w = await world();
    await addMechanic(w, false);

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('mechanics_on_team');
    await expectNothingWritten(w);
  });

  it("goes through when the only mechanic row is the owner's own", async () => {
    const w = await world();
    await prisma.mechanic.create({
      data: { accountId: w.mihai, garageId: w.nord.id, name: 'Mihai' },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.features.team_mechanics).toBe(false);
  });

  // @traces 055-FR-004
  it('goes through when the only other card was detached from a deleted account', async () => {
    const w = await world();
    await prisma.mechanic.create({
      data: { garageId: w.nord.id, name: 'Elena', removedAt: new Date() },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.features.team_mechanics).toBe(false);
  });

  it('goes through once the other mechanic has been removed', async () => {
    const w = await world();
    const vlad = await addMechanic(w);
    expect((await put(w, 'team_mechanics', { enabled: false })).status).toBe(
      409,
    );

    await prisma.mechanic.delete({ where: { id: vlad.id } });
    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(200);
    expect(await rows(w.nord.id)).toEqual([
      { enabled: false, key: 'team_mechanics' },
    ]);
    expect(await history(w.nord.id)).toHaveLength(1);
    expect(await events(w.nord.id)).toHaveLength(1);
  });

  it('is not blocked by an open invitation', async () => {
    const w = await world();
    await prisma.staffInvite.create({
      data: {
        email: 'elena@example.test',
        expiresAt: new Date(Date.now() + 86_400_000),
        garageId: w.nord.id,
        kind: 'mechanic',
        name: 'Elena Stan',
        tokenHash: randomUUID(),
      },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(200);
  });

  it('never checks the team for the other switches', async () => {
    const w = await world();
    await addMechanic(w);

    const res = await put(w, 'lift_schedule', { enabled: false });

    expect(res.status).toBe(200);
  });

  it("does not count another garage's mechanics", async () => {
    const w = await world();
    await prisma.mechanic.create({
      data: { garageId: w.dinamo.id, name: 'Sorin' },
    });

    const res = await put(w, 'team_mechanics', { enabled: false });

    expect(res.status).toBe(200);
  });
});

// @traces 398-FR-004
describe('who may change the switches', () => {
  it('answers 401 sign_in_required without a session', async () => {
    const w = await world();

    const res = await put(w, 'whatsapp', { enabled: false }, null);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
    await expectNothingWritten(w);
  });

  it("answers 403 forbidden to the garage's own receptionist and mechanic", async () => {
    const w = await world();
    const vlad = await addMechanic(w);

    for (const as of [w.receptionist, bearer(vlad.accountId!, 'mechanic')]) {
      const res = await put(w, 'whatsapp', { enabled: false }, as);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    }
    await expectNothingWritten(w);
  });

  it("answers 404 not_found to another garage's owner, a driver and an admin", async () => {
    const w = await world();

    for (const as of [w.other, w.driver, w.admin]) {
      const res = await put(w, 'whatsapp', { enabled: false }, as);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    }
    await expectNothingWritten(w);
  });

  it('answers 404 for a garage that does not exist', async () => {
    const w = await world();

    const res = await put(
      w,
      'whatsapp',
      { enabled: false },
      w.owner,
      randomUUID(),
    );

    expect(res.status).toBe(404);
  });
});
