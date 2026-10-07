import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { GaragesModule } from './garages.module';
import { VerificationService } from './verification.service';
import { AuthModule } from '../auth/auth.module';
import { serialDatabase } from '../auth/serial-db.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';

const redisUrl = redisUrlFor(2);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;
let verification: VerificationService;

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
  verification = app.get(VerificationService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => reset());

const read = (slug: string) =>
  request(app.getHttpServer()).get(`/garages/${slug}`);

async function garage(status: 'draft' | 'approved' | 'suspended' = 'draft') {
  return prisma.garage.create({
    data: {
      name: 'Atelier Dinamo',
      slug: `dinamo-${randomUUID()}`,
      status,
    },
  });
}

async function withFile(
  status: 'submitted' | 'in_review' | 'more_requested' | 'rejected',
) {
  const created = await garage();
  await prisma.verificationFile.create({
    data: { garageId: created.id, status },
  });
  return created;
}

describe('reading a garage by its public slug', () => {
  it('returns an approved garage without a session', async () => {
    const approved = await garage('approved');

    const res = await read(approved.slug);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: approved.id,
      name: 'Atelier Dinamo',
      slug: approved.slug,
    });
  });

  it('answers a garage never approved exactly as a slug nobody holds', async () => {
    const unknown = await read(`nobody-${randomUUID()}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('not_found');

    const hidden = [
      await garage('draft'),
      await withFile('submitted'),
      await withFile('in_review'),
      await withFile('more_requested'),
      await withFile('rejected'),
    ];
    for (const { slug } of hidden) {
      const res = await read(slug);

      expect([slug, res.status, res.body]).toEqual([slug, 404, unknown.body]);
    }
  });

  it('answers 410 gone for a suspended garage', async () => {
    const suspended = await garage('suspended');

    const res = await read(suspended.slug);

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('gone');
  });

  it('returns the garage on the read right after its approval commits', async () => {
    const owner = await account('Mihai', ['garage']);
    const admin = await account('Ioana', ['admin']);
    const hidden = await garage();
    const none = {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    };
    const file = await prisma.$transaction((tx) =>
      verification.submit(
        tx,
        {
          accountId: owner,
          garageId: hidden.id,
          permissions: none,
          role: 'garage',
          roles: ['garage'],
        },
        hidden.id,
      ),
    );
    expect((await read(hidden.slug)).status).toBe(404);

    await prisma.$transaction((tx) =>
      verification.decide(
        tx,
        {
          accountId: admin,
          garageId: null,
          permissions: none,
          role: 'admin',
          roles: ['admin'],
        },
        file.id,
        { outcome: 'approved' },
      ),
    );

    const res = await read(hidden.slug);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hidden.id);
  });
});
