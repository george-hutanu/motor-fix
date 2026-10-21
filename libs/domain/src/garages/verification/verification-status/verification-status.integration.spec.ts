import { randomUUID } from 'node:crypto';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../../auth/access-token';
import { AuthModule } from '../../../auth/auth.module';
import type { Role } from '../../../auth/capabilities';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { NotificationsModule } from '../../../notifications/notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../../../notifications/notifications.testing';
import { UNUSED_STORAGE } from '../../../storage/s3-test-store';
import { StorageModule } from '../../../storage/storage.module';
import { GaragesModule } from '../../garages.module';

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: NestExpressApplication;

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
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const read = (garageId: string, as?: string) => {
  const req = request(app.getHttpServer()).get(
    `/garages/${garageId}/verification`,
  );
  return as ? req.set('Authorization', as) : req;
};

const SENT_AT = new Date('2026-10-20T08:30:00.000Z');

// Atelier Dinamo with its owner Radu, a receptionist and a mechanic; Service
// Auto Nord with its owner Mihai; a driver and an admin.
async function world(status: 'draft' | 'approved' | 'suspended' = 'draft') {
  const dinamo = await prisma.garage.create({
    data: {
      name: 'ATELIER DINAMO SRL',
      slug: `dinamo-${randomUUID()}`,
      status,
    },
  });
  const nord = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  });
  const radu = await account('radu', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: radu, garageId: dinamo.id, role: 'owner' },
  });
  const ioana = await account('ioana', ['receptionist']);
  await prisma.garageMember.create({
    data: { accountId: ioana, garageId: dinamo.id, role: 'receptionist' },
  });
  const vlad = await account('vlad', ['mechanic']);
  await prisma.mechanic.create({
    data: { accountId: vlad, garageId: dinamo.id, name: 'Mecanic' },
  });
  const mihai = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: mihai, garageId: nord.id, role: 'owner' },
  });
  const sofer = await account('sofer', ['driver']);
  const ana = await account('ana', ['admin']);
  return {
    admin: bearer(ana, 'admin'),
    dinamo,
    driver: bearer(sofer, 'driver'),
    mechanic: bearer(vlad, 'mechanic'),
    other: bearer(mihai, 'garage'),
    owner: bearer(radu, 'garage'),
    receptionist: bearer(ioana, 'receptionist'),
  };
}

type FileStatus =
  | 'submitted'
  | 'in_review'
  | 'more_requested'
  | 'rejected'
  | 'approved';

const file = (
  garageId: string,
  status: FileStatus,
  extra: Partial<{
    createdAt: Date;
    reasonCode: string;
    reasonNote: string;
    requestedItems: string[];
  }> = {},
) =>
  prisma.verificationFile.create({
    data: { garageId, status, submittedAt: SENT_AT, ...extra },
  });

// @traces 116-FR-014
describe('the verification status, for the owner', () => {
  it('reads draft, with nothing sent, for a garage with no file', async () => {
    const w = await world();

    const res = await read(w.dinamo.id, w.owner);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reason: null,
      requestedItems: [],
      status: 'draft',
      submittedAt: null,
    });
  });

  it.each([
    ['submitted', 'submitted'],
    ['in_review', 'in_review'],
  ] as const)(
    'reads a %s file as %s, with its sending',
    async (fileStatus, status) => {
      const w = await world();
      await file(w.dinamo.id, fileStatus);

      const res = await read(w.dinamo.id, w.owner);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        reason: null,
        requestedItems: [],
        status,
        submittedAt: SENT_AT.toISOString(),
      });
    },
  );

  it('lists what a request for more asks for', async () => {
    const w = await world();
    await file(w.dinamo.id, 'more_requested', {
      requestedItems: ['photos', 'rar'],
    });

    const res = await read(w.dinamo.id, w.owner);

    expect(res.body).toMatchObject({
      reason: null,
      requestedItems: ['photos', 'rar'],
      status: 'more_requested',
    });
  });

  it("gives a rejection's reason and note", async () => {
    const w = await world();
    await file(w.dinamo.id, 'rejected', {
      reasonCode: 'documents',
      reasonNote: 'Certificatul nu se citește.',
    });

    const res = await read(w.dinamo.id, w.owner);

    expect(res.body).toMatchObject({
      reason: { code: 'documents', note: 'Certificatul nu se citește.' },
      requestedItems: [],
      status: 'rejected',
    });
  });

  it.each(['approved', 'suspended'] as const)(
    'reads a %s garage as approved',
    async (garageStatus) => {
      const w = await world(garageStatus);
      await file(w.dinamo.id, 'approved');

      const res = await read(w.dinamo.id, w.owner);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        reason: null,
        requestedItems: [],
        status: 'approved',
      });
    },
  );

  it('reads the newest file', async () => {
    const w = await world();
    await file(w.dinamo.id, 'rejected', {
      createdAt: new Date('2026-10-01T08:00:00Z'),
      reasonCode: 'documents',
      reasonNote: 'Vechi',
    });
    await file(w.dinamo.id, 'in_review', {
      createdAt: new Date('2026-10-10T08:00:00Z'),
    });

    const res = await read(w.dinamo.id, w.owner);

    expect(res.body).toMatchObject({ reason: null, status: 'in_review' });
  });
});

// @traces 116-FR-014
describe('who may read the verification status', () => {
  it('answers an admin', async () => {
    const w = await world();
    await file(w.dinamo.id, 'submitted');

    const res = await read(w.dinamo.id, w.admin);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
  });

  it.each(['receptionist', 'mechanic'] as const)(
    'refuses a %s of the garage',
    async (who) => {
      const w = await world();
      await file(w.dinamo.id, 'submitted');

      const res = await read(w.dinamo.id, w[who]);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    },
  );

  it.each(['driver', 'other'] as const)(
    'tells a %s nothing of the garage',
    async (who) => {
      const w = await world();
      await file(w.dinamo.id, 'submitted');

      const res = await read(w.dinamo.id, w[who]);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
      expect(JSON.stringify(res.body)).not.toContain('submitted');
    },
  );

  it.each([
    ['an unknown garage', () => randomUUID()],
    ['an id that is not a uuid', () => 'dinamo'],
  ])('answers an admin 404 for %s', async (_, id) => {
    const w = await world();

    const res = await read(id(), w.admin);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('asks for a session', async () => {
    const w = await world();

    expect((await read(w.dinamo.id)).status).toBe(401);
  });
});
