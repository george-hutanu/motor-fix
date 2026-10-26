import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { DashboardLayoutsModule } from './dashboard-layouts.module';
import { outboxMark } from '../../events/outbox.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { signAccessToken } from '../access-token';
import { AuthModule } from '../auth.module';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(15);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let mark: bigint;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      DashboardLayoutsModule,
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
  mark = await outboxMark(prisma);
});

const http = () => request(app.getHttpServer());
const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;
const path = (role: string) => `/me/dashboard-layouts/${role}`;

const read = (auth: string | null, role = 'admin') => {
  const req = http().get(path(role));
  return auth ? req.set('Authorization', auth) : req;
};
const save = (auth: string | null, body: unknown, role = 'admin') => {
  const req = http().put(path(role));
  if (auth) req.set('Authorization', auth);
  return req.send(body as object);
};
const resetLayout = (auth: string | null, role = 'admin') => {
  const req = http().delete(path(role));
  return auth ? req.set('Authorization', auth) : req;
};

async function admin(roles: Role[] = ['admin']) {
  const id = await account(`admin${randomUUID().slice(0, 8)}`, roles);
  return { auth: bearer(id, 'admin'), id };
}

const events = () =>
  prisma.outboxEvent.findMany({
    where: { id: { gt: mark }, kind: 'dashboard_layout.updated' },
  });
const stored = (accountId: string) =>
  prisma.dashboardLayout.findMany({ where: { accountId } });

const DEFAULT = ['numbers', 'verification', 'growth', 'demand', 'log'].map(
  (key) => ({ key, visible: true }),
);
const MINE = [
  { key: 'log', visible: false },
  { key: 'numbers', visible: true },
];
const MINE_MERGED = [
  ...MINE,
  { key: 'verification', visible: true },
  { key: 'growth', visible: true },
  { key: 'demand', visible: true },
];

// @traces 1263-admin-dashboard-customise-FR-003
describe('reading a layout', () => {
  it('answers the default with nothing saved', async () => {
    const { auth } = await admin();
    const res = await read(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      panels: DEFAULT,
      role: 'admin',
      updatedAt: null,
    });
  });
});

// @traces 1263-admin-dashboard-customise-FR-001
// @traces 1263-admin-dashboard-customise-FR-004
// @traces 1263-admin-dashboard-customise-FR-009
describe('saving a layout', () => {
  it('answers the merged layout and gives it back to a second session', async () => {
    const { auth, id } = await admin();
    const res = await save(auth, { panels: MINE });

    expect(res.status).toBe(200);
    expect(res.body.panels).toEqual(MINE_MERGED);
    expect(new Date(res.body.updatedAt).toISOString()).toBe(res.body.updatedAt);

    const other = `Bearer ${signAccessToken({ accountId: id, role: 'admin' }, tokenSecret)}`;
    const back = await read(other);
    expect(back.body).toEqual(res.body);
  });

  it('keeps one record per account and role, with no garage', async () => {
    const { auth, id } = await admin();
    await save(auth, { panels: MINE });
    await save(auth, { panels: DEFAULT });

    const rows = await stored(id);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'accountId',
      'panels',
      'role',
      'updatedAt',
    ]);
  });

  it('answers the later of two saves, never a merge of both', async () => {
    const { auth } = await admin();
    await save(auth, { panels: [{ key: 'growth', visible: false }] });
    await save(auth, { panels: MINE });

    expect((await read(auth)).body.panels).toEqual(MINE_MERGED);
  });

  it('never answers another account its layout', async () => {
    const mine = await admin();
    const theirs = await admin();
    await save(mine.auth, { panels: MINE });

    expect((await read(theirs.auth)).body).toEqual({
      panels: DEFAULT,
      role: 'admin',
      updatedAt: null,
    });
  });

  // The API's problem filter names a refused shape validation_failed too
  // (apps/api/src/problem.filter.ts); this module answers it bare.
  it.each([
    ['an unknown key', { panels: [{ key: 'reported', visible: true }] }, true],
    [
      'a key in another case',
      { panels: [{ key: 'Log', visible: true }] },
      true,
    ],
    [
      'a key listed twice',
      {
        panels: [
          { key: 'log', visible: true },
          { key: 'log', visible: false },
        ],
      },
      true,
    ],
    ['a missing visible', { panels: [{ key: 'log' }] }, false],
    [
      'a visible that is not a boolean',
      { panels: [{ key: 'log', visible: 'no' }] },
      false,
    ],
    ['panels that are not a list', { panels: 'log' }, false],
    ['no panels', {}, false],
    ['an extra field', { panels: [], role: 'driver' }, false],
    [
      'more than twenty panels',
      {
        panels: Array.from({ length: 21 }, () => ({
          key: 'log',
          visible: true,
        })),
      },
      false,
    ],
    [
      'a key longer than forty characters',
      { panels: [{ key: 'x'.repeat(41), visible: true }] },
      false,
    ],
  ])('refuses %s and writes nothing', async (_, body, coded) => {
    const { auth, id } = await admin();
    await save(auth, { panels: MINE });
    const before = await stored(id);
    mark = await outboxMark(prisma);

    const res = await save(auth, body);

    expect(res.status).toBe(400);
    if (coded) expect(res.body.code).toBe('validation_failed');
    expect(await stored(id)).toEqual(before);
    expect(await events()).toHaveLength(0);
  });
});

// @traces 1263-admin-dashboard-customise-FR-005
describe('resetting a layout', () => {
  it('removes the record and answers the default', async () => {
    const { auth, id } = await admin();
    await save(auth, { panels: MINE });
    const res = await resetLayout(auth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      panels: DEFAULT,
      role: 'admin',
      updatedAt: null,
    });
    expect(await stored(id)).toEqual([]);
    expect((await read(auth)).body.updatedAt).toBeNull();
  });

  it('answers the default with nothing saved', async () => {
    const { auth } = await admin();
    const res = await resetLayout(auth);

    expect([res.status, res.body.updatedAt]).toEqual([200, null]);
  });
});

// @traces 1263-admin-dashboard-customise-FR-007
describe('the layout event', () => {
  it('is written by a save to the account only', async () => {
    const { auth, id } = await admin();
    await save(auth, { panels: MINE });

    const written = await events();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      audience: [`account:${id}`],
      payload: { accountId: id, role: 'admin' },
      subjectId: id,
    });
  });

  it('is written by a reset too', async () => {
    const { auth } = await admin();
    await resetLayout(auth);

    expect(await events()).toHaveLength(1);
  });
});

// @traces 1263-admin-dashboard-customise-FR-006
describe('who may reach a layout', () => {
  it.each(['driver', 'garage', 'mechanic', 'nobody'])(
    'answers 404 for the %s role',
    async (role) => {
      const { auth } = await admin(['admin', 'driver', 'garage']);

      for (const res of [
        await read(auth, role),
        await save(auth, { panels: [] }, role),
        await resetLayout(auth, role),
      ]) {
        expect([res.status, res.body.code]).toEqual([404, 'not_found']);
      }
    },
  );

  it('answers 404 for admin to an account that is not one', async () => {
    const id = await account(`sofer${randomUUID().slice(0, 8)}`, ['driver']);
    const auth = bearer(id, 'driver');

    for (const res of [
      await read(auth),
      await save(auth, { panels: MINE }),
      await resetLayout(auth),
    ]) {
      expect([res.status, res.body.code]).toEqual([404, 'not_found']);
    }
    expect(await stored(id)).toEqual([]);
  });

  it('answers 401 without a session', async () => {
    for (const res of [
      await read(null),
      await save(null, { panels: MINE }),
      await resetLayout(null),
    ]) {
      expect([res.status, res.body.code]).toEqual([401, 'sign_in_required']);
    }
  });

  it('answers 403 to a suspended account whatever the role', async () => {
    const id = await account(`gone${randomUUID().slice(0, 8)}`, ['admin'], {
      status: 'suspended',
    });
    const auth = bearer(id, 'admin');

    for (const res of [await read(auth), await read(auth, 'driver')]) {
      expect([res.status, res.body.code]).toEqual([403, 'account_suspended']);
    }
  });
});
