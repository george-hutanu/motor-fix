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
    `/garages/${garageId}/legal-check`,
  );
  return as ? req.set('Authorization', as) : req;
};

const APPROVED_ON = '2026-10-01';

// Atelier Dinamo, approved on 1 October 2026, with its owner Radu, a
// receptionist and a mechanic; Service Auto Nord with its owner Mihai.
async function world(
  garage: Partial<{
    status: 'draft' | 'approved' | 'suspended';
    businessKind: 'company' | 'mobile';
  }> = {},
) {
  await prisma.rarActivity.upsert({
    create: { code: 'brakes', nameEn: 'brakes', nameRo: 'frâne' },
    update: {},
    where: { code: 'brakes' },
  });
  const dinamo = await prisma.garage.create({
    data: {
      approvedAt: new Date(`${APPROVED_ON}T09:00:00Z`),
      businessKind: garage.businessKind ?? 'company',
      lastCheckedOn: new Date(APPROVED_ON),
      name: 'ATELIER DINAMO SRL',
      rarActivities: ['brakes'],
      slug: `dinamo-${randomUUID()}`,
      status: garage.status ?? 'approved',
    },
  });
  const nord = await prisma.garage.create({
    data: {
      name: 'Service Auto Nord',
      slug: `nord-${randomUUID()}`,
      status: 'approved',
    },
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

type World = Awaited<ReturnType<typeof world>>;

async function file(
  w: World,
  results: Partial<Record<'company' | 'caen' | 'rar', string>> = {},
  createdAt = new Date('2026-09-28T08:00:00Z'),
) {
  const created = await prisma.verificationFile.create({
    data: {
      createdAt,
      decidedAt: new Date(`${APPROVED_ON}T09:00:00Z`),
      garageId: w.dinamo.id,
      reasonNote: 'Notă internă a adminului',
      status: 'approved',
    },
  });
  for (const kind of ['company', 'caen', 'rar'] as const) {
    const result = results[kind] ?? 'ok';
    await prisma.verificationCheck.create({
      data: {
        detail: result === 'ok' ? 'în regulă' : `detaliu ${kind}`,
        evidence: { secret: 'evidence' },
        fileId: created.id,
        kind,
        recordedAt:
          result === 'not_run' ? null : new Date('2026-09-30T21:30:00Z'),
        result: result as 'ok',
      },
    });
  }
  for (const kind of ['onrc_certificate', 'rar_authorisation']) {
    await prisma.legalDocument.create({
      data: {
        kind,
        pages: [`legal_document/${created.id}/${kind}`],
        verificationFileId: created.id,
      },
    });
  }
  return created;
}

// @traces 210-FR-001
// @traces 210-FR-003
describe('the legal check, for the owner', () => {
  it('answers the four rows of an approved garage, in order', async () => {
    const w = await world();
    await file(w);

    const res = await read(w.dinamo.id, w.owner);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      companyName: 'ATELIER DINAMO SRL',
      isMobile: false,
      lastCheckedOn: APPROVED_ON,
      rarActivities: [{ code: 'brakes', nameEn: 'brakes', nameRo: 'frâne' }],
      rows: [
        {
          checkedOn: APPROVED_ON,
          detail: null,
          kind: 'company',
          missing: [],
          state: 'ok',
        },
        {
          checkedOn: APPROVED_ON,
          detail: null,
          kind: 'caen',
          missing: [],
          state: 'ok',
        },
        {
          checkedOn: APPROVED_ON,
          detail: null,
          kind: 'rar',
          missing: [],
          state: 'ok',
        },
        {
          checkedOn: APPROVED_ON,
          detail: null,
          kind: 'documents',
          missing: [],
          state: 'ok',
        },
      ],
    });
  });

  it('says a mobile mechanic is one', async () => {
    const w = await world({ businessKind: 'mobile' });
    await file(w);

    const res = await read(w.dinamo.id, w.owner);

    expect(res.body.isMobile).toBe(true);
  });

  it("shows a warning's own detail and never the admin's note or evidence", async () => {
    const w = await world();
    await file(w, { caen: 'warning' });

    const res = await read(w.dinamo.id, w.owner);

    expect(res.body.rows[1]).toMatchObject({
      detail: 'detaliu caen',
      state: 'warning',
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('Notă internă');
    expect(body).not.toContain('evidence');
    expect(body).not.toContain('legal_document/');
  });
});

// @traces 210-FR-002
describe('which file it reads', () => {
  it('reads the newest file, even one reopened since its approval', async () => {
    const w = await world();
    await file(w, {}, new Date('2026-01-01T08:00:00Z'));
    const newest = await file(w, { rar: 'failed' });
    await prisma.verificationFile.update({
      data: { status: 'in_review' },
      where: { id: newest.id },
    });

    const res = await read(w.dinamo.id, w.owner);

    expect(res.status).toBe(200);
    expect(res.body.rows[2]).toMatchObject({ state: 'failed' });
  });

  it.each(['draft', 'suspended'] as const)(
    'has no answer while the garage is %s',
    async (status) => {
      const w = await world({ status });
      await file(w);

      expect((await read(w.dinamo.id, w.owner)).status).toBe(404);
    },
  );

  it('has no answer for an approved garage with no file', async () => {
    const w = await world();

    expect((await read(w.dinamo.id, w.owner)).status).toBe(404);
  });
});

// @traces 210-FR-009
describe('the last check day', () => {
  it('is read, never written', async () => {
    const w = await world();
    await file(w);

    await read(w.dinamo.id, w.owner);

    const after = await prisma.garage.findUniqueOrThrow({
      where: { id: w.dinamo.id },
    });
    expect(after.lastCheckedOn?.toISOString().slice(0, 10)).toBe(APPROVED_ON);
  });
});

// @traces 210-FR-001
describe('who may read it', () => {
  it.each(['receptionist', 'mechanic'] as const)(
    'refuses the garage %s',
    async (who) => {
      const w = await world();
      await file(w);

      const res = await read(w.dinamo.id, w[who]);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    },
  );

  it.each(['other', 'driver', 'admin'] as const)(
    'tells %s there is no such garage',
    async (who) => {
      const w = await world();
      await file(w);

      const res = await read(w.dinamo.id, w[who]);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('not_found');
    },
  );

  it('asks for a session', async () => {
    const w = await world();
    await file(w);

    expect((await read(w.dinamo.id)).status).toBe(401);
  });

  it('refuses an id that is not a uuid', async () => {
    const w = await world();

    expect((await read('dinamo', w.owner)).status).toBe(400);
  });

  it('tells the owner nothing of an unknown garage', async () => {
    const w = await world();

    expect((await read(randomUUID(), w.owner)).status).toBe(404);
  });
});
