import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { OpenInMaintenance, Public } from './actor.guard';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { MAINTENANCE } from './maintenance';
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

@Controller('stays')
@OpenInMaintenance()
class StaysController {
  @Get()
  read() {
    return { reached: true };
  }
}

@Controller('stays-public')
class StaysPublicController {
  @Get()
  @Public()
  @OpenInMaintenance()
  read() {
    return { reached: true };
  }
}

let app: INestApplication;
let maintenance = false;
const refusals = jest.fn();

beforeAll(async () => {
  jest.spyOn(metrics, 'getMeter').mockReturnValue({
    createCounter: () => ({ add: refusals }),
  } as unknown as ReturnType<typeof metrics.getMeter>);
  const moduleRef = await Test.createTestingModule({
    controllers: [
      UnmarkedController,
      OpenController,
      HalfOpenController,
      StaysController,
      StaysPublicController,
    ],
    imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => maintenance, set: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  maintenance = false;
  refusals.mockClear();
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
});

const get = (path: string, authorization?: string) => {
  const call = request(app.getHttpServer()).get(path);
  return authorization ? call.set('Authorization', authorization) : call;
};

async function signedIn(
  roles: Role[],
  role: Role,
  { now, status }: { now?: number; status?: 'suspended' } = {},
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    identity: { method: 'google', subject: `${role}-${randomUUID()}` },
    name: 'Andrei',
    roles,
  });
  if (status) await prisma.account.update({ data: { status }, where: { id } });
  return `Bearer ${signAccessToken({ accountId: id, role }, tokenSecret, now)}`;
}

const driver = (status?: 'suspended') =>
  signedIn(['driver'], 'driver', { status });

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

const DAY = 24 * 60 * 60 * 1000;

function expectMaintenance(res: request.Response) {
  expect(res.status).toBe(503);
  expect(res.body).toMatchObject({
    code: 'maintenance',
    retryAfterSeconds: 300,
  });
}

describe('the actor check while the platform is in maintenance', () => {
  beforeEach(() => {
    maintenance = true;
  });

  it('refuses a visitor on a public route that is not kept open, and counts it', async () => {
    expectMaintenance(await get('/open'));
    expectMaintenance(await get('/half-open/open'));
    expect(refusals).toHaveBeenCalledWith(1, {
      role: 'visitor',
      route: '/open',
    });
  });

  it.each([
    ['no token', undefined],
    ['a malformed token', 'Bearer not-a-token'],
    ['a token signed with another key', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'],
  ])(
    'answers maintenance ahead of sign-in for %s',
    async (_, authorization) => {
      expectMaintenance(await get('/unmarked', authorization));
    },
  );

  it('answers maintenance ahead of sign-in for an expired session', async () => {
    const expired = await signedIn(['admin'], 'admin', {
      now: Date.now() - DAY,
    });

    expectMaintenance(await get('/unmarked', expired));
  });

  it('answers maintenance ahead of the suspension of an account', async () => {
    expectMaintenance(await get('/unmarked', await driver('suspended')));
  });

  it.each([
    ['driver', ['driver'], 'driver'],
    ['garage owner', ['garage'], 'garage'],
    ['mechanic', ['mechanic'], 'mechanic'],
  ] as const)(
    'refuses a %s and counts a signed-in refusal',
    async (_, roles, role) => {
      expectMaintenance(
        await get('/unmarked', await signedIn([...roles], role)),
      );
      expect(refusals).toHaveBeenCalledWith(1, {
        role: 'signed_in',
        route: '/unmarked',
      });
    },
  );

  it('lets an account holding admin through, whatever role its session is in', async () => {
    const asAdmin = await signedIn(['admin'], 'admin');
    const asDriver = await signedIn(['admin', 'driver'], 'driver');

    await get('/unmarked', asAdmin).expect(200, { reached: true });
    await get('/unmarked', asDriver).expect(200, { reached: true });
    expect(refusals).not.toHaveBeenCalled();
  });

  it('lets an admin through a public route too', async () => {
    await get('/open', await signedIn(['admin'], 'admin')).expect(200);
  });

  it('treats a route kept open as when maintenance is off', async () => {
    await get('/stays-public').expect(200, { reached: true });
    await get('/stays', await driver()).expect(200, { reached: true });
    const visitor = await get('/stays');

    expect(visitor.status).toBe(401);
    expect(visitor.body).toMatchObject({ code: 'sign_in_required' });
    expect(refusals).not.toHaveBeenCalled();
  });
});
