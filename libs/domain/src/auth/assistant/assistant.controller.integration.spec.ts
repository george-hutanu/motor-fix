// @traces 365-FR-013
// @traces 365-FR-017
import { randomUUID } from 'node:crypto';

import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { jwtVerify } from 'jose';
import request from 'supertest';

import { ASSISTANT_THROTTLE, type AssistantBroker } from './assistant.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
} from '../../notifications/notifications.testing';
import { AddressThrottle } from '../../rate-limit/address-throttle';
import { signAccessToken } from '../access-token';
import { AuthModule } from '../auth.module';
import { serialDatabase } from '../serial-db.testing';

const redisUrl = redisUrlFor(1);
const tokenSecret = 'test-secret';
const BROKER: AssistantBroker = {
  clientId: 'motorfix-broker',
  clientSecret: 'broker-secret-0123456789abcdef',
  redirectUri:
    'https://id.motorfix.test/realms/motorfix-assistants/broker/motorfix/endpoint',
  webUrl: 'https://motorfix.test',
};
const THROTTLE_LIMIT = 10;
const { prisma, reset, account } = fixtures();
serialDatabase(databaseUrl);

const redis = new Redis(redisUrl);
let throttleKey = '';
let app: NestExpressApplication;
const logged: string[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AuthModule.register({
        assistant: BROKER,
        databaseUrl,
        redisUrl,
        tokenSecret,
      }),
    ],
  })
    .overrideProvider(ASSISTANT_THROTTLE)
    .useFactory({
      factory: () =>
        new AddressThrottle(redis, {
          get key() {
            return throttleKey;
          },
          limit: THROTTLE_LIMIT,
          name: 'AssistantSignIn',
          windowSeconds: 60,
        }),
    })
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 'loopback');
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  // Listening, so concurrent calls share one server.
  await app.listen(0, '127.0.0.1');
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args) => {
      logged.push(JSON.stringify(args));
    });
  }
});

beforeEach(async () => {
  await reset();
  throttleKey = `test:assistant:${randomUUID()}`;
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
  await prisma.$disconnect();
});

const http = () => request(app.getHttpServer());

const authorize = (overrides: Record<string, string | undefined> = {}) => {
  const query = Object.fromEntries(
    Object.entries({
      client_id: BROKER.clientId,
      nonce: 'nonce-1',
      redirect_uri: BROKER.redirectUri,
      response_type: 'code',
      scope: 'openid',
      state: 'state-1',
      ...overrides,
    }).filter(([, value]) => value !== undefined),
  );
  return http().get('/api/v1/auth/assistant/authorize').query(query);
};

async function handOff() {
  const res = await authorize();
  return (
    new URL(res.headers['location'] ?? '').searchParams.get('request') ?? ''
  );
}

const bearer = (accountId: string) =>
  `Bearer ${signAccessToken({ accountId, role: 'driver' }, tokenSecret)}`;

async function approvedCode(accountId: string) {
  const signed = await handOff();
  const res = await http()
    .post('/api/v1/auth/assistant/approve')
    .set('authorization', bearer(accountId))
    .send({ request: signed });
  expect(res.status).toBe(200);
  return {
    code: new URL(res.body.redirect).searchParams.get('code') ?? '',
    redirect: res.body.redirect as string,
  };
}

const exchange = (fields: Record<string, string | undefined>) =>
  http()
    .post('/api/v1/auth/assistant/token')
    .type('form')
    .send(
      Object.fromEntries(
        Object.entries({
          client_id: BROKER.clientId,
          client_secret: BROKER.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: BROKER.redirectUri,
          ...fields,
        }).filter(([, value]) => value !== undefined),
      ),
    );

describe('GET /api/v1/auth/assistant/authorize', () => {
  it('sends the browser to the web connect route without a session', async () => {
    const res = await authorize();

    expect(res.status).toBe(302);
    const location = new URL(res.headers['location'] ?? '');
    expect(`${location.origin}${location.pathname}`).toBe(
      'https://motorfix.test/app/assistant/connect',
    );
    expect(location.searchParams.get('request')).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it('takes the extra parameters the identity server adds', async () => {
    const res = await authorize({ prompt: 'login', ui_locales: 'ro' });

    expect(res.status).toBe(302);
  });

  it.each([
    ['another client', { client_id: 'someone-else' }, 'invalid_client'],
    [
      'another redirect address',
      { redirect_uri: 'https://evil.test/cb' },
      'invalid_client',
    ],
    [
      'another response type',
      { response_type: 'token' },
      'unsupported_response_type',
    ],
    ['no state', { state: undefined }, 'invalid_request'],
    ['no nonce', { nonce: undefined }, 'invalid_request'],
  ])('refuses %s with a problem', async (_, overrides, code) => {
    const res = await authorize(overrides);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code });
    expect(res.headers['location']).toBeUndefined();
  });
});

describe('POST /api/v1/auth/assistant/approve', () => {
  it('needs a session', async () => {
    const signed = await handOff();
    const res = await http()
      .post('/api/v1/auth/assistant/approve')
      .send({ request: signed });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
  });

  it('answers the stored redirect address and binds the code to the approving account', async () => {
    const accountId = await account('Andrei');

    const { code, redirect } = await approvedCode(accountId);

    const url = new URL(redirect);
    expect(`${url.origin}${url.pathname}`).toBe(BROKER.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-1');
    const rows = await prisma.assistantSignInCode.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId, clientId: BROKER.clientId });
    expect(rows[0]?.codeHash).not.toBe(code);
  });

  it('refuses a tampered request', async () => {
    const accountId = await account('Andrei');
    const signed = await handOff();

    const res = await http()
      .post('/api/v1/auth/assistant/approve')
      .set('authorization', bearer(accountId))
      .send({ request: `x${signed}` });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'invalid_request' });
    expect(await prisma.assistantSignInCode.count()).toBe(0);
  });

  it('refuses a body with other fields', async () => {
    const accountId = await account('Andrei');
    const signed = await handOff();

    const res = await http()
      .post('/api/v1/auth/assistant/approve')
      .set('authorization', bearer(accountId))
      .send({ redirect: 'https://evil.test/cb', request: signed });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/assistant/token', () => {
  it('exchanges the code for an id token of the approving account', async () => {
    const accountId = await account('Andrei');
    const { code } = await approvedCode(accountId);

    const res = await exchange({ code });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ expires_in: 300, token_type: 'Bearer' });
    const { payload } = await jwtVerify(
      res.body.id_token,
      new TextEncoder().encode(BROKER.clientSecret),
      { audience: BROKER.clientId, issuer: BROKER.webUrl },
    );
    expect(payload).toMatchObject({ nonce: 'nonce-1', sub: accountId });
  });

  it('accepts a JSON body too', async () => {
    const accountId = await account('Andrei');
    const { code } = await approvedCode(accountId);

    const res = await http().post('/api/v1/auth/assistant/token').send({
      client_id: BROKER.clientId,
      client_secret: BROKER.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: BROKER.redirectUri,
    });

    expect(res.status).toBe(200);
  });

  it('gives one of two callers of the same code the tokens', async () => {
    const accountId = await account('Andrei');
    const { code } = await approvedCode(accountId);

    const answers = await Promise.all([exchange({ code }), exchange({ code })]);

    expect(answers.map((res) => res.status).sort()).toEqual([200, 400]);
    expect(answers.find((res) => res.status === 400)?.body).toMatchObject({
      code: 'invalid_grant',
    });
  });

  it('answers a wrong, used or expired code with the same invalid_grant', async () => {
    const accountId = await account('Andrei');
    const used = await approvedCode(accountId);
    await exchange({ code: used.code });
    const expired = await approvedCode(accountId);
    await prisma.assistantSignInCode.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
      where: { usedAt: null },
    });

    const bodies = [];
    for (const code of ['wrong-code', used.code, expired.code]) {
      const res = await exchange({ code });
      expect(res.status).toBe(400);
      bodies.push({ ...res.body, instance: undefined });
    }

    expect(bodies[0]).toMatchObject({ code: 'invalid_grant' });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('accepts the client secret only in the body', async () => {
    const accountId = await account('Andrei');
    const { code } = await approvedCode(accountId);

    const basic = await exchange({ client_secret: undefined, code }).set(
      'authorization',
      `Basic ${Buffer.from(`${BROKER.clientId}:${BROKER.clientSecret}`).toString('base64')}`,
    );
    const wrong = await exchange({ client_secret: 'wrong-secret', code });

    expect([basic.status, basic.body.code]).toEqual([401, 'invalid_client']);
    expect([wrong.status, wrong.body.code]).toEqual([401, 'invalid_client']);
  });

  it('never writes the secret, the code or the token to a log or an error body', async () => {
    const accountId = await account('Andrei');
    const { code } = await approvedCode(accountId);
    logged.length = 0;

    const refusals = [
      await exchange({ client_secret: 'wrong-secret-value', code }),
      await exchange({ code, redirect_uri: 'https://evil.test/cb' }),
      await exchange({ code }),
    ];
    const ok = await exchange({ code: (await approvedCode(accountId)).code });

    const text = `${logged.join('\n')}\n${JSON.stringify(refusals.map((res) => res.body))}`;
    for (const secret of [
      BROKER.clientSecret,
      'wrong-secret-value',
      code,
      ok.body.id_token,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('throttling of the public assistant routes', () => {
  it('refuses an address past its share with too_many_attempts', async () => {
    const statuses: number[] = [];
    for (let n = 0; n <= THROTTLE_LIMIT; n += 1) {
      statuses.push((await authorize()).status);
    }
    const token = await exchange({ code: 'wrong-code' });

    expect(statuses.slice(0, THROTTLE_LIMIT).every((s) => s === 302)).toBe(
      true,
    );
    expect(statuses[THROTTLE_LIMIT]).toBe(429);
    expect(token.status).toBe(429);
    expect(token.body).toMatchObject({ code: 'too_many_attempts' });
    expect(
      Number(token.headers['retry-after'] ?? token.body.retryAfterSeconds),
    ).toBeGreaterThan(0);
  });
});
