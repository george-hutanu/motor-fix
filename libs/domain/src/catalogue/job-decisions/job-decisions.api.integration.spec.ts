import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from '../../auth/access-token';
import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { CatalogueModule } from '../catalogue.module';

// @traces 414-FR-002 414-FR-003 414-FR-004
// @traces 414-FR-005 414-FR-013

const redisUrl = redisUrlFor(3);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NON_ADMIN = ['driver', 'garage', 'receptionist', 'mechanic'] as const;
const NOBODY = '00000000-0000-4000-8000-000000000000';
const REASON = 'Nu este clar ce lucrare este; există deja Diagnoză.';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      CatalogueModule,
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  // The API's own pipe options (apps/api bootstrap).
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
  await prisma.$executeRawUnsafe('TRUNCATE job_type CASCADE');
});

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const as = async (role: Role, name = `Cont ${role}`) =>
  bearer(await account(name, [role]), role);

const server = () => request(app.getHttpServer());

const queue = (auth?: string) => {
  const call = server().get('/admin/catalogue-jobs');
  return auth ? call.set('Authorization', auth) : call;
};

const decide = (
  id: string,
  step: 'approve' | 'reject',
  body: object,
  auth?: string,
) => {
  const call = server().post(`/admin/catalogue-jobs/${id}/${step}`).send(body);
  return auth ? call.set('Authorization', auth) : call;
};

const approval = {
  carSystem: 'engine',
  nameEn: 'Injector reconditioning',
  nameRo: 'Recondiționare injectoare',
};

// Atelier Dinamo's pending proposal with its default range.
async function proposal(name = 'Recondiționare injectoare') {
  const garage = await prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: `dinamo-${randomUUID()}` },
  });
  const job = await prisma.jobType.create({
    data: {
      key: `job-${randomUUID()}`,
      nameEn: name,
      nameRo: name,
      proposedByGarageId: garage.id,
      status: 'pending',
    },
  });
  await prisma.garagePrice.create({
    data: {
      durationMinutes: 90,
      fromBani: 18_000,
      garageId: garage.id,
      jobTypeId: job.id,
      position: 0,
      toBani: 42_000,
      updatedBy: await account('Dan Dinamo', ['garage']),
    },
  });
  return { garage, job };
}

describe('GET /admin/catalogue-jobs', () => {
  it('answers an admin the pending jobs and the RAR activities', async () => {
    const { garage, job } = await proposal();

    const res = await queue(await as('admin'));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        durationMinutes: 90,
        fromBani: 18_000,
        garage: { id: garage.id, name: 'Atelier Dinamo', slug: garage.slug },
        id: job.id,
        name: 'Recondiționare injectoare',
        proposedAt: job.createdAt.toISOString(),
        toBani: 42_000,
      },
    ]);
    expect(res.body.rarActivities).toEqual(
      expect.arrayContaining([
        { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
      ]),
    );
  });

  it.each(NON_ADMIN)('answers 404 to a %s', async (role) => {
    await proposal();

    const res = await queue(await as(role));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('injectoare');
  });

  it('answers 401 with no session and 403 to a suspended admin', async () => {
    const suspended = await account('Ana Suspendată', ['admin'], {
      status: 'suspended',
    });

    const none = await queue();
    const refused = await queue(bearer(suspended, 'admin'));

    expect([none.status, none.body.code]).toEqual([401, 'sign_in_required']);
    expect([refused.status, refused.body.code]).toEqual([
      403,
      'account_suspended',
    ]);
  });
});

describe('POST /admin/catalogue-jobs/:id/approve and /reject', () => {
  it('approves a pending job for an admin and answers the decided job', async () => {
    const { job } = await proposal();

    const res = await decide(
      job.id,
      'approve',
      { ...approval, rarActivity: 'mechanics' },
      await as('admin'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      carSystem: 'engine',
      decidedAt: expect.any(String),
      id: job.id,
      nameEn: 'Injector reconditioning',
      nameRo: 'Recondiționare injectoare',
      rarActivity: 'mechanics',
      status: 'approved',
    });
  });

  it('rejects a pending job for an admin with the trimmed reason', async () => {
    const { job } = await proposal();

    const res = await decide(
      job.id,
      'reject',
      { reason: `  ${REASON}  ` },
      await as('admin'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: job.id,
      rejectionReason: REASON,
      status: 'rejected',
    });
  });

  it.each(NON_ADMIN)(
    'answers 404 to a %s on both decisions and writes nothing',
    async (role) => {
      const { job } = await proposal();
      const auth = await as(role);

      const approve = await decide(job.id, 'approve', approval, auth);
      const reject = await decide(job.id, 'reject', { reason: REASON }, auth);

      expect([approve.status, reject.status]).toEqual([404, 404]);
      expect(
        (await prisma.jobType.findUniqueOrThrow({ where: { id: job.id } }))
          .status,
      ).toBe('pending');
    },
  );

  it('answers 401 with no session and 403 to a suspended admin', async () => {
    const { job } = await proposal();
    const suspended = bearer(
      await account('Ana Suspendată', ['admin'], { status: 'suspended' }),
      'admin',
    );

    expect((await decide(job.id, 'approve', approval)).status).toBe(401);
    expect(
      (await decide(job.id, 'reject', { reason: REASON }, suspended)).status,
    ).toBe(403);
  });

  it('answers 404 for an unknown job and 400 for a malformed id', async () => {
    const admin = await as('admin');

    const unknown = await decide(NOBODY, 'approve', approval, admin);
    const malformed = await decide(
      'not-a-uuid',
      'reject',
      { reason: REASON },
      admin,
    );

    expect([unknown.status, unknown.body.code]).toEqual([404, 'not_found']);
    expect(malformed.status).toBe(400);
  });

  it('answers 415 to a body that is not JSON', async () => {
    const { job } = await proposal();

    const res = await server()
      .post(`/admin/catalogue-jobs/${job.id}/reject`)
      .set('Authorization', await as('admin'))
      .set('Content-Type', 'text/plain')
      .send(REASON);

    expect(res.status).toBe(415);
  });

  it.each([
    [
      'a Romanian name of two characters',
      'approve',
      { ...approval, nameRo: 'Ab' },
    ],
    [
      'an English name over 80 characters',
      'approve',
      { ...approval, nameEn: 'x'.repeat(81) },
    ],
    ['an unknown system', 'approve', { ...approval, carSystem: 'rocket' }],
    ['no system', 'approve', { nameEn: 'Abc', nameRo: 'Abc' }],
    ['a reason of nine characters', 'reject', { reason: 'Prea puțn' }],
    ['a reason of 501 characters', 'reject', { reason: 'a'.repeat(501) }],
  ] as const)(
    'refuses %s with 400 and writes nothing',
    async (_, step, body) => {
      const { job } = await proposal();

      const res = await decide(job.id, step, body, await as('admin'));

      expect(res.status).toBe(400);
      expect(
        (await prisma.jobType.findUniqueOrThrow({ where: { id: job.id } }))
          .status,
      ).toBe('pending');
    },
  );

  it('refuses an unknown RAR activity with 422', async () => {
    const { job } = await proposal();

    const res = await decide(
      job.id,
      'approve',
      { ...approval, rarActivity: 'flying' },
      await as('admin'),
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('unknown_activity');
  });

  it('answers 409 already_decided to a second decision', async () => {
    const { job } = await proposal();
    const ana = await as('admin', 'Ana Popescu');
    await decide(job.id, 'approve', approval, ana);

    const res = await decide(
      job.id,
      'reject',
      { reason: REASON },
      await as('admin', 'Mihai Ionescu'),
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'already_decided',
      message: 'Already approved by Ana',
    });
  });
});
