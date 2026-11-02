import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
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

// @traces 062-FR-009 062-FR-012

const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const redisUrl = redisUrlFor(2);
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

beforeEach(() => reset());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const pick = (query: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(`/garages?${query}`);
  return auth ? call.set('Authorization', auth) : call;
};

const garage = (
  name: string,
  status: 'draft' | 'approved' | 'suspended' = 'approved',
) =>
  prisma.garage.create({
    data: {
      cityKey: 'cluj-napoca',
      cityName: 'Cluj-Napoca',
      name,
      slug: `garage-${randomUUID()}`,
      status,
    },
  });

const driver = async () => bearer(await account('Andrei Ion Marin'), 'driver');
const names = (res: { body: { items: { name: string }[] } }) =>
  res.body.items.map((g) => g.name);

describe('the q parameter', () => {
  it('reads a backslash literally', async () => {
    await garage('Auto\\Nord');
    await garage('AutoNord');
    await garage('Auto/Nord');
    expect(names(await pick('q=o%5CN', await driver()))).toEqual([
      'Auto\\Nord',
    ]);
  });

  it('reads a trailing backslash as a character, not an escape', async () => {
    await garage('Nord\\');
    await garage('Nord Auto');
    expect(names(await pick('q=rd%5C', await driver()))).toEqual(['Nord\\']);
  });

  it('reads two percent signs as two characters', async () => {
    await garage('Mega%% Auto');
    await garage('Mega% Auto');
    expect(names(await pick('q=%25%25', await driver()))).toEqual([
      'Mega%% Auto',
    ]);
  });

  it('matches nothing, not everything, for a lone wildcard pair', async () => {
    await garage('Service Unu');
    const auth = await driver();
    expect((await pick('q=%25%25', auth)).body.items).toEqual([]);
    expect((await pick('q=__', auth)).body.items).toEqual([]);
  });

  it('trims the text before measuring it', async () => {
    await garage('Nord Auto');
    const auth = await driver();
    expect(names(await pick('q=%20%20nord%20%20', auth))).toEqual([
      'Nord Auto',
    ]);
    expect((await pick('q=%20a%20', auth)).status).toBe(400);
    expect((await pick('q=%20%20%20%20', auth)).status).toBe(400);
    expect((await pick(`q=${'a'.repeat(80)}%20%20%20`, auth)).status).toBe(200);
    expect((await pick(`q=%20%20${'a'.repeat(81)}`, auth)).status).toBe(400);
  });

  it('counts an emoji pair as one character', async () => {
    const auth = await driver();
    expect((await pick(`q=${encodeURIComponent('🔧')}`, auth)).status).toBe(
      400,
    );
    expect(
      (await pick(`q=${encodeURIComponent('🔧'.repeat(80))}`, auth)).status,
    ).toBe(200);
    expect(
      (await pick(`q=${encodeURIComponent('🔧'.repeat(81))}`, auth)).status,
    ).toBe(400);
  });

  it('refuses q sent twice', async () => {
    expect((await pick('q=ab&q=cd', await driver())).status).toBe(400);
  });

  it('answers 400 or an empty list, never 500, to a NUL byte', async () => {
    const res = await pick('q=ab%00cd', await driver());
    expect([200, 400]).toContain(res.status);
  });

  it('keeps an SQL fragment as text and leaves the garages alone', async () => {
    await garage('Nord Auto');
    const auth = await driver();
    const res = await pick(
      `q=${encodeURIComponent("'; DROP TABLE garage; --")}`,
      auth,
    );
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(names(await pick('q=nord', auth))).toEqual(['Nord Auto']);
  });

  it('does not fold diacritics', async () => {
    await garage('Șerban Auto');
    const auth = await driver();
    expect((await pick('q=serban', auth)).body.items).toEqual([]);
    expect(
      names(await pick(`q=${encodeURIComponent('șerban')}`, auth)),
    ).toEqual(['Șerban Auto']);
  });

  it('ignores the case of a Romanian capital', async () => {
    await garage('ȘERBAN AUTO');
    await garage('ĂSTA Service');
    const auth = await driver();
    expect(
      names(await pick(`q=${encodeURIComponent('șerban')}`, auth)),
    ).toEqual(['ȘERBAN AUTO']);
    expect(names(await pick(`q=${encodeURIComponent('ăsta')}`, auth))).toEqual([
      'ĂSTA Service',
    ]);
  });
});

describe('the limit parameter', () => {
  it.each([
    'limit=1.5',
    'limit=-1',
    'limit=',
    'limit=8abc',
    'limit=NaN',
    'limit=Infinity',
    'limit=1&limit=2',
    'limit=%5B1%5D',
  ])('refuses %s', async (limit) => {
    expect((await pick(`q=service&${limit}`, await driver())).status).toBe(400);
  });

  it('refuses a parameter the route does not take', async () => {
    const res = await pick('q=service&status=draft', await driver());
    expect(res.status).toBe(400);
  });

  it('never leaks a draft or suspended garage whatever the limit', async () => {
    await garage('Nord Draft', 'draft');
    await garage('Nord Suspendat', 'suspended');
    const res = await pick('q=nord&limit=8', await driver());
    expect(res.body.items).toEqual([]);
  });

  it('answers the first by name when the limit is one', async () => {
    await garage('Nord B');
    await garage('Nord A');
    expect(names(await pick('q=nord&limit=1', await driver()))).toEqual([
      'Nord A',
    ]);
  });
});

describe('the session', () => {
  it('answers 401 to a token that is not valid', async () => {
    const res = await pick('q=nord', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('answers 401 before it validates the query', async () => {
    expect((await pick('q=')).status).toBe(401);
  });

  it('answers 404 to a non-driver role before it validates the query', async () => {
    const id = await account('Garage Owner', ['garage']);
    expect((await pick('q=', bearer(id, 'garage'))).status).toBe(404);
  });

  it('is not cached by a shared cache', async () => {
    const res = await pick('q=nord', await driver());
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public|s-maxage/);
  });

  it('answers the same list twice', async () => {
    await garage('Nord A');
    await garage('Nord B');
    const auth = await driver();
    expect((await pick('q=nord', auth)).body).toEqual(
      (await pick('q=nord', auth)).body,
    );
  });
});
