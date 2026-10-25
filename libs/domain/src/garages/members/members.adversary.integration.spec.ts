import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { BrevoMock } from '../../notifications/brevo/brevo-mock.testing';
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

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: NestExpressApplication;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
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
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(() => reset());

const DAY = 86_400_000;

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const get = (path: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(path);
  return auth ? call.set('Authorization', auth) : call;
};

async function garage(name: string) {
  const g = await prisma.garage.create({
    data: { name, slug: `${name}-${randomUUID()}` },
  });
  const owner = await account(`${name} owner`, ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: g.id, role: 'owner' },
  });
  return { garage: g, owner };
}

async function staff(garageId: string) {
  const desk = await account('desk', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: desk, garageId, role: 'receptionist' },
  });
  const fixer = await account('fixer', ['mechanic']);
  await prisma.mechanic.create({
    data: {
      accountId: fixer,
      canAnswerQuotes: true,
      canMoveBookings: true,
      canRecordFinalPrice: true,
      garageId,
      name: 'Fixer',
    },
  });
  return { desk, fixer };
}

// @traces 102-FR-012
describe('the members read under hostile callers', () => {
  it('answers 403 to a mechanic holding every permission and to a receptionist', async () => {
    const a = await garage('Dinamo');
    const s = await staff(a.garage.id);

    const mechanic = await get(
      `/garages/${a.garage.id}/members`,
      bearer(s.fixer, 'mechanic'),
    );
    const desk = await get(
      `/garages/${a.garage.id}/members`,
      bearer(s.desk, 'receptionist'),
    );

    expect([mechanic.status, mechanic.body.code]).toEqual([403, 'forbidden']);
    expect([desk.status, desk.body.code]).toEqual([403, 'forbidden']);
  });

  it('answers 404 to the staff of another garage, never 403', async () => {
    const a = await garage('Dinamo');
    const b = await garage('Nord');
    const s = await staff(b.garage.id);

    for (const [id, role] of [
      [s.desk, 'receptionist'],
      [s.fixer, 'mechanic'],
      [b.owner, 'garage'],
    ] as const) {
      const res = await get(
        `/garages/${a.garage.id}/members`,
        bearer(id, role),
      );
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
  });

  it('answers 404 to a mechanic whose card was removed', async () => {
    const a = await garage('Dinamo');
    const s = await staff(a.garage.id);
    await prisma.mechanic.updateMany({
      data: { removedAt: new Date() },
      where: { accountId: s.fixer },
    });

    const res = await get(
      `/garages/${a.garage.id}/members`,
      bearer(s.fixer, 'mechanic'),
    );

    expect(res.status).toBe(404);
  });

  it('answers 404 to a former owner whose membership row is gone', async () => {
    const a = await garage('Dinamo');
    await prisma.garageMember.deleteMany({ where: { accountId: a.owner } });

    const res = await get(
      `/garages/${a.garage.id}/members`,
      bearer(a.owner, 'garage'),
    );

    expect(res.status).toBe(404);
  });

  it('answers 404 to an owner who signs in with a driver token', async () => {
    const g = await prisma.garage.create({
      data: { name: 'Dinamo', slug: `dinamo-${randomUUID()}` },
    });
    // An owner who also drives: the driver token is a role she holds.
    const owner = await account('both', ['driver', 'garage']);
    await prisma.garageMember.create({
      data: { accountId: owner, garageId: g.id, role: 'owner' },
    });

    const res = await get(`/garages/${g.id}/members`, bearer(owner, 'driver'));

    expect(res.status).toBe(404);
  });

  it.each([
    ['an empty segment', ''],
    ['a number', '12345'],
    ['a sql fragment', "x'%20OR%201=1--"],
    ['a uuid with a suffix', `${randomUUID()}x`],
    ['a path traversal', '..%2F..%2Fme'],
  ])('answers 400 for %s as the garage id', async (_, id) => {
    const a = await garage('Dinamo');

    const res = await get(`/garages/${id}/members`, bearer(a.owner, 'garage'));

    expect(res.status).toBe(id === '' ? 404 : 400);
  });

  it('answers 401 for a forged and for a malformed bearer token', async () => {
    const a = await garage('Dinamo');
    const forged = `Bearer ${signAccessToken({ accountId: a.owner, role: 'garage' }, 'wrong-secret')}`;

    for (const auth of [forged, 'Bearer not-a-token', 'Bearer ', 'Basic abc']) {
      const res = await get(`/garages/${a.garage.id}/members`, auth);
      expect([auth, res.status]).toEqual([auth, 401]);
    }
  });
});

// @traces 102-FR-011
describe('the members read data edge cases', () => {
  it('answers a lone owner with an empty invites list', async () => {
    const a = await garage('Dinamo');

    const res = await get(
      `/garages/${a.garage.id}/members`,
      bearer(a.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([]);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({
      permissions: null,
      role: 'owner',
    });
  });

  it('returns names and e-mails verbatim as data, markup and unicode included', async () => {
    const a = await garage('Dinamo');
    await prisma.staffInvite.create({
      data: {
        email: 'x+<script>@example.test',
        expiresAt: new Date(Date.now() + DAY),
        garageId: a.garage.id,
        kind: 'receptionist',
        name: '<img src=x onerror=alert(1)> Ștefan Țânțar',
        tokenHash: randomUUID(),
      },
    });

    const res = await get(
      `/garages/${a.garage.id}/members`,
      bearer(a.owner, 'garage'),
    );

    expect(res.body.invites[0]).toMatchObject({
      email: 'x+<script>@example.test',
    });
  });

  it('lists an invite that expires a minute from now and drops one that expired a second ago', async () => {
    const a = await garage('Dinamo');
    for (const [email, offset] of [
      ['soon@example.test', 60_000],
      ['past@example.test', -1000],
    ] as const)
      await prisma.staffInvite.create({
        data: {
          email,
          expiresAt: new Date(Date.now() + offset),
          garageId: a.garage.id,
          kind: 'mechanic',
          name: 'N',
          tokenHash: randomUUID(),
        },
      });

    const res = await get(
      `/garages/${a.garage.id}/members`,
      bearer(a.owner, 'garage'),
    );

    expect(res.body.invites.map((i: { email: string }) => i.email)).toEqual([
      'soon@example.test',
    ]);
  });

  it('answers the same body twice and leaves other garages’ invites out', async () => {
    const a = await garage('Dinamo');
    const b = await garage('Nord');
    await prisma.staffInvite.create({
      data: {
        email: 'nord@example.test',
        expiresAt: new Date(Date.now() + DAY),
        garageId: b.garage.id,
        kind: 'mechanic',
        name: 'N',
        tokenHash: randomUUID(),
      },
    });
    const call = () =>
      get(`/garages/${a.garage.id}/members`, bearer(a.owner, 'garage'));

    const [one, two] = [await call(), await call()];

    expect(two.body).toEqual(one.body);
    expect(one.body.invites).toEqual([]);
  });

  it('lists three hundred mechanics in one answer in Romanian name order', async () => {
    const a = await garage('Dinamo');
    const names = Array.from(
      { length: 300 },
      (_, i) => `M${String(i).padStart(3, '0')}`,
    );
    for (const name of names) {
      const id = await account(name, ['mechanic']);
      await prisma.mechanic.create({
        data: { accountId: id, garageId: a.garage.id, name },
      });
    }

    const res = await get(
      `/garages/${a.garage.id}/members`,
      bearer(a.owner, 'garage'),
    );

    expect(
      res.body.members.slice(1).map((m: { name: string }) => m.name),
    ).toEqual(names);
  }, 60_000);
});

// @traces 102-FR-007
describe('staff 403 versus cross-garage 404 on garage routes', () => {
  it.each(['prices', 'profile'])(
    'answers a driver and an admin 404 on /%s',
    async (route) => {
      const a = await garage('Dinamo');
      const driver = await account('d', ['driver']);
      const admin = await account('a', ['admin']);

      for (const [id, role] of [
        [driver, 'driver'],
        [admin, 'admin'],
      ] as const) {
        const res = await get(
          `/garages/${a.garage.id}/${route}`,
          bearer(id, role),
        );
        expect([route, role, res.status]).toEqual([route, role, 404]);
      }
    },
  );

  it('answers a receptionist 403 on the price list and 200 on the profile', async () => {
    const a = await garage('Dinamo');
    // Drivers see a garage's profile once it is approved, and so does its staff.
    await prisma.garage.update({
      data: { status: 'approved' },
      where: { id: a.garage.id },
    });
    const s = await staff(a.garage.id);
    const auth = bearer(s.desk, 'receptionist');

    const prices = await get(`/garages/${a.garage.id}/prices`, auth);
    const profile = await get(`/garages/${a.garage.id}/profile`, auth);

    expect([prices.status, prices.body.code]).toEqual([403, 'forbidden']);
    expect(profile.status).toBe(200);
  });

  it('answers a mechanic with every permission 403 on the price list and the profile', async () => {
    const a = await garage('Dinamo');
    const s = await staff(a.garage.id);
    const auth = bearer(s.fixer, 'mechanic');

    for (const route of ['prices', 'profile']) {
      const res = await get(`/garages/${a.garage.id}/${route}`, auth);
      expect([route, res.status, res.body.code]).toEqual([
        route,
        403,
        'forbidden',
      ]);
    }
  });

  it('answers the staff of another garage 404 on the price list and the profile', async () => {
    const a = await garage('Dinamo');
    const b = await garage('Nord');
    const s = await staff(b.garage.id);

    for (const route of ['prices', 'profile'])
      for (const [id, role] of [
        [s.desk, 'receptionist'],
        [s.fixer, 'mechanic'],
      ] as const) {
        const res = await get(
          `/garages/${a.garage.id}/${route}`,
          bearer(id, role),
        );
        expect([route, role, res.status]).toEqual([route, role, 404]);
      }
  });
});
