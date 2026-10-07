import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { EventsModule } from './events.module';
import { AuditService } from '../audit/audit.service';
import { signAccessToken } from '../auth/access-token';
import { AccountsService } from '../auth/accounts.service';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { createPrisma } from '../auth/prisma';
import { serialDatabase } from '../auth/serial-db.testing';
import { noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }),
      EventsModule.register({ redisUrl }),
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
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_event, account, garage CASCADE',
  );
});

async function account(name: string, roles: Role[]) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${name}-subject` },
    name,
    roles,
  });
  return id;
}

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

const sendTest = (body: unknown, auth?: string) => {
  const call = request(app.getHttpServer())
    .post('/admin/live/test')
    .send(body as object);
  return auth ? call.set('Authorization', auth) : call;
};

const entries = (actorId: string) =>
  prisma.activityLog.findMany({ where: { actorId, kind: 'live.test' } });

const history = (auth: string) =>
  request(app.getHttpServer())
    .get('/audit-history')
    .query({ area: 'admin_actions' })
    .set('Authorization', auth);

describe('the admin live test audit entry', () => {
  it('records one entry per call when the same call is made twice', async () => {
    const admin = await account('Ana', ['admin']);
    const driver = await account('Andrei', ['driver']);

    await sendTest({ accountId: driver }, bearer(admin, 'admin'));
    await sendTest({ accountId: driver }, bearer(admin, 'admin'));

    expect(await entries(admin)).toHaveLength(2);
  });

  it.each([
    ['no id', {}],
    ['a null id', { accountId: null }],
    ['an extra field', { accountId: randomUUID(), more: true }],
  ])('records nothing for %s', async (_label, body) => {
    const admin = await account('Ana', ['admin']);

    const res = await sendTest(body, bearer(admin, 'admin'));

    expect(res.status).toBe(400);
    expect(await entries(admin)).toEqual([]);
  });

  it('shows the actor by first name in the admin actions history', async () => {
    const admin = await account('Ana Maria Popescu', ['admin']);
    const driver = await account('Andrei', ['driver']);
    await sendTest({ accountId: driver }, bearer(admin, 'admin'));

    const res = await history(bearer(admin, 'admin'));

    const mine = res.body.items.filter(
      (item: { kind: string | null; actor: { id: string } }) =>
        item.kind === 'live.test' && item.actor.id === admin,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].actor).toMatchObject({ id: admin, name: 'Ana' });
  });

  it('keeps the entry out of what a driver can read', async () => {
    const admin = await account('Ana', ['admin']);
    const driver = await account('Andrei', ['driver']);
    await sendTest({ accountId: driver }, bearer(admin, 'admin'));

    const res = await history(bearer(driver, 'driver'));

    expect(JSON.stringify(res.body)).not.toContain('live.test');
    expect(res.status).not.toBe(200);
  });
});
