// @traces 1381-FR-001
// @traces 1381-FR-002 1381-FR-003 1381-FR-004 1381-FR-006
import { randomUUID } from 'node:crypto';

import type { Role } from '@motor-fix/contracts/capabilities';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AuthModule } from './auth.module';
import { serialDatabase } from './serial-db.testing';
import { GaragesModule } from '../garages/garages.module';
import { BrevoMock } from '../notifications/brevo/brevo-mock.testing';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  databaseUrl,
  redisUrlFor,
  testConfig,
} from '../notifications/notifications.testing';
import { QuotesModule } from '../quotes/quotes.module';
import { quotesWorld } from '../quotes/quotes.testing';
import { UNUSED_STORAGE } from '../storage/s3-test-store';
import { StorageModule } from '../storage/storage.module';
import { WorkshopModule } from '../workshop/workshop.module';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const HOUR = 3_600_000;
const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const brevo = new BrevoMock();
let app: INestApplication;

beforeAll(async () => {
  await brevo.start();
  const email = testConfig(brevo.url);
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const notifications = NotificationsModule.register(
    {
      databaseUrl,
      email,
      push: {
        privateKey: 'private',
        publicKey: 'public',
        subject: 'mailto:ops@example.test',
      },
      redisUrl,
    },
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
      QuotesModule,
      WorkshopModule,
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
  await app?.close();
  await brevo.stop();
  await prisma.$disconnect();
});

beforeEach(() => world.reset());

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const call = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  auth: string,
  body?: object,
) => {
  const req = request(app.getHttpServer())
    [method](path)
    .set('Authorization', auth)
    .set('Idempotency-Key', randomUUID());
  return body ? req.send(body) : req;
};

const walk = (value: unknown, path = ''): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => walk(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(/phone/i.test(k) ? [`${path}.${k}`] : []),
      ...walk(v, `${path}.${k}`),
    ]);
  }
  return [];
};

async function world2() {
  const a = await world.garage('Atelier Alfa');
  const b = await world.garage('Atelier Beta');
  const ownerA = await world.account('Mihai Owner', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: ownerA, garageId: a.id, role: 'owner' },
  });
  const elena = await world.account('Elena Fixer', ['mechanic']);
  const costel = await world.account('Costel Hand', ['mechanic']);
  const elenaCard = await prisma.mechanic.create({
    data: {
      accountId: elena,
      canAnswerQuotes: true,
      garageId: a.id,
      name: 'Elena',
    },
  });
  const costelCard = await prisma.mechanic.create({
    data: { accountId: costel, garageId: a.id, name: 'Costel' },
  });
  const when = () => new Date(Date.now() + 48 * HOUR).toISOString();
  const mine = await world.booked(a.id, when(), 'confirmed', {
    mechanicId: elenaCard.id,
  });
  const his = await world.booked(a.id, when(), 'confirmed', {
    mechanicId: costelCard.id,
  });
  const nobody = await world.booked(a.id, when(), 'confirmed');
  const foreign = await world.booked(b.id, when(), 'confirmed');
  const jobMine = await world.job(mine.id, 'to_do', {
    mechanicId: elenaCard.id,
  });
  const jobHis = await world.job(his.id, 'to_do', {
    mechanicId: costelCard.id,
  });
  const jobNobody = await world.job(nobody.id, 'to_do');
  const jobForeign = await world.job(foreign.id, 'to_do');
  return {
    a,
    b,
    costel,
    elena,
    elenaCard,
    jobForeign,
    jobHis,
    jobMine,
    jobNobody,
    ownerA,
  };
}

describe('a mechanic’s account read after removal', () => {
  it('keeps her membership row at another garage when her card is removed', async () => {
    const w = await world2();
    await prisma.garageMember.create({
      data: { accountId: w.elena, garageId: w.b.id, role: 'receptionist' },
    });
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: w.elenaCard.id },
    });

    const res = await call('get', '/me', bearer(w.elena, 'mechanic'));

    expect(
      res.body.garageAccess.map((e: { garageId: string }) => e.garageId),
    ).toEqual([w.b.id]);
  });

  it('answers the same empty list on a second read', async () => {
    const w = await world2();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: w.elenaCard.id },
    });
    const elena = bearer(w.elena, 'mechanic');

    const first = await call('get', '/me', elena);
    const second = await call('get', '/me', elena);

    expect([first.body.garageAccess, second.body.garageAccess]).toEqual([
      [],
      [],
    ]);
  });

  it('answers 404, never 403, on every garage route a removed card with every right reaches', async () => {
    const w = await world2();
    await prisma.mechanic.update({
      data: {
        canAnswerQuotes: true,
        canMoveBookings: true,
        canRecordFinalPrice: true,
        removedAt: new Date(),
      },
      where: { id: w.elenaCard.id },
    });
    const elena = bearer(w.elena, 'mechanic');
    const asked = await world.request(await world.account('Andrei Ion Marin'));
    await world.recipient(asked.id, w.a.id, 'waiting', w.ownerA);

    const answers = {
      decline: await call(
        'post',
        `/garage/requests/${asked.id}/decline`,
        elena,
        { reason: 'fully_booked' },
      ),
      job: await call('get', `/garage/jobs/${w.jobMine.id}`, elena),
      jobs: await call('get', '/garage/jobs', elena),
      quote: await call('post', '/quotes', elena, {
        durationMinutes: 60,
        fromLei: 100,
        requestId: asked.id,
        slot: new Date(Date.now() + 48 * HOUR).toISOString(),
        toLei: 200,
      }),
      requests: await call('get', '/garage/requests', elena),
    };

    for (const [name, res] of Object.entries(answers)) {
      expect([name, res.status]).toEqual([name, 404]);
    }
    expect(await prisma.quote.count({ where: { requestId: asked.id } })).toBe(
      0,
    );
  });
});

describe('a mechanic’s own-jobs scope', () => {
  it('lists her job only, excluding a colleague’s, an unassigned one and another garage’s', async () => {
    const w = await world2();

    const res = await call('get', '/garage/jobs', bearer(w.elena, 'mechanic'));

    expect(res.status).toBe(200);
    const ids = JSON.stringify(res.body);
    expect(ids).toContain(w.jobMine.id);
    for (const other of [w.jobHis, w.jobNobody, w.jobForeign]) {
      expect(ids).not.toContain(other.id);
    }
  });

  it('answers 403 for a colleague’s job and an unassigned one, 404 for another garage’s and for an unknown id', async () => {
    const w = await world2();
    const elena = bearer(w.elena, 'mechanic');
    const status = async (id: string) =>
      (await call('get', `/garage/jobs/${id}`, elena)).status;

    expect({
      colleague: await status(w.jobHis.id),
      foreign: await status(w.jobForeign.id),
      nobody: await status(w.jobNobody.id),
      own: await status(w.jobMine.id),
      unknown: await status(randomUUID()),
    }).toEqual({
      colleague: 403,
      foreign: 404,
      nobody: 403,
      own: 200,
      unknown: 404,
    });
  });

  it('answers a malformed job id with 400 or 404, never 500', async () => {
    const w = await world2();

    const res = await call(
      'get',
      "/garage/jobs/not-a-uuid'--",
      bearer(w.elena, 'mechanic'),
    );

    expect([400, 404]).toContain(res.status);
  });

  it('answers 404 to a mechanic of one garage on another garage’s owner routes', async () => {
    const w = await world2();
    const elena = bearer(w.elena, 'mechanic');

    const answers = [
      await call('get', `/garages/${w.b.id}/members`, elena),
      await call('get', `/garages/${w.b.id}/prices`, elena),
      await call('patch', `/garages/${w.b.id}`, elena, {
        paymentMethods: { card: true, cash: true, transfer: false },
      }),
    ];

    expect(answers.map((r) => r.status)).toEqual([404, 404, 404]);
  });

  it('answers 404, not 403, on the colleague’s job once her own card is removed', async () => {
    const w = await world2();
    await prisma.mechanic.update({
      data: { removedAt: new Date() },
      where: { id: w.elenaCard.id },
    });

    const res = await call(
      'get',
      `/garage/jobs/${w.jobHis.id}`,
      bearer(w.elena, 'mechanic'),
    );

    expect(res.status).toBe(404);
  });
});

describe('what a mechanic is shown', () => {
  it('carries no phone key in /me, the jobs list, her job, the inbox and a request, and no plate in the inbox', async () => {
    const w = await world2();
    const asked = await world.request(await world.account('Andrei Ion Marin'));
    await world.recipient(asked.id, w.a.id, 'waiting', w.ownerA);
    const elena = bearer(w.elena, 'mechanic');

    const me = await call('get', '/me', elena);
    const jobs = await call('get', '/garage/jobs', elena);
    const job = await call('get', `/garage/jobs/${w.jobMine.id}`, elena);
    const inbox = await call('get', '/garage/requests', elena);
    const detail = await call('get', `/garage/requests/${asked.id}`, elena);

    expect([me, jobs, job, inbox].map((r) => r.status)).toEqual([
      200, 200, 200, 200,
    ]);
    // Her own account's phone and its confirmation are hers to read.
    const { phone: _phone, phoneConfirmed: _confirmed, ...account } = me.body;
    expect(
      [account, ...[jobs, job, inbox, detail].map((r) => r.body)].flatMap(
        (body) => walk(body),
      ),
    ).toEqual([]);
    expect(JSON.stringify(job.body)).toContain('B123ABC');
    expect(JSON.stringify(inbox.body)).not.toContain('"plate"');
    expect(JSON.stringify(detail.body)).not.toContain('"plate"');
  });
});
