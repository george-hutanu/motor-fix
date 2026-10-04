import { randomUUID } from 'node:crypto';

import {
  Body,
  Controller,
  type INestApplication,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
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

@Controller('strict')
class StrictController {
  @Post('count')
  count(@Body('n', ParseIntPipe) n: number) {
    return { n };
  }
}

@Controller('mixed')
class MixedController {
  @Post('open')
  @Public()
  open() {
    return { reached: true };
  }

  @Post('closed')
  closed() {
    return { reached: true };
  }
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [StrictController, MixedController],
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

const post = (path: string, authorization?: string) => {
  const call = request(app.getHttpServer()).post(path);
  return authorization === undefined
    ? call
    : call.set('Authorization', authorization);
};

async function token(secret = tokenSecret, now = Date.now()) {
  const { id } = await accounts.createAccount({
    identity: { method: 'google', subject: `driver-${randomUUID()}` },
    name: 'Andrei',
    roles: ['driver'],
  });
  return signAccessToken({ accountId: id, role: 'driver' }, secret, now);
}

describe('the app-wide actor check, hostile cases', () => {
  it('answers 401 before it validates a body that would fail validation', async () => {
    const res = await post('/strict/count').send({ n: 'not a number' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('validates the body once the caller is signed in', async () => {
    const res = await post('/strict/count', `Bearer ${await token()}`).send({
      n: 'not a number',
    });

    expect(res.status).toBe(400);
  });

  it.each([
    ['an empty token', 'Bearer '],
    ['only the scheme', 'Bearer'],
    ['a garbage token', 'Bearer not.a.token'],
    ['a different scheme', 'Basic dXNlcjpwYXNz'],
    ['a token with trailing junk', 'Bearer a b c'],
    ['an empty header value', ''],
  ])('answers 401 sign_in_required for %s', async (_title, header) => {
    const res = await post('/mixed/closed', header);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('answers 401 for a token signed with another secret', async () => {
    const res = await post('/mixed/closed', `Bearer ${await token('other')}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('answers 401 for an expired token', async () => {
    const old = await token(tokenSecret, Date.now() - 60 * 60 * 1000);

    const res = await post('/mixed/closed', `Bearer ${old}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('treats a lower-case scheme as no usable credential', async () => {
    const res = await post('/mixed/closed', `bearer ${await token()}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('answers 401 for an account deleted after its token was issued', async () => {
    const valid = await token();
    await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');

    const res = await post('/mixed/closed', `Bearer ${valid}`);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });
});
