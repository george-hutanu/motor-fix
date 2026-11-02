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
  cityName: string | null = 'Cluj-Napoca',
) =>
  prisma.garage.create({
    data: {
      cityKey: cityName?.toLowerCase(),
      cityName,
      name,
      slug: `garage-${randomUUID()}`,
      status,
    },
  });

const driver = async () => bearer(await account('Andrei Ion Marin'), 'driver');
const names = (res: { body: { items: { name: string }[] } }) =>
  res.body.items.map((g) => g.name);

describe('the garage picker search', () => {
  it('lists only approved garages, each with its id, name and city alone', async () => {
    const approved = await garage('Service Popescu');
    await garage('Popescu Draft', 'draft');
    await garage('Popescu Suspendat', 'suspended');
    await garage('Popescu fără oraș', 'approved', null);

    const res = await pick('q=popescu', await driver());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { city: null, id: expect.any(String), name: 'Popescu fără oraș' },
        { city: 'Cluj-Napoca', id: approved.id, name: 'Service Popescu' },
      ],
    });
  });

  it('matches anywhere in the name, ignoring case', async () => {
    await garage('AUTO NORD');
    await garage('Service Nordic');
    await garage('Garaj Sud');
    expect(names(await pick('q=NoRd', await driver()))).toEqual([
      'AUTO NORD',
      'Service Nordic',
    ]);
  });

  it('orders by name, then id', async () => {
    const a = await garage('Garaj');
    const b = await garage('Garaj');
    await garage('Atelier Garaj');
    const res = await pick('q=garaj', await driver());
    const [first, second] = [a.id, b.id].sort();
    expect(res.body.items.map((g: { id: string }) => g.id).slice(1)).toEqual([
      first,
      second,
    ]);
    expect(names(res)[0]).toBe('Atelier Garaj');
  });

  it('answers eight at most by default, and the limit asked between 1 and 8', async () => {
    for (let i = 0; i < 9; i += 1) await garage(`Service ${i}`);
    const auth = await driver();
    expect((await pick('q=service', auth)).body.items).toHaveLength(8);
    expect((await pick('q=service&limit=1', auth)).body.items).toHaveLength(1);
    expect((await pick('q=service&limit=8', auth)).body.items).toHaveLength(8);
  });

  it.each([
    'q=service&limit=0',
    'q=service&limit=9',
    'q=service&limit=two',
    'q=s',
    `q=${'s'.repeat(81)}`,
    'limit=3',
  ])('refuses %s', async (query) => {
    expect((await pick(query, await driver())).status).toBe(400);
  });

  it.each(['q=se', `q=${'s'.repeat(80)}`])('takes %s', async (query) => {
    expect((await pick(query, await driver())).status).toBe(200);
  });

  it('reads % and _ literally', async () => {
    await garage('Reduceri 100% Auto');
    await garage('Reduceri 100 Auto');
    await garage('auto_service');
    await garage('autoXservice');
    const auth = await driver();
    expect(names(await pick('q=0%25', auth))).toEqual(['Reduceri 100% Auto']);
    expect(names(await pick('q=o_s', auth))).toEqual(['auto_service']);
  });

  it('asks a visitor to sign in', async () => {
    const res = await pick('q=service');
    expect(res.status).toBe(401);
  });

  it.each(['garage', 'receptionist', 'mechanic', 'admin'] as Role[])(
    'answers 404 to the %s role',
    async (role) => {
      const id = await account(`Other ${role}`, [role]);
      expect((await pick('q=service', bearer(id, role))).status).toBe(404);
    },
  );

  it('answers within a second over many garages', async () => {
    await prisma.garage.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({
        name: `Service ${i}`,
        slug: `garage-${randomUUID()}`,
        status: 'approved' as const,
      })),
    });
    const auth = await driver();
    const started = performance.now();
    const res = await pick('q=service%204', auth);
    expect(res.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
