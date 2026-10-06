import { generateKeyPairSync } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';

import {
  type OpenIdStub,
  type StubPerson,
  startOpenIdStub,
} from './openid-stub.testing';
import { oauthSettings } from './providers';
import { AuditService } from '../../audit/audit.service';
import { noEvents } from '../../events/event.port';
import { AccountsService } from '../accounts.service';
import { AuthModule } from '../auth.module';
import type { Role } from '../capabilities';
import { MAINTENANCE } from '../maintenance';
import { createPrisma } from '../prisma';
import { serialDatabase } from '../serial-db.testing';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(redisUrl);
const accounts = new AccountsService(prisma, new AuditService(), noEvents);
serialDatabase(databaseUrl);

const WEB = 'https://web.example.test';
const appleKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();

let stub: OpenIdStub;
let app: NestExpressApplication;

async function boot(oauth: ReturnType<typeof oauthSettings>) {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        databaseUrl,
        oauth,
        redisUrl,
        tokenSecret: 'test',
      }),
    ],
  })
    .overrideProvider(MAINTENANCE)
    .useValue({ on: async () => false })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>();
  nest.set('trust proxy', 'loopback');
  nest.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await nest.init();
  return nest;
}

beforeAll(async () => {
  stub = await startOpenIdStub();
  app = await boot(
    oauthSettings('test', {
      APPLE_ISSUER: stub.issuer,
      APPLE_KEY_ID: 'KEY123',
      APPLE_PRIVATE_KEY: appleKey,
      APPLE_SERVICES_ID: 'ro.motorfix.web',
      APPLE_TEAM_ID: 'TEAM123',
      GOOGLE_CLIENT_ID: 'google-client',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_ISSUER: stub.issuer,
      PUBLIC_WEB_URL: WEB,
    }),
  );
});

afterAll(async () => {
  await app.close();
  await stub.close();
  await prisma.$disconnect();
  redis.disconnect();
});

beforeEach(async () => {
  stub.fault = null;
  await prisma.$executeRawUnsafe('TRUNCATE account, garage CASCADE');
  const keys = await redis.keys('auth:*');
  if (keys.length) await redis.del(...keys);
});

const http = () => request(app.getHttpServer());

function cookie(res: request.Response, name: string): string | undefined {
  const all = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const line = all.find((c) => c.startsWith(`${name}=`));
  return line?.split(';')[0].slice(name.length + 1);
}

function cookieLine(res: request.Response, name: string): string {
  const all = (res.headers['set-cookie'] ?? []) as unknown as string[];
  return all.find((c) => c.startsWith(`${name}=`)) ?? '';
}

const back = (res: request.Response) => {
  expect(res.status).toBe(302);
  return new URL(res.headers['location'], WEB);
};
const resultOf = (res: request.Response) =>
  back(res).searchParams.get('result');

type Provider = 'google' | 'apple';

async function start(provider: Provider, query = 'language=ro&remember=true') {
  const res = await http().get(`/auth/oauth/${provider}?${query}`);
  expect(res.status).toBe(302);
  return {
    flow: cookie(res, 'mf_oauth') ?? '',
    location: new URL(res.headers['location']),
  };
}

async function approve(location: URL) {
  const answer = await fetch(location, { redirect: 'manual' });
  const to = new URL(answer.headers.get('location') ?? '');
  return {
    code: to.searchParams.get('code') ?? '',
    state: to.searchParams.get('state') ?? '',
  };
}

function callback(
  provider: Provider,
  fields: Record<string, string>,
  flow: string | undefined,
) {
  const req =
    provider === 'apple'
      ? http().post('/auth/oauth/apple/callback').type('form').send(fields)
      : http().get('/auth/oauth/google/callback').query(fields);
  return flow === undefined ? req : req.set('Cookie', `mf_oauth=${flow}`);
}

async function continueWith(
  provider: Provider,
  person: StubPerson,
  extra: Record<string, string> = {},
  query?: string,
) {
  stub.next = person;
  const { flow, location } = await start(provider, query);
  const { code, state } = await approve(location);
  return callback(provider, { code, state, ...extra }, flow);
}

async function existing(
  email: string,
  identity: { method: 'password' | 'google' | 'apple'; subject: string } = {
    method: 'password',
    subject: email,
  },
  roles: Role[] = ['driver'],
) {
  const { id } = await accounts.createAccount({
    consent: CURRENT_CONSENT,
    email,
    // A provider links only to an account that confirmed its e-mail.
    emailVerified: true,
    identity: {
      ...identity,
      passwordHash: identity.method === 'password' ? 'x' : undefined,
    },
    name: 'Andrei Ionescu',
    roles,
  });
  return id;
}

const ELENA: StubPerson = {
  email: 'elena@example.test',
  email_verified: true,
  name: 'Elena Pop',
  sub: 'google-elena',
};

async function pendingFor(
  person: StubPerson = ELENA,
  provider: Provider = 'google',
  extra: Record<string, string> = {},
) {
  const res = await continueWith(provider, person, extra);
  expect(resultOf(res)).toBe('consent');
  return cookie(res, 'mf_oauth_pending') ?? '';
}

const complete = (pending: string | undefined, body: unknown) => {
  const req = http().post('/auth/oauth/complete');
  return (
    pending === undefined
      ? req
      : req.set('Cookie', `mf_oauth_pending=${pending}`)
  ).send(body as object);
};

const GOOD_BODY = {
  consent: CURRENT_CONSENT,
  language: 'ro',
  name: 'Elena Pop',
};

describe('routes that must not exist', () => {
  it.each([
    ['POST', '/auth/providers'],
    ['POST', '/auth/oauth/google'],
    ['GET', '/auth/oauth/complete'],
    ['POST', '/auth/oauth/pending'],
    ['POST', '/auth/oauth/google/callback'],
    ['GET', '/auth/oauth/apple/callback'],
    ['GET', '/auth/oauth/google%2F..%2Fapple'],
    ['GET', '/auth/oauth/constructor'],
    ['GET', '/auth/oauth/__proto__'],
  ])('answers 404 or 405 to %s %s', async (method, path) => {
    const res = await http()[method === 'GET' ? 'get' : 'post'](path);

    expect([404, 405]).toContain(res.status);
  });
});

describe('the providers answer', () => {
  it('is public, holds exactly two booleans, and holds no key', async () => {
    const res = await http().get('/auth/providers');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['apple', 'google']);
    expect(JSON.stringify(res.body)).not.toMatch(/google-secret|google-client/);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('is the same on a second call', async () => {
    const one = await http().get('/auth/providers');
    const two = await http().get('/auth/providers');

    expect(two.body).toEqual(one.body);
  });

  it('shows only Google when only Google is configured', async () => {
    const onlyGoogle = await boot(
      oauthSettings('test', {
        GOOGLE_CLIENT_ID: 'g',
        GOOGLE_CLIENT_SECRET: 's',
        GOOGLE_ISSUER: stub.issuer,
        PUBLIC_WEB_URL: WEB,
      }),
    );
    try {
      const res = await request(onlyGoogle.getHttpServer()).get(
        '/auth/providers',
      );
      const apple = await request(onlyGoogle.getHttpServer()).get(
        '/auth/oauth/apple',
      );
      const callbackApple = await request(onlyGoogle.getHttpServer())
        .post('/auth/oauth/apple/callback')
        .type('form')
        .send({ code: 'x', state: 'y' });

      expect(res.body).toEqual({ apple: false, google: true });
      expect(apple.status).toBe(404);
      // Every return redirects, even for a provider not configured.
      expect(callbackApple.status).toBe(302);
      expect(callbackApple.headers['location']).toBe(
        '/ro/sign-in/return?provider=apple&result=failed',
      );
    } finally {
      await onlyGoogle.close();
    }
  });
});

describe('starting a flow with hostile query values', () => {
  it.each([
    ['an unknown language', 'language=fr&remember=true'],
    ['a path-like language', 'language=../../evil&remember=true'],
    ['a protocol-relative language', 'language=//evil.test&remember=true'],
    ['a url-encoded language', 'language=%2F%2Fevil.test&remember=true'],
    ['a missing language', 'remember=true'],
    ['an empty query', ''],
    ['a repeated language', 'language=ro&language=//evil.test&remember=true'],
    ['a non-boolean remember', 'language=en&remember=maybe'],
    ['a repeated remember', 'language=en&remember=true&remember=false'],
  ])(
    'never redirects the person anywhere but the sign-in return for %s',
    async (_, query) => {
      stub.next = ELENA;
      const res = await http().get(`/auth/oauth/google?${query}`);
      if (res.status === 400)
        return expect(res.body.code ?? res.body).toBeDefined();
      expect(res.status).toBe(302);
      const flow = cookie(res, 'mf_oauth') ?? '';
      const { code, state } = await approve(new URL(res.headers['location']));

      const done = await callback('google', { code, state }, flow);

      expect(done.status).toBe(302);
      const to = new URL(done.headers['location'], WEB);
      expect(to.origin).toBe(WEB);
      expect(to.pathname).toMatch(/^\/(ro|en)\/sign-in\/return$/);
    },
  );

  it('carries the English language through to the return', async () => {
    const res = await continueWith(
      'google',
      ELENA,
      {},
      'language=en&remember=false',
    );

    expect(back(res).pathname).toBe('/en/sign-in/return');
  });

  it('keeps the flow cookie under ten minutes and scoped to the oauth routes', async () => {
    const res = await http().get(
      '/auth/oauth/google?language=ro&remember=true',
    );
    const line = cookieLine(res, 'mf_oauth');

    expect(line).toMatch(/Path=\/api\/v1\/auth\/oauth(;|$)/);
    const age = /Max-Age=(\d+)/i.exec(line);
    if (age) expect(Number(age[1])).toBeLessThanOrEqual(600);
    else expect(line).toMatch(/Expires=/i);
  });

  it('keeps the flow on the server for no more than ten minutes', async () => {
    await http().get('/auth/oauth/google?language=ro&remember=true');

    const keys = await redis.keys('auth:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    }
  });

  it('never puts the PKCE verifier in the authorisation address', async () => {
    const { location } = await start('google');
    const challenge = location.searchParams.get('code_challenge') ?? '';

    expect(challenge).toHaveLength(43);
    expect(location.search).not.toMatch(/code_verifier/);
  });
});

describe('forged and mismatched returns', () => {
  it("refuses a return whose state is a valid flow other than the cookie's", async () => {
    stub.next = ELENA;
    const mine = await start('google');
    const theirs = await start('google');
    const theirApproval = await approve(theirs.location);

    const res = await callback('google', theirApproval, mine.flow);

    expect(resultOf(res)).toBe('failed');
    expect(await prisma.account.count()).toBe(0);
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
  });

  it('refuses a return whose query state was tampered with', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);

    const res = await callback('google', { code, state: `${state}x` }, flow);

    expect(resultOf(res)).toBe('failed');
  });

  it('refuses a return with no state at all', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code } = await approve(location);

    const res = await callback('google', { code }, flow);

    expect(resultOf(res)).toBe('failed');
  });

  it('refuses a return with no code', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { state } = await approve(location);

    const res = await callback('google', { state }, flow);

    expect(resultOf(res)).toBe('failed');
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses a return with repeated state parameters', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);

    const res = await http()
      .get(
        `/auth/oauth/google/callback?code=${code}&state=${state}&state=other`,
      )
      .set('Cookie', `mf_oauth=${flow}`);

    expect(resultOf(res)).toBe('failed');
  });

  it('refuses a return with an empty state and an empty cookie', async () => {
    const res = await http()
      .get('/auth/oauth/google/callback?code=x&state=')
      .set('Cookie', 'mf_oauth=');

    expect(resultOf(res)).toBe('failed');
    expect(back(res).pathname).toBe('/ro/sign-in/return');
  });

  it('refuses a return whose state is unicode', async () => {
    const res = await callback('google', { code: 'x', state: 'é😀' }, 'plain');

    expect(resultOf(res)).toBe('failed');
  });

  it('consumes the flow even when the exchange fails, so a retry cannot reuse it', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);
    stub.fault = 'down';
    expect(resultOf(await callback('google', { code, state }, flow))).toBe(
      'failed',
    );
    stub.fault = null;

    const retry = await callback('google', { code, state }, flow);

    expect(resultOf(retry)).toBe('failed');
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses a return after the stored flow expired', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);
    await redis.del(...(await redis.keys('auth:*')));

    const res = await callback('google', { code, state }, flow);

    expect(resultOf(res)).toBe('failed');
  });

  it('lets exactly one of two simultaneous returns for one flow through', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);

    const results = await Promise.all([
      callback('google', { code, state }, flow),
      callback('google', { code, state }, flow),
    ]);

    expect(results.map(resultOf).sort()).toEqual(['consent', 'failed']);
  });

  it('answers a refusal with a repeated error parameter without signing anyone in', async () => {
    stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);

    const res = await callback(
      'google',
      { code, error: 'server_error', state },
      flow,
    );

    expect(resultOf(res)).toBe('failed');
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(await prisma.account.count()).toBe(0);
  });

  it('treats an unknown provider error as failed, not cancelled', async () => {
    const { flow, location } = await start('google');
    const { state } = await approve(location);

    const res = await callback(
      'google',
      { error: 'temporarily_unavailable', state },
      flow,
    );

    expect(resultOf(res)).toBe('failed');
  });

  it('never leaves a token, code or e-mail in the return address', async () => {
    const res = await continueWith('google', ELENA);

    const to = back(res);
    expect([...to.searchParams.keys()].sort()).toEqual(['provider', 'result']);
    expect(to.href).not.toContain('elena');
  });
});

describe('the identity match', () => {
  it('matches the provider e-mail ignoring case, and links once', async () => {
    const id = await existing('andrei@gmail.com');

    const res = await continueWith('google', {
      email: 'ANDREI@GMAIL.COM',
      email_verified: true,
      sub: 'g-1',
    });

    expect(resultOf(res)).toBe('signed-in');
    expect(
      await prisma.accountIdentity.count({
        where: { accountId: id, method: 'google' },
      }),
    ).toBe(1);
  });

  it('signing in twice by the same e-mail links once and records one audit entry', async () => {
    const id = await existing('andrei@gmail.com');
    const person = {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'g-1',
    };

    await continueWith('google', person);
    const second = await continueWith('google', person);

    expect(resultOf(second)).toBe('signed-in');
    expect(
      await prisma.accountIdentity.count({ where: { method: 'google' } }),
    ).toBe(1);
    expect(
      await prisma.activityLog.count({
        where: { field: 'identity', subjectId: id },
      }),
    ).toBe(1);
  });

  it('does not link when the provider says the e-mail is the string "false"', async () => {
    await existing('andrei@gmail.com');

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: 'false',
      sub: 'g-1',
    });

    expect(resultOf(res)).toBe('email_taken');
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(
      await prisma.accountIdentity.count({ where: { method: 'google' } }),
    ).toBe(0);
  });

  it('answers email_taken for an unverified e-mail another account holds, and keeps nothing', async () => {
    await existing('andrei@gmail.com');

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      sub: 'g-2',
    });

    expect(resultOf(res)).toBe('email_taken');
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(await prisma.account.count()).toBe(1);
  });

  it('does not sign Apple in to an account that only holds the same subject string at Google', async () => {
    const id = await existing('andrei@gmail.com', {
      method: 'google',
      subject: 'shared-sub',
    });

    const res = await continueWith('apple', {
      email: 'someone@else.test',
      email_verified: 'true',
      sub: 'shared-sub',
    });

    expect(resultOf(res)).toBe('consent');
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(
      await prisma.accountIdentity.count({ where: { accountId: id } }),
    ).toBe(1);
  });

  it('matches a unicode subject on the second sign-in', async () => {
    const id = await existing('andrei@gmail.com', {
      method: 'google',
      subject: 'ünï-😀-sub',
    });

    const res = await continueWith('google', {
      email: 'other@example.test',
      email_verified: true,
      sub: 'ünï-😀-sub',
    });

    expect(resultOf(res)).toBe('signed-in');
    expect(await prisma.account.count()).toBe(1);
    expect(
      await prisma.accountIdentity.count({ where: { accountId: id } }),
    ).toBe(1);
  });

  it('answers a very long subject without a server error', async () => {
    const res = await continueWith('google', {
      ...ELENA,
      sub: 's'.repeat(5000),
    });

    expect(res.status).toBe(302);
    expect(['consent', 'failed']).toContain(resultOf(res));
  });

  it('answers a verified e-mail that is not an address without a server error', async () => {
    const res = await continueWith('google', {
      ...ELENA,
      email: 'not an address',
      sub: 'weird-1',
    });

    expect(res.status).toBe(302);
  });

  it('refreshes the session of a signed-in return with an HttpOnly Secure cookie', async () => {
    await existing('andrei@gmail.com', { method: 'google', subject: 'g-1' });

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'g-1',
    });

    const line = cookieLine(res, 'mf_refresh');
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
  });

  it('keeps the person signed out of every other account when the same subject returns concurrently', async () => {
    await existing('andrei@gmail.com');
    const person = {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'g-race',
    };
    stub.next = person;
    const one = await start('google');
    const two = await start('google');
    const a = await approve(one.location);
    const b = await approve(two.location);

    const results = await Promise.all([
      callback('google', a, one.flow),
      callback('google', b, two.flow),
    ]);

    expect(results.map(resultOf)).toEqual(['signed-in', 'signed-in']);
    expect(
      await prisma.accountIdentity.count({ where: { method: 'google' } }),
    ).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });
});

describe("Apple's user field", () => {
  it.each([
    ['not JSON', 'not json'],
    ['a JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON string', '"Elena"'],
    ['a name that is a string', '{"name":"Elena"}'],
    ['names that are numbers', '{"name":{"firstName":1,"lastName":2}}'],
    ['names that are objects', '{"name":{"firstName":{},"lastName":[]}}'],
    ['an empty object', '{}'],
    [
      'a huge name',
      JSON.stringify({ name: { firstName: 'A'.repeat(100_000) } }),
    ],
  ])('still reaches the terms step when the field is %s', async (_, user) => {
    const res = await continueWith(
      'apple',
      { email: 'a@example.test', email_verified: 'true', sub: 'apple-1' },
      { user },
    );

    expect(res.status).toBe(302);
    expect(resultOf(res)).toBe('consent');
    expect(await prisma.account.count()).toBe(0);
  });

  it('never lets the posted field replace the verified e-mail or the subject', async () => {
    const pending = await pendingFor(
      { email: 'real@example.test', email_verified: 'true', sub: 'apple-real' },
      'apple',
      {
        user: JSON.stringify({
          email: 'victim@example.test',
          name: { firstName: 'Mal', lastName: 'Ory' },
          sub: 'apple-victim',
        }),
      },
    );

    const read = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', `mf_oauth_pending=${pending}`);

    expect(read.body.email).toBe('real@example.test');
    const created = await complete(pending, { ...GOOD_BODY, name: 'Mal Ory' });
    expect(created.status).toBe(201);
    const account = await prisma.account.findFirstOrThrow({
      include: { identities: true },
    });
    expect(account.email).toBe('real@example.test');
    expect(account.identities[0].subject).toBe('apple-real');
  });

  it('keeps a unicode name from the field exactly', async () => {
    const pending = await pendingFor(
      { email: 'a@example.test', email_verified: 'true', sub: 'apple-2' },
      'apple',
      {
        user: JSON.stringify({
          name: { firstName: 'Ștefan', lastName: 'Țurcanu' },
        }),
      },
    );

    const read = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', `mf_oauth_pending=${pending}`);

    expect(read.body.name).toBe('Ștefan Țurcanu');
  });
});

describe('reading the pending sign-up', () => {
  it('answers 404 without a cookie, with an empty cookie, and with a made-up one', async () => {
    const none = await http().get('/auth/oauth/pending');
    const empty = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', 'mf_oauth_pending=');
    const made = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', 'mf_oauth_pending=made-up');

    expect([none.status, empty.status, made.status]).toEqual([404, 404, 404]);
  });

  it('does not use the sign-up up by being read', async () => {
    const pending = await pendingFor();
    const read = () =>
      http()
        .get('/auth/oauth/pending')
        .set('Cookie', `mf_oauth_pending=${pending}`);

    const one = await read();
    const two = await read();

    expect([one.status, two.status]).toEqual([200, 200]);
    expect(two.body).toEqual(one.body);
  });

  it('answers only provider, name and e-mail', async () => {
    const pending = await pendingFor();

    const read = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', `mf_oauth_pending=${pending}`);

    expect(Object.keys(read.body).sort()).toEqual([
      'email',
      'name',
      'provider',
    ]);
  });

  it('answers nothing once it expired', async () => {
    const pending = await pendingFor();
    await redis.del(...(await redis.keys('auth:*')));

    const read = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', `mf_oauth_pending=${pending}`);

    expect(read.status).toBe(404);
  });

  it('is bound to the browser by an HttpOnly Secure cookie scoped to the oauth routes for under ten minutes', async () => {
    const res = await continueWith('google', ELENA);
    const line = cookieLine(res, 'mf_oauth_pending');

    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/Path=\/api\/v1\/auth\/oauth(;|$)/);
    const age = /Max-Age=(\d+)/i.exec(line);
    if (age) expect(Number(age[1])).toBeLessThanOrEqual(600);
  });
});

describe('completing the sign-up with hostile bodies', () => {
  it.each([
    ['a one-character name', { name: 'E' }],
    ['an 81-character name', { name: 'E'.repeat(81) }],
    ['a whitespace-only name', { name: '     ' }],
    ['a name with a control character', { name: 'Elena\u0007Pop' }],
    ['a name with a newline', { name: 'Elena\nPop' }],
    ['a numeric name', { name: 42 }],
    ['a null name', { name: null }],
    ['no name', { name: undefined }],
    ['an unknown language', { language: 'fr' }],
    ['a null language', { language: null }],
    ['no language', { language: undefined }],
    ['a role field asking for admin', { role: 'admin' }],
    ['a roles field asking for admin', { roles: ['admin'] }],
    ['an email field', { email: 'victim@example.test' }],
    [
      'an identity field',
      { identity: { method: 'google', subject: 'victim' } },
    ],
    ['a method field', { method: 'password' }],
  ])('refuses %s with a 400 and creates nothing', async (_, patch) => {
    const pending = await pendingFor();

    const res = await complete(pending, { ...GOOD_BODY, ...patch });

    expect(res.status).toBe(400);
    expect(await prisma.account.count()).toBe(0);
  });

  it.each([
    ['two characters', 'El'],
    ['eighty characters', 'E'.repeat(80)],
    ['a padded name, trimmed', '  Elena Pop  '],
  ])('accepts a name of %s', async (_, name) => {
    const pending = await pendingFor();

    const res = await complete(pending, { ...GOOD_BODY, name });

    expect(res.status).toBe(201);
    expect((await prisma.account.findFirstOrThrow()).name).toBe(name.trim());
  });

  it.each([
    [
      'an old terms version',
      { ...CURRENT_CONSENT, termsVersion: '2001-01-01' },
    ],
    [
      'an old privacy version',
      { ...CURRENT_CONSENT, privacyVersion: '2001-01-01' },
    ],
    ['an empty consent', {}],
    ['a null consent', null],
    ['a consent with empty versions', { privacyVersion: '', termsVersion: '' }],
    ['a consent with numbers', { privacyVersion: 1, termsVersion: 1 }],
    [
      'a consent with a trailing space',
      { ...CURRENT_CONSENT, termsVersion: `${CURRENT_CONSENT.termsVersion} ` },
    ],
  ])('refuses %s and creates nothing', async (_, consent) => {
    const pending = await pendingFor();

    const res = await complete(pending, { ...GOOD_BODY, consent });

    expect(res.status).toBe(400);
    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.accountConsent.count()).toBe(0);
  });

  it('answers consent_required for an out-of-date terms version', async () => {
    const pending = await pendingFor();

    const res = await complete(pending, {
      ...GOOD_BODY,
      consent: { ...CURRENT_CONSENT, termsVersion: '2001-01-01' },
    });

    expect(res.body.code).toBe('consent_required');
  });

  it.each([
    ['an array body', []],
    ['a string body', 'Elena'],
    ['a null body', null],
    ['an empty body', {}],
  ])('refuses %s', async (_, body) => {
    const pending = await pendingFor();

    const res = await http()
      .post('/auth/oauth/complete')
      .set('Cookie', `mf_oauth_pending=${pending}`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

    expect(res.status).toBe(400);
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses malformed JSON', async () => {
    const pending = await pendingFor();

    const res = await http()
      .post('/auth/oauth/complete')
      .set('Cookie', `mf_oauth_pending=${pending}`)
      .set('Content-Type', 'application/json')
      .send('{"name":');

    expect(res.status).toBe(400);
  });

  it('refuses a body sent as text', async () => {
    const pending = await pendingFor();

    const res = await http()
      .post('/auth/oauth/complete')
      .set('Cookie', `mf_oauth_pending=${pending}`)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(GOOD_BODY));

    expect(res.status).toBe(415);
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses a body that is a UTF-16 encoded JSON document', async () => {
    const pending = await pendingFor();

    const res = await http()
      .post('/auth/oauth/complete')
      .set('Cookie', `mf_oauth_pending=${pending}`)
      .set('Content-Type', 'application/json; charset=utf-16le')
      .send(Buffer.from(JSON.stringify(GOOD_BODY), 'utf16le'));

    expect([400, 415]).toContain(res.status);
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses a multi-megabyte body without creating anything', async () => {
    const pending = await pendingFor();

    const res = await complete(pending, {
      ...GOOD_BODY,
      name: 'E'.repeat(5_000_000),
    });

    expect([400, 413]).toContain(res.status);
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses without a cookie, with the code provider_failed', async () => {
    const res = await complete(undefined, GOOD_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('provider_failed');
  });

  it('refuses once the pending sign-up expired', async () => {
    const pending = await pendingFor();
    await redis.del(...(await redis.keys('auth:*')));

    const res = await complete(pending, GOOD_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('provider_failed');
    expect(await prisma.account.count()).toBe(0);
  });

  it('refuses a flow cookie presented in place of the pending one', async () => {
    const { flow } = await start('google');

    const res = await complete(flow, GOOD_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('provider_failed');
  });

  it('creates exactly one account when two completions race', async () => {
    const pending = await pendingFor();

    const results = await Promise.all([
      complete(pending, GOOD_BODY),
      complete(pending, GOOD_BODY),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.account.count()).toBe(1);
    expect(await prisma.accountIdentity.count()).toBe(1);
    expect(await prisma.accountConsent.count()).toBe(2);
  });

  it('keeps the pending sign-up after an invalid body so the person can correct it', async () => {
    const pending = await pendingFor();
    await complete(pending, { ...GOOD_BODY, name: 'E' });

    const retry = await complete(pending, GOOD_BODY);

    expect(retry.status).toBe(201);
  });

  it('creates the account with exactly one role, driver, whatever extra fields it was sent', async () => {
    const pending = await pendingFor();

    await complete(pending, { ...GOOD_BODY, role: 'admin', roles: ['admin'] });
    const ok = await complete(pending, GOOD_BODY);

    expect(ok.status).toBe(201);
    const account = await prisma.account.findFirstOrThrow({
      include: { roles: true },
    });
    expect(account.roles.map((r) => r.role)).toEqual(['driver']);
  });

  it('answers email_taken and creates nothing when a password account took the e-mail meanwhile', async () => {
    const pending = await pendingFor();
    await existing('elena@example.test');

    const res = await complete(pending, GOOD_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_taken');
    expect(await prisma.account.count()).toBe(1);
    expect(
      await prisma.accountIdentity.count({ where: { method: 'google' } }),
    ).toBe(0);
  });

  it('keeps a person with no e-mail unlinked from any account on a later return', async () => {
    const first = await pendingFor({ name: 'No Mail', sub: 'g-nomail' });
    const created = await complete(first, { ...GOOD_BODY, name: 'No Mail' });
    expect(created.status).toBe(201);

    const again = await continueWith('google', {
      name: 'No Mail',
      sub: 'g-nomail',
    });

    expect(resultOf(again)).toBe('signed-in');
    expect(await prisma.account.count()).toBe(1);
  });

  it('signs a new person in for exactly the session their sign-up asked for', async () => {
    stub.next = ELENA;
    const started = await start('google', 'language=en&remember=false');
    const { code, state } = await approve(started.location);
    const res = await callback('google', { code, state }, started.flow);
    const pending = cookie(res, 'mf_oauth_pending') ?? '';

    const created = await complete(pending, { ...GOOD_BODY, language: 'en' });

    expect(created.status).toBe(201);
    expect(cookieLine(created, 'mf_refresh')).not.toMatch(/Max-Age=\d{6,}/);
  });
});
