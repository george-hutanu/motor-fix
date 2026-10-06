import { CURRENT_CONSENT, type OAuthProvider } from '@motor-fix/contracts';
import request from 'supertest';

import {
  approve,
  cookie,
  cookieLine,
  ELENA,
  oauthHarness,
  type StubPerson,
  WEB,
} from './openid-stub.testing';
import { oauthSettings } from './providers';
import type { Role } from '../capabilities';

let maintenance = false;
const h = oauthHarness(() => maintenance);
const { boot, callback, continueWith, existing, http, prisma, start } = h;

let auditEntries = 0;

beforeEach(async () => {
  maintenance = false;
  auditEntries = await prisma.activityLog.count();
});

const outcome = (res: request.Response) => {
  expect(res.status).toBe(302);
  const url = new URL(res.headers['location'], WEB);
  return {
    path: url.pathname,
    provider: url.searchParams.get('provider'),
    result: url.searchParams.get('result'),
  };
};

const roleOf = (accessToken: string) =>
  JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString())
    .role as Role;

async function renewedRole(res: request.Response) {
  const refresh = cookie(res, 'mf_refresh');
  expect(refresh).toBeTruthy();
  const renewed = await http()
    .post('/auth/refresh')
    .set('Cookie', `mf_refresh=${refresh}`)
    .send({});
  expect(renewed.status).toBe(200);
  return roleOf(renewed.body.accessToken);
}

describe('which providers are configured', () => {
  it('answers both when their keys are set', async () => {
    const res = await http().get('/auth/providers');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apple: true, google: true });
  });

  it('answers neither, and refuses to start, without keys', async () => {
    const bare = await boot(oauthSettings('test', {}));
    try {
      const providers = await request(bare.getHttpServer()).get(
        '/auth/providers',
      );
      const started = await request(bare.getHttpServer()).get(
        '/auth/oauth/google',
      );

      expect(providers.body).toEqual({ apple: false, google: false });
      expect(started.status).toBe(404);
    } finally {
      await bare.close();
    }
  });

  it('returns failed, not an error page, when the provider cannot be reached to start', async () => {
    const dead = await boot(
      oauthSettings('test', {
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        // Nothing listens on the discard port.
        GOOGLE_ISSUER: 'http://127.0.0.1:9',
        PUBLIC_WEB_URL: WEB,
      }),
    );
    try {
      const res = await request(dead.getHttpServer()).get(
        '/auth/oauth/google?language=en',
      );

      expect(outcome(res)).toEqual({
        path: '/en/sign-in/return',
        provider: 'google',
        result: 'failed',
      });
      expect(cookie(res, 'mf_oauth')).toBeUndefined();
    } finally {
      await dead.close();
    }
  });

  it('refuses a provider it does not know', async () => {
    const res = await http().get('/auth/oauth/facebook');

    expect(res.status).toBe(404);
  });
});

describe('starting the flow', () => {
  it('sends Google to its authorisation with a code, PKCE, state and nonce', async () => {
    const { flow, location, res } = await start('google');

    expect(location.origin).toBe(h.stub.issuer);
    expect(location.pathname).toBe('/authorize');
    const params = Object.fromEntries(location.searchParams);
    expect(params).toMatchObject({
      client_id: 'google-client',
      code_challenge_method: 'S256',
      redirect_uri: `${WEB}/api/v1/auth/oauth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
    });
    expect(params['state']).toMatch(/^[\w-]{32,}$/);
    expect(params['nonce']).toMatch(/^[\w-]{32,}$/);
    expect(params['code_challenge']).toMatch(/^[\w-]{43}$/);
    expect(flow).toBe(params['state']);
    const line = cookieLine(res, 'mf_oauth');
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=None/i);
    expect(line).toMatch(/Path=\/api\/v1\/auth\/oauth/);
  });

  it('asks Apple to post its answer back', async () => {
    const { location } = await start('apple');

    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('client_id')).toBe('ro.motorfix.web');
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${WEB}/api/v1/auth/oauth/apple/callback`,
    );
  });

  it('gives each flow its own state', async () => {
    const one = await start('google');
    const two = await start('google');

    expect(one.flow).not.toBe(two.flow);
  });
});

describe('a person with an account', () => {
  it('links Google to the account holding the verified e-mail, records it, and signs in', async () => {
    const id = await existing('andrei@gmail.com');

    const res = await continueWith('google', {
      email: 'Andrei@Gmail.com',
      email_verified: true,
      sub: 'google-andrei',
    });

    expect(outcome(res)).toEqual({
      path: '/ro/sign-in/return',
      provider: 'google',
      result: 'signed-in',
    });
    expect(
      await prisma.accountIdentity.findMany({
        select: { accountId: true, method: true, subject: true },
        where: { method: 'google' },
      }),
    ).toEqual([{ accountId: id, method: 'google', subject: 'google-andrei' }]);
    const linked = await prisma.activityLog.findMany({
      where: { field: 'identity', subjectId: id },
    });
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({ actorId: id, newValue: 'google' });
    expect(await renewedRole(res)).toBe('driver');
    const account = await prisma.account.findUniqueOrThrow({ where: { id } });
    expect(account.emailVerifiedAt).not.toBeNull();
  });

  it('signs in by the provider subject even after the e-mail changed', async () => {
    const id = await existing('andrei@gmail.com', ['driver'], {
      method: 'google',
      subject: 'google-andrei',
    });

    const res = await continueWith('google', {
      email: 'andrei.nou@gmail.com',
      email_verified: true,
      sub: 'google-andrei',
    });

    expect(outcome(res).result).toBe('signed-in');
    expect(await prisma.account.count()).toBe(1);
    expect(
      await prisma.accountIdentity.count({ where: { accountId: id } }),
    ).toBe(1);
  });

  it('opens the role used last, for a garage account through Apple', async () => {
    await existing('mihai@icloud.com', ['driver', 'garage']);
    await prisma.account.updateMany({ data: { lastRole: 'garage' } });

    const res = await continueWith('apple', {
      email: 'mihai@icloud.com',
      email_verified: 'true',
      sub: 'apple-mihai',
    });

    expect(outcome(res).result).toBe('signed-in');
    expect(await renewedRole(res)).toBe('garage');
  });

  it('keeps the session for the browser only when "keep me signed in" was off', async () => {
    await existing('andrei@gmail.com', ['driver'], {
      method: 'google',
      subject: 'g-1',
    });

    const res = await continueWith(
      'google',
      { email: 'andrei@gmail.com', email_verified: true, sub: 'g-1' },
      {},
      'language=ro&remember=false',
    );

    expect(outcome(res).result).toBe('signed-in');
    expect(cookieLine(res, 'mf_refresh')).not.toMatch(/Max-Age|Expires/i);
  });

  it('does not link to an account whose e-mail the provider has not verified', async () => {
    await existing('andrei@gmail.com');

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: false,
      sub: 'google-someone',
    });

    expect(outcome(res).result).toBe('email_taken');
    expect(
      await prisma.accountIdentity.count({ where: { method: 'google' } }),
    ).toBe(0);
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
  });

  it('does not link to an account whose own e-mail was never confirmed', async () => {
    const id = await existing(
      'andrei@gmail.com',
      ['driver'],
      { method: 'password', subject: 'andrei@gmail.com' },
      false,
    );

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'google-andrei',
    });

    expect(outcome(res).result).toBe('email_taken');
    expect(
      await prisma.accountIdentity.count({ where: { method: 'google' } }),
    ).toBe(0);
    const account = await prisma.account.findUniqueOrThrow({ where: { id } });
    expect(account.emailVerifiedAt).toBeNull();
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
  });

  it('refuses a suspended account', async () => {
    await existing('andrei@gmail.com', ['driver'], {
      method: 'google',
      subject: 'g-1',
    });
    await prisma.account.updateMany({ data: { status: 'suspended' } });

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'g-1',
    });

    expect(outcome(res).result).toBe('suspended');
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
  });

  it('refuses a deleted account and creates nothing in its place', async () => {
    await existing('andrei@gmail.com', ['driver'], {
      method: 'google',
      subject: 'g-1',
    });
    await prisma.account.updateMany({ data: { status: 'deleted' } });

    const res = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'g-1',
    });

    expect(outcome(res).result).toBe('failed');
    expect(await prisma.account.count()).toBe(1);
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
  });

  it('comes back in the language the flow started in', async () => {
    await existing('andrei@gmail.com', ['driver'], {
      method: 'google',
      subject: 'g-1',
    });

    const res = await continueWith(
      'google',
      { email: 'andrei@gmail.com', email_verified: true, sub: 'g-1' },
      {},
      'language=en&remember=true',
    );

    expect(outcome(res).path).toBe('/en/sign-in/return');
  });
});

describe('maintenance', () => {
  it('refuses an account without admin, and lets an admin in', async () => {
    await existing('andrei@gmail.com', ['driver'], {
      method: 'google',
      subject: 'g-1',
    });
    await existing('admin@example.test', ['admin'], {
      method: 'google',
      subject: 'g-admin',
    });
    maintenance = true;

    const driver = await continueWith('google', {
      email: 'andrei@gmail.com',
      email_verified: true,
      sub: 'g-1',
    });
    const admin = await continueWith('google', {
      email: 'admin@example.test',
      email_verified: true,
      sub: 'g-admin',
    });

    expect(outcome(driver).result).toBe('maintenance');
    expect(cookie(driver, 'mf_refresh')).toBeUndefined();
    expect(outcome(admin).result).toBe('signed-in');
  });

  it('keeps no sign-up for a new person', async () => {
    maintenance = true;

    const res = await continueWith('google', ELENA);

    expect(outcome(res).result).toBe('maintenance');
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
    expect(await prisma.account.count()).toBe(0);
  });
});

describe('a new person', () => {
  async function pendingFrom(
    person: StubPerson,
    provider: OAuthProvider = 'google',
    extra = {},
  ) {
    const res = await continueWith(provider, person, extra);
    expect(outcome(res).result).toBe('consent');
    const pending = cookie(res, 'mf_oauth_pending') ?? '';
    expect(pending).toBeTruthy();
    expect(cookieLine(res, 'mf_oauth_pending')).toMatch(/HttpOnly/i);
    return pending;
  }

  const complete = (pending: string, body: Record<string, unknown>) =>
    http()
      .post('/auth/oauth/complete')
      .set('Cookie', `mf_oauth_pending=${pending}`)
      .send({
        consent: CURRENT_CONSENT,
        language: 'ro',
        name: 'Elena Pop',
        ...body,
      });

  it('creates nothing before the terms step', async () => {
    const pending = await pendingFrom(ELENA);

    expect(await prisma.account.count()).toBe(0);
    const read = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', `mf_oauth_pending=${pending}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({
      email: 'elena@example.test',
      name: 'Elena Pop',
      provider: 'google',
    });
  });

  it('creates a driver account with the Google identity, verified e-mail, consent and event, and signs in', async () => {
    const pending = await pendingFrom(ELENA);

    const res = await complete(pending, {});

    expect(res.status).toBe(201);
    expect(roleOf(res.body.accessToken)).toBe('driver');
    expect(cookie(res, 'mf_refresh')).toBeTruthy();
    const account = await prisma.account.findUniqueOrThrow({
      include: { consents: true, identities: true, roles: true },
      where: { email: 'elena@example.test' },
    });
    expect(account.roles.map((r) => r.role)).toEqual(['driver']);
    expect(
      account.identities.map(({ method, subject }) => ({ method, subject })),
    ).toEqual([{ method: 'google', subject: 'google-elena' }]);
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(account.name).toBe('Elena Pop');
    expect(account.consents.map((c) => c.method)).toEqual(['google', 'google']);
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'account.created', subjectId: account.id },
    });
    expect(events.map((e) => e.payload)).toEqual([
      expect.objectContaining({ method: 'google', roles: ['driver'] }),
    ]);
    expect(await prisma.activityLog.count()).toBeGreaterThan(auditEntries);
  });

  it("takes the name the person typed over the provider's", async () => {
    const pending = await pendingFrom(ELENA);

    await complete(pending, { name: 'Elena Maria Pop' });

    expect((await prisma.account.findFirstOrThrow()).name).toBe(
      'Elena Maria Pop',
    );
  });

  it('refuses without the current consent and creates nothing', async () => {
    const pending = await pendingFrom(ELENA);

    const res = await complete(pending, { consent: undefined });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('consent_required');
    expect(await prisma.account.count()).toBe(0);
  });

  it('uses the pending sign-up up: a second completion is refused', async () => {
    const pending = await pendingFrom(ELENA);
    await complete(pending, {});

    const again = await complete(pending, {});

    expect(again.status).toBe(400);
    expect(again.body.code).toBe('provider_failed');
    expect(await prisma.account.count()).toBe(1);
  });

  it('refuses a completion without a pending sign-up', async () => {
    const res = await complete('not-a-pending-sign-up', {});
    const none = await http().get('/auth/oauth/pending');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('provider_failed');
    expect(none.status).toBe(404);
  });

  it('refuses a completion sent as a form', async () => {
    const pending = await pendingFrom(ELENA);

    const res = await http()
      .post('/auth/oauth/complete')
      .set('Cookie', `mf_oauth_pending=${pending}`)
      .type('form')
      .send({ language: 'ro', name: 'Elena Pop' });

    expect(res.status).toBe(415);
    expect(await prisma.account.count()).toBe(0);
  });

  it('answers maintenance when it started meanwhile', async () => {
    const pending = await pendingFrom(ELENA);
    maintenance = true;

    const res = await complete(pending, {});

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('maintenance');
    expect(await prisma.account.count()).toBe(0);
  });

  it('answers email_taken when the e-mail was taken meanwhile', async () => {
    const pending = await pendingFrom({ ...ELENA, email_verified: false });
    await existing('elena@example.test');

    const res = await complete(pending, {});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_taken');
    expect(await prisma.account.count()).toBe(1);
  });

  it('keeps an e-mail the provider has not verified, unverified', async () => {
    const pending = await pendingFrom({ ...ELENA, email_verified: false });

    await complete(pending, {});

    expect(
      (await prisma.account.findFirstOrThrow()).emailVerifiedAt,
    ).toBeNull();
  });

  it('creates the account without an e-mail when the provider gives none', async () => {
    const pending = await pendingFrom({ name: 'Elena Pop', sub: 'google-x' });

    const res = await complete(pending, {});

    expect(res.status).toBe(201);
    expect((await prisma.account.findFirstOrThrow()).email).toBeNull();
  });

  it("takes Apple's name from its first answer and keeps a hidden-e-mail relay address", async () => {
    const pending = await pendingFrom(
      {
        email: 'x7k2@privaterelay.appleid.com',
        email_verified: 'true',
        sub: 'apple-ana',
      },
      'apple',
      {
        user: JSON.stringify({
          name: { firstName: 'Ana', lastName: 'Ionescu' },
        }),
      },
    );

    const read = await http()
      .get('/auth/oauth/pending')
      .set('Cookie', `mf_oauth_pending=${pending}`);
    expect(read.body).toEqual({
      email: 'x7k2@privaterelay.appleid.com',
      name: 'Ana Ionescu',
      provider: 'apple',
    });
    const res = await complete(pending, { name: 'Ana Ionescu' });
    expect(res.status).toBe(201);
    const account = await prisma.account.findFirstOrThrow({
      include: { identities: true },
    });
    expect(account.email).toBe('x7k2@privaterelay.appleid.com');
    expect(account.identities[0]).toMatchObject({
      method: 'apple',
      subject: 'apple-ana',
    });
  });

  it('pays Apple with a client secret signed by its key', async () => {
    await continueWith('apple', {
      email: 'a@example.test',
      email_verified: 'true',
      sub: 'apple-a',
    });

    const secret = h.stub.lastTokenRequest?.get('client_secret') ?? '';
    const [header, claims] = secret
      .split('.')
      .slice(0, 2)
      .map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(claims).toMatchObject({
      aud: h.stub.issuer,
      iss: 'TEAM123',
      sub: 'ro.motorfix.web',
    });
    expect(h.stub.lastTokenRequest?.get('code_verifier')).toBeTruthy();
  });
});

describe('cancel and failure', () => {
  it('returns cancelled when the person declines at Google', async () => {
    const { flow, location } = await start('google');

    const res = await callback(
      'google',
      {
        error: 'access_denied',
        state: location.searchParams.get('state') ?? '',
      },
      flow,
    );

    expect(outcome(res).result).toBe('cancelled');
    expect(await prisma.account.count()).toBe(0);
  });

  it("returns cancelled when the person closes Apple's page", async () => {
    const { flow, location } = await start('apple');

    const res = await callback(
      'apple',
      {
        error: 'user_cancelled_authorize',
        state: location.searchParams.get('state') ?? '',
      },
      flow,
    );

    expect(outcome(res)).toMatchObject({
      provider: 'apple',
      result: 'cancelled',
    });
  });

  it.each([
    ['the provider is down', 'down'],
    ['the ID token is signed with another key', 'other-key'],
    ["the nonce is not the flow's", 'wrong-nonce'],
    ['the token is for another client', 'wrong-audience'],
  ] as const)('returns failed when %s', async (_, fault) => {
    h.stub.fault = fault;

    const res = await continueWith('google', ELENA);

    expect(outcome(res).result).toBe('failed');
    expect(cookie(res, 'mf_refresh')).toBeUndefined();
    expect(cookie(res, 'mf_oauth_pending')).toBeUndefined();
    expect(await prisma.account.count()).toBe(0);
  });

  it('reads the published keys again when the token names a new one', async () => {
    await continueWith('google', ELENA);
    h.stub.fault = 'rotated';
    h.stub.keyReads = 0;

    const res = await continueWith('google', { ...ELENA, sub: 'google-other' });

    expect(outcome(res).result).toBe('consent');
    expect(h.stub.keyReads).toBe(1);
  });

  it("returns failed without the browser's flow cookie", async () => {
    h.stub.next = ELENA;
    const { location } = await start('google');
    const { code, state } = await approve(location);

    const res = await callback('google', { code, state }, undefined);

    expect(outcome(res).result).toBe('failed');
  });

  it('returns failed, in Romanian, for a state the server never issued', async () => {
    const res = await callback(
      'google',
      { code: 'x', state: 'forged' },
      'forged',
    );

    expect(outcome(res)).toEqual({
      path: '/ro/sign-in/return',
      provider: 'google',
      result: 'failed',
    });
  });

  it('returns failed for a flow used a second time', async () => {
    h.stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);
    await callback('google', { code, state }, flow);

    const again = await callback('google', { code, state }, flow);

    expect(outcome(again).result).toBe('failed');
  });

  it('returns failed for a Google flow brought back to the Apple address', async () => {
    h.stub.next = ELENA;
    const { flow, location } = await start('google');
    const { code, state } = await approve(location);

    const res = await callback('apple', { code, state }, flow);

    expect(outcome(res).result).toBe('failed');
  });

  it('clears the flow cookie whatever the outcome', async () => {
    const res = await callback(
      'google',
      { code: 'x', state: 'forged' },
      'forged',
    );

    expect(cookieLine(res, 'mf_oauth')).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});
