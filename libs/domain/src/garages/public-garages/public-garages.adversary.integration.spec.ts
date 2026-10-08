import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../notifications/notifications.testing';
import { GaragesModule } from '../garages.module';

const redisUrl = redisUrlFor(2);
const { prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

beforeAll(async () => {
  const email = testConfig('http://127.0.0.1:9');
  const auth = AuthModule.register({
    databaseUrl,
    redisUrl,
    tokenSecret: 'test-secret',
  });
  const notifications = NotificationsModule.register(
    { databaseUrl, email, redisUrl },
    auth,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      notifications,
      GaragesModule.register(email, notifications, {
        skipManualApproval: false,
      }),
    ],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => reset());

const read = (path: string) =>
  request(app.getHttpServer()).get(`/garages/${path}`);

describe('reading a garage by slug, hostilely', () => {
  it.each([
    '%E2%9C%93-garaj-%C8%99tefan',
    "x'%20OR%201=1--",
    '%00',
    'a'.repeat(5000),
    '..%2F..%2Fetc%2Fpasswd',
  ])(
    'answers 404 not_found, not a server error, for the slug %s',
    async (slug) => {
      const res = await read(slug);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  it('exposes only id, name, slug and the brand answer of an approved garage', async () => {
    const created = await prisma.garage.create({
      data: {
        name: 'Atelier Ștefan',
        slug: `s-${randomUUID()}`,
        status: 'approved',
      },
    });

    const res = await read(created.slug);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'brandNote',
      'doesNotTake',
      'id',
      'name',
      'refusalPhrase',
      'slug',
      'worksOn',
    ]);
  });

  it('serves a garage suspended after approval as 410, not from a cache', async () => {
    const created = await prisma.garage.create({
      data: { name: 'A', slug: `s-${randomUUID()}`, status: 'approved' },
    });
    expect((await read(created.slug)).status).toBe(200);

    await prisma.garage.update({
      data: { status: 'suspended' },
      where: { id: created.id },
    });

    const res = await read(created.slug);
    expect(res.status).toBe(410);
    expect(res.headers['cache-control'] ?? '').not.toMatch(/max-age=[1-9]/);
  });

  it('does not match a slug by a different letter case', async () => {
    const created = await prisma.garage.create({
      data: { name: 'A', slug: `s-${randomUUID()}`, status: 'approved' },
    });

    expect((await read(created.slug.toUpperCase())).status).toBe(404);
  });
});
