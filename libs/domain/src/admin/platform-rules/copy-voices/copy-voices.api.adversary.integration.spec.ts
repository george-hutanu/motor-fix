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
const entriesFor = (accountId: string) =>
  prisma.activityLog.count({
    where: { actorId: accountId, subjectType: 'copy_voice' },
  });
const events = () =>
  prisma.outboxEvent.count({
    where: { kind: 'platform_rule.changed', subjectId: 'copy_voices' },
  });
const stored = async () =>
  (await prisma.copyVoiceSetting.findMany({ orderBy: { voice: 'asc' } })).map(
    ({ enabled, pinned, voice }) => ({ enabled, pinned, voice }),
  );
const pinnedOf = (body: { voices: { pinned: boolean; voice: number }[] }) =>
  body.voices.filter((v) => v.pinned).map((v) => v.voice);

describe('the voice in the path', () => {
  // @traces 010-FR-003
  it.each(['05', '%203', '3abc', '-1', '3.0', '1e0', '%2B3', '٣', '3%20', ''])(
    'answers 404 not_found for %j and changes nothing',
    async (voice) => {
      const res = await change(voice, { ...OFF, seen: ON }, await as('admin'));

      expect([404]).toContain(res.status);
      expect(await stored()).toEqual(
        [1, 2, 3, 4, 5].map((n) => ({ ...ON, voice: n })),
      );
    },
  );
});

describe('the body of a change', () => {
  // @traces 010-FR-003
  it.each([
    ['an extra field', { ...OFF, note: 'x', seen: ON }],
    ['an extra field in seen', { ...OFF, seen: { ...ON, voice: 2 } }],
    ['enabled null', { enabled: null, pinned: false, seen: ON }],
    ['pinned missing', { enabled: false, seen: ON }],
    ['seen null', { ...OFF, seen: null }],
    ['seen a string', { ...OFF, seen: 'on' }],
    ['enabled a number', { enabled: 0, pinned: false, seen: ON }],
    ['pinned a string', { enabled: true, pinned: 'false', seen: ON }],
    ['a list', [{ ...OFF, seen: ON }]],
  ])('answers 400 to %s and changes nothing', async (_title, body) => {
    const res = await change(2, body, await as('admin'));

    expect(res.status).toBe(400);
    expect(await stored()).toEqual(
      [1, 2, 3, 4, 5].map((n) => ({ ...ON, voice: n })),
    );
  });
});

describe('the pin and the switch', () => {
  // @traces 010-FR-005
  it('refuses to switch off the pinned voice even when the same body removes the pin', async () => {
    const auth = await as('admin');
    await change(3, { ...PINNED, seen: ON }, auth);

    const res = await change(3, { ...OFF, seen: PINNED }, auth);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('voice_pinned');
    expect((await stored())[2]).toEqual({ ...PINNED, voice: 3 });
  });

  // @traces 010-FR-005
  it('refuses a body that pins a voice while switching it off', async () => {
    const res = await change(
      2,
      { enabled: false, pinned: true, seen: ON },
      await as('admin'),
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('voice_off');
    expect((await stored())[1]).toEqual({ ...ON, voice: 2 });
  });

  // @traces 010-FR-005
  it('lets one change switch a voice on and pin it', async () => {
    const auth = await as('admin');
    await change(2, { ...OFF, seen: ON }, auth);

    const res = await change(2, { ...PINNED, seen: OFF }, auth);

    expect(res.status).toBe(200);
    expect(res.body.voices[1]).toMatchObject({ ...PINNED, voice: 2 });
  });

  // @traces 010-FR-006
  it('moves the pin off the other voice in the same change and audits both', async () => {
    const admin = await account('Cont admin pin', ['admin']);
    const auth = bearer(admin, 'admin');
    await change(2, { ...PINNED, seen: ON }, auth);
    const before = await entriesFor(admin);

    const res = await change(5, { ...PINNED, seen: ON }, auth);

    expect(res.status).toBe(200);
    expect(pinnedOf(res.body)).toEqual([5]);
    expect(await entriesFor(admin)).toBe(before + 2);
  });

  // @traces 010-FR-006
  it('lets the pinned voice be unpinned and leaves nothing pinned', async () => {
    const auth = await as('admin');
    await change(2, { ...PINNED, seen: ON }, auth);

    const res = await change(2, { ...ON, seen: PINNED }, auth);

    expect(res.status).toBe(200);
    expect(pinnedOf(res.body)).toEqual([]);
    expect((await publicRead()).body.pinned).toBeNull();
  });
});

describe('the order of the checks', () => {
  // @traces 010-FR-007
  it('answers 409 before 422 when the seen state is stale on the last voice', async () => {
    await prisma.copyVoiceSetting.updateMany({
      data: { enabled: false },
      where: { voice: { lt: 5 } },
    });

    const res = await change(
      5,
      { ...OFF, seen: { enabled: false, pinned: false } },
      await as('admin'),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('stale_value');
  });

  // @traces 010-FR-007
  it('answers 409 before the no-change answer when seen differs from the stored state', async () => {
    const res = await change(2, { ...ON, seen: OFF }, await as('admin'));

    expect(res.status).toBe(409);
  });

  // @traces 010-FR-007
  it('answers 200 with no audit entry and no event for a change to the stored state', async () => {
    const admin = await account('Cont admin same', ['admin']);
    const events0 = await events();

    const res = await change(2, { ...ON, seen: ON }, bearer(admin, 'admin'));

    expect(res.status).toBe(200);
    expect(res.body.voices).toHaveLength(5);
    expect(await entriesFor(admin)).toBe(0);
    expect(await events()).toBe(events0);
  });

  // @traces 010-FR-007
  it('answers the no-change 200 even when the only voice on is switched to on', async () => {
    await prisma.copyVoiceSetting.updateMany({
      data: { enabled: false },
      where: { voice: { lt: 5 } },
    });

    const res = await change(5, { ...ON, seen: ON }, await as('admin'));

    expect(res.status).toBe(200);
  });

  // @traces 010-FR-007
  it('lets exactly one of two admins win the same change at once', async () => {
    const a = bearer(await account('Cont admin A', ['admin']), 'admin');
    const b = bearer(await account('Cont admin B', ['admin']), 'admin');

    const results = await Promise.all([
      change(2, { ...OFF, seen: ON }, a),
      change(2, { ...OFF, seen: ON }, b),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  // @traces 010-FR-004
  it('keeps one voice on when two admins switch off the last two at once', async () => {
    await prisma.copyVoiceSetting.updateMany({
      data: { enabled: false },
      where: { voice: { lt: 4 } },
    });
    const a = bearer(await account('Cont admin A', ['admin']), 'admin');
    const b = bearer(await account('Cont admin B', ['admin']), 'admin');

    const results = await Promise.all([
      change(4, { ...OFF, seen: ON }, a),
      change(5, { ...OFF, seen: ON }, b),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect((await stored()).filter((v) => v.enabled)).toHaveLength(1);
  });

  // @traces 010-FR-006
  it('leaves one pin when two admins pin different voices at once', async () => {
    const a = bearer(await account('Cont admin A', ['admin']), 'admin');
    const b = bearer(await account('Cont admin B', ['admin']), 'admin');

    const results = await Promise.all([
      change(1, { ...PINNED, seen: ON }, a),
      change(2, { ...PINNED, seen: ON }, b),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await stored()).filter((v) => v.pinned)).toHaveLength(1);
  });
});

describe('what a change writes', () => {
  // @traces 010-FR-008
  it('writes one audit entry per field-changing voice and one event', async () => {
    const admin = await account('Cont admin audit', ['admin']);
    const events0 = await events();

    const res = await change(4, { ...OFF, seen: ON }, bearer(admin, 'admin'));

    expect(res.status).toBe(200);
    expect(await entriesFor(admin)).toBeGreaterThanOrEqual(1);
    expect(await events()).toBe(events0 + 1);
  });

  // @traces 010-FR-008
  it('writes nothing for a refused change', async () => {
    const admin = await account('Cont admin refused', ['admin']);
    const events0 = await events();

    const res = await change(2, { ...ON, seen: OFF }, bearer(admin, 'admin'));

    expect(res.status).toBe(409);
    expect(await entriesFor(admin)).toBe(0);
    expect(await events()).toBe(events0);
  });

  // @traces 010-FR-003
  it('records who changed a voice on the admin read', async () => {
    const auth = await as('admin');
    await change(4, { ...OFF, seen: ON }, auth);

    const res = await list(auth);

    expect(res.body.voices[3].updatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(res.body.voices[3].updatedAt))).toBe(false);
    expect(res.body.voices[0].updatedAt).toBeNull();
  });
});

describe('the public read', () => {
  // @traces 010-FR-009
  it('carries only enabled and pinned after a change by an admin', async () => {
    const auth = await as('admin');
    await change(4, { ...OFF, seen: ON }, auth);
    await change(2, { ...PINNED, seen: ON }, auth);

    const res = await publicRead();

    expect(Object.keys(res.body).sort()).toEqual(['enabled', 'pinned']);
    expect(res.body).toEqual({ enabled: [1, 2, 3, 5], pinned: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/updated|admin|Cont/);
  });

  // @traces 010-FR-009
  it('is open to a visitor with no token and with a broken one', async () => {
    const plain = await publicRead();
    const broken = await publicRead().set('Authorization', 'Bearer nonsense');

    expect(plain.status).toBe(200);
    expect(broken.status).toBe(200);
  });

  // @traces 010-FR-009
  it.each(['?at=', '?at=garbage', '?at=1&at=2', '?other=1'])(
    'ignores the query %s',
    async (query) => {
      const res = await publicRead(query);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: [1, 2, 3, 4, 5], pinned: null });
    },
  );

  // @traces 010-FR-009
  it('lists the enabled voices in ascending order', async () => {
    await prisma.copyVoiceSetting.updateMany({
      data: { enabled: false },
      where: { voice: { in: [1, 3] } },
    });

    expect((await publicRead()).body.enabled).toEqual([2, 4, 5]);
  });
});

describe('a caller who is not signed in', () => {
  // @traces 010-FR-002
  it('gets no settings from the admin read', async () => {
    const res = await list();

    expect([401, 404]).toContain(res.status);
    expect(res.body.voices).toBeUndefined();
  });

  // @traces 010-FR-003
  it('changes nothing with the admin change', async () => {
    const res = await change(2, { ...OFF, seen: ON });

    expect([401, 404]).toContain(res.status);
    expect((await stored())[1]).toEqual({ ...ON, voice: 2 });
  });

  // @traces 010-FR-003
  it('is refused with a token for an account that does not exist', async () => {
    const res = await change(
      2,
      { ...OFF, seen: ON },
      bearer('00000000-0000-4000-8000-000000000000', 'admin'),
    );

    expect([401, 404]).toContain(res.status);
    expect((await stored())[1]).toEqual({ ...ON, voice: 2 });
  });
});
