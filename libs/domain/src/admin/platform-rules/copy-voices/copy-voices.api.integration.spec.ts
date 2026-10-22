import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { MAINTENANCE, type Maintenance } from '../../../auth/maintenance';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../../notifications/notifications.testing';
import { PlatformRulesModule } from '../platform-rules.module';

class NoNotifications {}
const notifications = {
  exports: [NotificationsService],
  module: NoNotifications,
  providers: [{ provide: NotificationsService, useValue: {} }],
};

const redisUrl = redisUrlFor(14);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;
const ON = { enabled: true, pinned: false };
const OFF = { enabled: false, pinned: false };
const PINNED = { enabled: true, pinned: true };

let app: INestApplication;

const maintenance = async (on: boolean) => {
  await prisma.platformRule.updateMany({
    data: { updatedAt: null, updatedBy: null, value: on },
    where: { key: 'maintenance_mode' },
  });
  await app.get<Maintenance>(MAINTENANCE, { strict: false }).set(on);
};

const allOn = () =>
  prisma.copyVoiceSetting.updateMany({
    data: { enabled: true, pinned: false, updatedAt: null, updatedBy: null },
  });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      PlatformRulesModule.register({ production: false }, notifications),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
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
  await maintenance(false);
  await allOn();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await maintenance(false);
  await allOn();
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const as = async (role: Role) =>
  bearer(await account(`Cont ${role}`, [role]), role);

const list = (auth?: string) => {
  const call = request(app.getHttpServer()).get('/admin/copy-voices');
  return auth ? call.set('Authorization', auth) : call;
};
const change = (voice: string | number, body: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .patch(`/admin/copy-voices/${voice}`)
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};
const publicRead = (query = '') =>
  request(app.getHttpServer()).get(`/copy-voices${query}`);

describe('GET /admin/copy-voices', () => {
  // @traces 010-FR-002
  it('answers an admin the five voices', async () => {
    const res = await list(await as('admin'));

    expect(res.status).toBe(200);
    expect(res.body.voices.map((v: { voice: number }) => v.voice)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(res.body.voices[0]).toEqual({ ...ON, updatedAt: null, voice: 1 });
  });

  // @traces 010-FR-002
  it.each(NON_ADMIN)('answers 404 to a %s', async (role) => {
    expect((await list(await as(role))).status).toBe(404);
  });
});

describe('PATCH /admin/copy-voices/:voice', () => {
  // @traces 010-FR-003
  it('switches a voice off and on again for an admin', async () => {
    const auth = await as('admin');

    const off = await change(4, { ...OFF, seen: ON }, auth);
    expect(off.status).toBe(200);
    expect(off.body.voices[3]).toMatchObject({ ...OFF, voice: 4 });

    const on = await change(4, { ...ON, seen: OFF }, auth);
    expect(on.status).toBe(200);
    expect(on.body.voices[3]).toMatchObject({ ...ON, voice: 4 });
  });

  // @traces 010-FR-003
  it.each(NON_ADMIN)(
    'answers 404 to a %s and changes nothing',
    async (role) => {
      const res = await change(2, { ...OFF, seen: ON }, await as(role));

      expect(res.status).toBe(404);
      const row = await prisma.copyVoiceSetting.findUniqueOrThrow({
        where: { voice: 2 },
      });
      expect(row.enabled).toBe(true);
    },
  );

  // @traces 010-FR-003
  it.each(['0', '6', 'abc', '1.5'])(
    'answers 404 not_found for voice %s',
    async (voice) => {
      const res = await change(voice, { ...OFF, seen: ON }, await as('admin'));

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  // @traces 010-FR-003
  it.each([
    {},
    { enabled: false, pinned: false },
    { enabled: 'no', pinned: false, seen: ON },
    { enabled: false, pinned: false, seen: { enabled: true } },
  ])('answers 400 to the malformed body %j', async (body) => {
    expect((await change(2, body, await as('admin'))).status).toBe(400);
  });

  // @traces 010-FR-004
  it('refuses to leave no voice on with 422 last_voice', async () => {
    await prisma.copyVoiceSetting.updateMany({
      data: { enabled: false },
      where: { voice: { lt: 5 } },
    });

    const res = await change(5, { ...OFF, seen: ON }, await as('admin'));

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('last_voice');
  });

  // @traces 010-FR-005
  // @traces 010-FR-006
  it('pins one voice for everyone, moves the pin, and refuses the pin rules', async () => {
    const auth = await as('admin');

    expect((await change(2, { ...PINNED, seen: ON }, auth)).status).toBe(200);
    const moved = await change(5, { ...PINNED, seen: ON }, auth);
    expect(moved.status).toBe(200);
    expect(
      moved.body.voices.filter((v: { pinned: boolean }) => v.pinned),
    ).toEqual([expect.objectContaining({ voice: 5 })]);

    const pinnedOff = await change(5, { ...OFF, seen: PINNED }, auth);
    expect(pinnedOff.status).toBe(422);
    expect(pinnedOff.body.code).toBe('voice_pinned');

    expect((await change(3, { ...OFF, seen: ON }, auth)).status).toBe(200);
    const offPin = await change(
      3,
      { enabled: false, pinned: true, seen: OFF },
      auth,
    );
    expect(offPin.status).toBe(422);
    expect(offPin.body.code).toBe('voice_off');

    expect((await change(5, { ...ON, seen: PINNED }, auth)).status).toBe(200);
    expect((await publicRead()).body).toEqual({
      enabled: [1, 2, 4, 5],
      pinned: null,
    });
  });

  // @traces 010-FR-007
  it('answers 409 stale_value when the screen showed another state', async () => {
    const res = await change(2, { ...ON, seen: OFF }, await as('admin'));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale_value');
  });
});

describe('GET /copy-voices', () => {
  // @traces 010-FR-009
  it('answers a visitor the voices that are on and the pin, cacheable for a minute', async () => {
    await prisma.copyVoiceSetting.update({
      data: { enabled: false },
      where: { voice: 3 },
    });

    const res = await publicRead();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: [1, 2, 4, 5], pinned: null });
    expect(res.headers['cache-control']).toBe('max-age=60');
  });

  // @traces 010-FR-009
  it('takes an at query as a cache key only, and answers during maintenance', async () => {
    await maintenance(true);

    const res = await publicRead('?at=2026-10-22T10:00:00.000Z');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: [1, 2, 3, 4, 5], pinned: null });
  });
});
