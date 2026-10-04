import { randomUUID } from 'node:crypto';

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { Public } from './actor.guard';
import { AuthModule } from './auth.module';
import { createPrisma } from './prisma';
import { serialDatabase } from './serial-db.testing';
import { AuditService } from '../audit/audit.service';
import { noEvents } from '../events/event.port';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const tokenSecret = 'test-secret';
const prisma = createPrisma(databaseUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

@Controller('unmarked')
class UnmarkedController {
  @Get()
  read() {
    return { reached: true };
  }
}

@Controller('open')
@Public()
class OpenController {
  @Get()
  read() {
    return { reached: true };
  }
}

@Controller('half-open')
class HalfOpenController {
  @Get('shut')
  shut() {
    return { reached: true };
  }

  @Get('open')
  @Public()
  open() {
    return { reached: true };
  }
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [UnmarkedController, OpenController, HalfOpenController],
    imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

const get = (path: string, authorization?: string) => {
  const call = request(app.getHttpServer()).get(path);
  return authorization ? call.set('Authorization', authorization) : call;
};

async function driver(status?: 'suspended') {
  const { id } = await accounts.createAccount({
    identity: { method: 'google', subject: `driver-${randomUUID()}` },
    name: 'Andrei',
    roles: ['driver'],
  });
  if (status) await prisma.account.update({ data: { status }, where: { id } });
  return `Bearer ${signAccessToken({ accountId: id, role: 'driver' }, tokenSecret)}`;
}

describe('the app-wide actor check', () => {
  it('refuses a route that carries no mark at all', async () => {
    const res = await get('/unmarked');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('lets a signed-in account through a route that carries no mark', async () => {
    const res = await get('/unmarked', await driver());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reached: true });
  });

  it('lets anyone through a controller marked public', async () => {
    await get('/open').expect(200, { reached: true });
  });

  it('marks one handler public without opening the rest of its controller', async () => {
    await get('/half-open/open').expect(200, { reached: true });
    const shut = await get('/half-open/shut');

    expect(shut.status).toBe(401);
    expect(shut.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('still tells a suspended account so on a route with no mark', async () => {
    const res = await get('/unmarked', await driver('suspended'));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'account_suspended' });
  });
});
