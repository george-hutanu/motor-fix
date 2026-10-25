import { randomUUID } from 'node:crypto';

import {
  CURRENT_CONSENT,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';
import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { metrics } from '@opentelemetry/api';
import { IsString } from 'class-validator';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import {
  CurrentActor,
  OpenInMaintenance,
  OpenToPending,
  OptionalActor,
  Public,
} from './actor.guard';
import { AuthModule } from './auth.module';
import { MAINTENANCE } from './maintenance';
import type { Actor } from './policy';
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

@Controller('optional')
@Public()
class OptionalController {
  @Get('marked')
  @OptionalActor()
  marked(@CurrentActor() actor?: Actor) {
    return { accountId: actor?.accountId ?? null };
  }

  @Get('unmarked')
  unmarked(@CurrentActor() actor?: Actor) {
    return { accountId: actor?.accountId ?? null };
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

class NoteBody {
  @IsString()
  note!: string;
}

@Controller('pending')
class PendingController {
  @Post('validated')
  validated(@Body() body: NoteBody) {
    return { note: body.note };
  }

  @Get('let-through')
  @OpenToPending()
  letThrough(@CurrentActor() actor: Actor) {
    return { accountId: actor.accountId };
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
      OptionalController,
      PendingController,
    ],
    imports: [AuthModule.register({ databaseUrl, redisUrl, tokenSecret })],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => maintenance, set: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
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

// @traces 143-FR-001
describe('a public route that names the visitor when it can', () => {
  async function accountOf(authorization: string) {
    const token = authorization.slice('Bearer '.length);
    const [, payload] = token.split('.');
    return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())
      .sub as string;
  }

  it('names the account behind a valid session', async () => {
    const authorization = await driver();

    const res = await get('/optional/marked', authorization);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accountId: await accountOf(authorization) });
  });

  it('answers a visitor with no session as anonymous', async () => {
    await get('/optional/marked').expect(200, { accountId: null });
  });

  it.each([
    ['a malformed token', 'Bearer not-a-token'],
    ['a token signed with another key', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'],
  ])('treats %s as anonymous instead of refusing', async (_, authorization) => {
    await get('/optional/marked', authorization).expect(200, {
      accountId: null,
    });
  });

  it('treats an expired session as anonymous', async () => {
    const expired = await signedIn(['driver'], 'driver', {
      now: Date.now() - DAY,
    });

    await get('/optional/marked', expired).expect(200, { accountId: null });
  });

  it('treats a suspended account as anonymous', async () => {
    await get('/optional/marked', await driver('suspended')).expect(200, {
      accountId: null,
    });
  });

  it('never reads the session on a public route without the mark', async () => {
    await get('/optional/unmarked', await driver()).expect(200, {
      accountId: null,
    });
  });
});

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

  it('answers maintenance ahead of sign-in for a call with no token', async () => {
    expectMaintenance(await get('/unmarked'));
  });

  // The app renews an expired session on a 401, then learns of maintenance.
  it.each([
    ['a malformed token', 'Bearer not-a-token'],
    ['a token signed with another key', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'],
  ])('asks for sign-in as usual for %s', async (_, authorization) => {
    const res = await get('/unmarked', authorization);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('asks an admin whose session expired to sign in, so it can renew', async () => {
    const expired = await signedIn(['admin'], 'admin', {
      now: Date.now() - DAY,
    });
    const res = await get('/unmarked', expired);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('still tells a suspended account so', async () => {
    const res = await get('/unmarked', await driver('suspended'));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'account_suspended' });
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

const IN_FORCE = {
  privacyVersion: PRIVACY_VERSION,
  termsVersion: TERMS_VERSION,
};

async function pending(authorization: string) {
  const [, payload] = authorization.slice('Bearer '.length).split('.');
  const { sub: accountId } = JSON.parse(
    Buffer.from(payload ?? '', 'base64url').toString(),
  ) as { sub: string };
  await prisma.accountConsent.updateMany({
    data: { textVersion: '2026-10-11' },
    where: { accountId },
  });
  return { accountId, authorization };
}

function expectConsentRequired(res: request.Response) {
  expect(res.status).toBe(403);
  expect(res.body).toEqual({
    code: 'consent_required',
    message: expect.any(String),
    ...IN_FORCE,
  });
}

// @traces 1204-FR-002
// @traces 1204-FR-003
describe('the actor check for an account whose acceptance is pending', () => {
  it.each([
    ['driver', ['driver'], 'driver'],
    ['garage owner', ['garage'], 'garage'],
    ['mechanic', ['mechanic'], 'mechanic'],
    ['receptionist', ['receptionist'], 'receptionist'],
    ['admin', ['admin'], 'admin'],
  ] as const)(
    'refuses a %s with consent_required and the versions in force',
    async (_, roles, role) => {
      const { authorization } = await pending(await signedIn([...roles], role));

      expectConsentRequired(await get('/unmarked', authorization));
    },
  );

  it('refuses before the body is validated', async () => {
    const { authorization } = await pending(await driver());

    const res = await request(app.getHttpServer())
      .post('/pending/validated')
      .set('Authorization', authorization)
      .send({ note: 42 });

    expectConsentRequired(res);
  });

  it('lets an account through once its latest rows are the versions in force', async () => {
    const { accountId, authorization } = await pending(await driver());
    await prisma.accountConsent.createMany({
      data: [
        {
          accountId,
          kind: 'terms',
          language: 'ro',
          method: 'google',
          textVersion: TERMS_VERSION,
        },
        {
          accountId,
          kind: 'privacy_notice',
          language: 'ro',
          method: 'google',
          textVersion: PRIVACY_VERSION,
        },
      ],
    });

    await get('/unmarked', authorization).expect(200, { reached: true });
  });

  it('refuses an account with no acceptance rows at all', async () => {
    const { accountId, authorization } = await pending(await driver());
    await prisma.accountConsent.deleteMany({ where: { accountId } });

    expectConsentRequired(await get('/unmarked', authorization));
  });

  it('lets a pending account through a handler marked open to it, as the account', async () => {
    const { accountId, authorization } = await pending(await driver());

    await get('/pending/let-through', authorization).expect(200, { accountId });
  });

  it('answers a public route as for any visitor, the optional actor included', async () => {
    const { accountId, authorization } = await pending(await driver());

    await get('/open', authorization).expect(200, { reached: true });
    await get('/optional/marked', authorization).expect(200, { accountId });
  });

  it('keeps sign-in and suspension ahead of the pending check', async () => {
    const { authorization } = await pending(await driver('suspended'));

    const suspended = await get('/unmarked', authorization);
    const missing = await get('/unmarked');

    expect(suspended.body).toMatchObject({ code: 'account_suspended' });
    expect(missing.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('keeps maintenance ahead for a non-admin and refuses a pending admin with consent_required', async () => {
    maintenance = true;
    const { authorization: asDriver } = await pending(await driver());
    const { authorization: asAdmin } = await pending(
      await signedIn(['admin'], 'admin'),
    );

    expectMaintenance(await get('/unmarked', asDriver));
    expectConsentRequired(await get('/unmarked', asAdmin));
  });
});
