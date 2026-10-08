import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import { AdminAccountsModule } from './admin-accounts.module';
import { SUMMARY_KEY } from './admin-accounts.service';
import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import type { Role } from '../../auth/capabilities';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';

const redisUrl = redisUrlFor(9);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;
const ROUTES = ['/admin/accounts', '/admin/accounts/summary'];

const redis = new Redis(redisUrl);
let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      AdminAccountsModule,
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
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await redis.del(SUMMARY_KEY);
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const as = async (role: Role, status?: 'suspended') =>
  bearer(await account(`Cont ${role}`, [role], { status }), role);

const get = (path: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(path);
  return auth ? call.set('Authorization', auth) : call;
};

describe('GET /admin/accounts', () => {
  it('answers an admin with the newest accounts and no next page', async () => {
    const auth = await as('admin');
    await account('Andrei', ['driver']);

    const res = await get('/admin/accounts', auth);

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
      'Andrei',
      'Cont admin',
    ]);
    expect(res.body.items[0]).toMatchObject({
      count: { kind: 'age', value: 0 },
      roles: ['driver'],
      status: 'active',
    });
  });

  it('answers 400 invalid_cursor to a cursor that does not decode', async () => {
    const res = await get('/admin/accounts?cursor=%25%25', await as('admin'));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_cursor');
  });

  it('refuses an unknown query parameter', async () => {
    const res = await get('/admin/accounts?email=x', await as('admin'));

    expect(res.status).toBe(400);
  });
});

describe('GET /admin/accounts/summary', () => {
  it('answers an admin with the three totals', async () => {
    const res = await get('/admin/accounts/summary', await as('admin'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      activeDrivers: 0,
      garagesListed: 0,
      mechanics: 0,
    });
  });
});

describe.each(ROUTES)('who may read %s', (path) => {
  // The API's problem filter names a bare 404 not_found.
  it.each(NON_ADMIN)(
    'answers 404 to a %s, with nothing of the list',
    async (role) => {
      const res = await get(path, await as(role));

      expect(res.status).toBe(404);
      expect(res.body.items).toBeUndefined();
      expect(res.body.activeDrivers).toBeUndefined();
    },
  );

  it('answers 401 sign_in_required without a session', async () => {
    const res = await get(path);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 403 account_suspended to a suspended admin', async () => {
    const res = await get(path, await as('admin', 'suspended'));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('account_suspended');
  });
});
