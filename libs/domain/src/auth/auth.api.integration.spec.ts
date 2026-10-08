import { CURRENT_CONSENT } from '@motor-fix/contracts';
import {
  Controller,
  type DynamicModule,
  Get,
  INestApplication,
  Param,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { signAccessToken } from './access-token';
import { AccountsService } from './accounts.service';
import { CurrentActor, Requires } from './actor.guard';
import { AuthModule } from './auth.module';
import type { Role } from './capabilities';
import { type Actor, assertOwner } from './policy';
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

@Controller('probe')
class ProbeController {
  @Get('team')
  @Requires('garage.team')
  team(@CurrentActor() actor: Actor) {
    return { garageId: actor.garageId };
  }

  @Get('prices')
  @Requires('garage.prices')
  prices() {
    return {};
  }

  @Get('profile')
  @Requires('garage.profile')
  profile() {
    return {};
  }

  @Get('switches')
  @Requires('garage.feature_switches')
  switches() {
    return {};
  }

  @Get('quotes')
  @Requires('garage.requests')
  quotes() {
    return {};
  }

  @Get('own-jobs')
  @Requires('garage.own_jobs')
  ownJobs() {
    return {};
  }

  @Get('users')
  @Requires('admin.users')
  users() {
    return {};
  }

  @Get('cars/:owner')
  car(@CurrentActor() actor: Actor, @Param('owner') owner: string) {
    assertOwner(actor, owner);
    return {};
  }
}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProbeController],
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

async function dinamo() {
  return prisma.garage.create({
    data: { name: 'Atelier Dinamo', slug: 'atelier-dinamo' },
  });
}

const get = (path: string, auth?: string) => {
  const call = request(app.getHttpServer()).get(path);
  return auth ? call.set('Authorization', auth) : call;
};

describe('signing in is required', () => {
  it.each([
    ['no header', undefined],
    ['a malformed token', 'Bearer abc.def.ghi'],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
  ])('answers 401 sign_in_required with %s', async (_, auth) => {
    const res = await get('/me', auth);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 401 for a token signed with another key', async () => {
    const id = await account('andrei', ['driver']);
    const token = signAccessToken(
      { accountId: id, role: 'driver' },
      'other-secret',
    );

    const res = await get('/me', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('sign_in_required');
  });

  it('answers 401 for an account that does not exist or was deleted', async () => {
    const id = await account('andrei', ['driver']);
    await prisma.account.update({ data: { status: 'deleted' }, where: { id } });

    expect((await get('/me', bearer(id, 'driver'))).status).toBe(401);
    expect(
      (
        await get(
          '/me',
          bearer('4f0e2a4c-7a6b-4b8e-9d47-0c4a1b2c3d4e', 'driver'),
        )
      ).status,
    ).toBe(401);
  });

  it('answers 401 for an account whose roles were all removed', async () => {
    const id = await account('mihai', ['garage']);
    await prisma.accountRole.deleteMany({ where: { accountId: id } });

    for (const path of ['/me', '/probe/team']) {
      const res = await get(path, bearer(id, 'garage'));
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('sign_in_required');
    }
  });

  it('answers 403 account_suspended before any right is checked', async () => {
    const id = await account('mihai', ['garage']);
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id },
    });

    for (const path of ['/me', '/probe/team', '/probe/users']) {
      const res = await get(path, bearer(id, 'garage'));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('account_suspended');
    }
  });
});

describe('who am I', () => {
  it('describes a two-role account that used the garage role last', async () => {
    const id = await account('mihai', ['driver', 'garage']);
    await prisma.account.update({
      data: { lastRole: 'garage' },
      where: { id },
    });
    const garage = await dinamo();
    await prisma.garageMember.create({
      data: { accountId: id, garageId: garage.id, role: 'owner' },
    });

    const res = await get('/me', bearer(id, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      garageId: garage.id,
      id,
      landing: '/app/garage',
      name: 'mihai',
      role: 'garage',
    });
    expect([...res.body.roles].sort()).toEqual(['driver', 'garage']);
    expect(res.body.capabilities).toContain('garage.team');
    expect(res.body.capabilities).not.toContain('driver.cars');
  });

  it('opens the last role when the token names a role no longer held', async () => {
    const id = await account('andrei', ['driver']);

    const res = await get('/me', bearer(id, 'garage'));

    expect(res.body).toMatchObject({ landing: '/app/driver', role: 'driver' });
  });

  it('sends a receptionist and a mechanic to the garage frame', async () => {
    const garage = await dinamo();
    const ioana = await account('ioana', ['receptionist']);
    await prisma.garageMember.create({
      data: { accountId: ioana, garageId: garage.id, role: 'receptionist' },
    });
    const elena = await account('elena', ['mechanic']);
    await prisma.mechanic.create({
      data: { accountId: elena, garageId: garage.id, name: 'Mecanic' },
    });

    expect(
      (await get('/me', bearer(ioana, 'receptionist'))).body,
    ).toMatchObject({
      garageId: garage.id,
      landing: '/app/garage',
    });
    expect((await get('/me', bearer(elena, 'mechanic'))).body).toMatchObject({
      capabilities: ['garage.own_jobs', 'garage.audit_history'],
      garageId: garage.id,
      landing: '/app/garage',
    });
  });

  it('sends an admin to the admin frame', async () => {
    const id = await account('admin', ['admin']);

    expect((await get('/me', bearer(id, 'admin'))).body.landing).toBe(
      '/app/admin',
    );
  });
});

describe('rights answer 404, never 403', () => {
  it('lets the owner reach the team of their garage', async () => {
    const id = await account('mihai', ['garage']);
    const garage = await dinamo();
    await prisma.garageMember.create({
      data: { accountId: id, garageId: garage.id, role: 'owner' },
    });

    const res = await get('/probe/team', bearer(id, 'garage'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ garageId: garage.id });
  });

  it('closes team, prices, profile and switches to a receptionist', async () => {
    const id = await account('ioana', ['receptionist']);
    const garage = await dinamo();
    await prisma.garageMember.create({
      data: { accountId: id, garageId: garage.id, role: 'receptionist' },
    });

    for (const path of [
      '/probe/team',
      '/probe/prices',
      '/probe/profile',
      '/probe/switches',
    ]) {
      expect((await get(path, bearer(id, 'receptionist'))).status).toBe(404);
    }
    expect(
      (await get('/probe/quotes', bearer(id, 'receptionist'))).status,
    ).toBe(200);
  });

  it('closes team, prices, profile and switches to a mechanic, and quotes until permitted', async () => {
    const id = await account('elena', ['mechanic']);
    const garage = await dinamo();
    await prisma.mechanic.create({
      data: { accountId: id, garageId: garage.id, name: 'Mecanic' },
    });

    for (const path of [
      '/probe/team',
      '/probe/prices',
      '/probe/profile',
      '/probe/switches',
      '/probe/quotes',
    ]) {
      expect((await get(path, bearer(id, 'mechanic'))).status).toBe(404);
    }
    expect((await get('/probe/own-jobs', bearer(id, 'mechanic'))).status).toBe(
      200,
    );

    await prisma.mechanic.update({
      data: { canAnswerQuotes: true },
      where: { accountId: id },
    });
    expect((await get('/probe/quotes', bearer(id, 'mechanic'))).status).toBe(
      200,
    );
  });

  it('closes every garage and admin call to a driver', async () => {
    const id = await account('andrei', ['driver']);

    for (const path of [
      '/probe/team',
      '/probe/quotes',
      '/probe/own-jobs',
      '/probe/users',
    ]) {
      const res = await get(path, bearer(id, 'driver'));
      expect(res.status).toBe(404);
    }
  });

  it('closes the garage to an owner account that has no garage linked', async () => {
    const id = await account('mihai', ['garage']);

    expect((await get('/probe/team', bearer(id, 'garage'))).status).toBe(404);
  });

  it("answers 404 when driver Andrei asks for driver Elena's car", async () => {
    const andrei = await account('andrei', ['driver']);
    const elena = await account('elena', ['driver']);

    expect(
      (await get(`/probe/cars/${elena}`, bearer(andrei, 'driver'))).status,
    ).toBe(404);
    expect(
      (await get(`/probe/cars/${andrei}`, bearer(andrei, 'driver'))).status,
    ).toBe(200);
  });
});

describe('the account module', () => {
  const writeRoutes = (
    controllers: NonNullable<DynamicModule['controllers']>,
  ) =>
    controllers.flatMap((controller) => {
      const base = Reflect.getMetadata(PATH_METADATA, controller);
      const proto = controller.prototype as Record<string, object>;
      return Object.getOwnPropertyNames(proto)
        .filter((name) => {
          const method = Reflect.getMetadata(
            METHOD_METADATA,
            proto[name] ?? {},
          );
          return method !== undefined && method !== RequestMethod.GET;
        })
        .map(
          (name) =>
            `${base}/${Reflect.getMetadata(PATH_METADATA, proto[name] ?? {})}`,
        );
    });

  it('exposes no route that writes anything but a session, a new driver account, my language or my role in use', () => {
    const controllers =
      AuthModule.register({ databaseUrl, redisUrl, tokenSecret }).controllers ??
      [];
    const writes = writeRoutes(controllers);

    expect(controllers.length).toBeGreaterThan(0);
    expect(writes.sort()).toEqual([
      'auth/oauth/apple/callback',
      'auth/oauth/complete',
      'auth/refresh',
      'auth/roles/switch',
      'auth/sign-in',
      'auth/sign-out',
      'auth/sign-out-everywhere',
      'auth/sign-up',
      'me//',
    ]);
  });
});
