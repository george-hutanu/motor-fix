import { createHash, createHmac } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { jwtVerify } from 'jose';

import { type AssistantBroker, AssistantService } from './assistant.service';

const BROKER: AssistantBroker = {
  clientId: 'motorfix-broker',
  clientSecret: 'broker-secret-0123456789abcdef',
  redirectUri:
    'https://id.motorfix.test/realms/motorfix-assistants/broker/motorfix/endpoint',
  webUrl: 'https://motorfix.test',
};
const TOKEN_SECRET = 'app-token-secret';
const ACCOUNT = '6c0d7b4e-3f0a-4a8e-9f3e-2f1b0c9d8e7a';
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

interface Row {
  codeHash: string;
  accountId: string;
  clientId: string;
  nonce: string;
  redirectUri: string;
  expiresAt: Date;
  usedAt: Date | null;
}

function fakePrisma() {
  const rows: Row[] = [];
  return {
    assistantSignInCode: {
      async create({ data }: { data: Omit<Row, 'usedAt'> }) {
        rows.push({ ...data, usedAt: null });
        return data;
      },
      async deleteMany({ where }: { where: { expiresAt: { lt: Date } } }) {
        const stale = rows.filter((row) => row.expiresAt < where.expiresAt.lt);
        for (const row of stale) rows.splice(rows.indexOf(row), 1);
        return { count: stale.length };
      },
      async findUnique({ where }: { where: { codeHash: string } }) {
        return rows.find((row) => row.codeHash === where.codeHash) ?? null;
      },
      async updateMany({
        data,
        where,
      }: {
        data: { usedAt: Date };
        where: { codeHash: string; usedAt: null; expiresAt: { gt: Date } };
      }) {
        const hits = rows.filter(
          (row) =>
            row.codeHash === where.codeHash &&
            row.usedAt === null &&
            row.expiresAt > where.expiresAt.gt,
        );
        for (const row of hits) row.usedAt = data.usedAt;
        return { count: hits.length };
      },
    },
    rows,
  };
}

const build = (
  prisma = fakePrisma(),
  broker: AssistantBroker | null = BROKER,
  tokenSecret = TOKEN_SECRET,
) =>
  new AssistantService(prisma as never, {
    assistant: broker ?? undefined,
    databaseUrl: '',
    redisUrl: '',
    tokenSecret,
  });

const query = (overrides: Record<string, unknown> = {}) => ({
  client_id: BROKER.clientId,
  nonce: 'nonce-1',
  redirect_uri: BROKER.redirectUri,
  response_type: 'code',
  scope: 'openid',
  state: 'state-1',
  ...overrides,
});

const body = (code: unknown, overrides: Record<string, unknown> = {}) => ({
  client_id: BROKER.clientId,
  client_secret: BROKER.clientSecret,
  code,
  grant_type: 'authorization_code',
  redirect_uri: BROKER.redirectUri,
  ...overrides,
});

const refusal = async (run: () => unknown) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof HttpException) {
      return {
        code: (error.getResponse() as { code: string }).code,
        status: error.getStatus(),
      };
    }
    throw error;
  }
  throw new Error('expected a refusal');
};

const handOff = (location: string) =>
  new URL(location).searchParams.get('request') ?? '';

const sign = (claims: unknown, secret = TOKEN_SECRET) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const mac = createHmac('sha256', secret)
    .update(`assistant-sign-in-request.${payload}`)
    .digest('base64url');
  return `${payload}.${mac}`;
};

const claimsOf = (request: string) =>
  JSON.parse(
    Buffer.from(request.split('.')[0] ?? '', 'base64url').toString(),
  ) as Record<string, unknown>;

const codeFor = async (assistant: AssistantService, at = NOW) => {
  const request = handOff(assistant.authorize(query(), at));
  const redirect = new URL(await assistant.approve(request, ACCOUNT, at));
  return redirect.searchParams.get('code') ?? '';
};

describe('adversarial: authorize', () => {
  it.each([
    [
      'a trailing slash on the redirect address',
      { redirect_uri: `${BROKER.redirectUri}/` },
    ],
    ['an upper-cased client id', { client_id: 'MOTORFIX-BROKER' }],
    ['a client id padded with a space', { client_id: ` ${BROKER.clientId}` }],
    [
      'a client id sent twice',
      { client_id: [BROKER.clientId, BROKER.clientId] },
    ],
    ['a numeric client id', { client_id: 1 }],
    ['a null redirect address', { redirect_uri: null }],
    [
      'a redirect address with a query added',
      { redirect_uri: `${BROKER.redirectUri}?next=https://evil.test` },
    ],
  ])('refuses %s as invalid_client', async (_, overrides) => {
    await expect(
      refusal(() => build().authorize(query(overrides), NOW)),
    ).resolves.toEqual({ code: 'invalid_client', status: 400 });
  });

  it.each([
    ['an empty state', { state: '' }],
    ['an empty nonce', { nonce: '' }],
    ['a null nonce', { nonce: null }],
    ['an object state', { state: { a: 1 } }],
    ['a numeric nonce', { nonce: 7 }],
  ])('refuses %s as invalid_request', async (_, overrides) => {
    await expect(
      refusal(() => build().authorize(query(overrides), NOW)),
    ).resolves.toEqual({ code: 'invalid_request', status: 400 });
  });

  it.each([
    ['no response type', { response_type: undefined }],
    ['an upper-cased response type', { response_type: 'CODE' }],
    ['a hybrid response type', { response_type: 'code id_token' }],
  ])('refuses %s as unsupported_response_type', async (_, overrides) => {
    await expect(
      refusal(() => build().authorize(query(overrides), NOW)),
    ).resolves.toEqual({ code: 'unsupported_response_type', status: 400 });
  });

  it('refuses an oversized state instead of building an unbounded address', async () => {
    await expect(
      refusal(() =>
        build().authorize(query({ state: 'x'.repeat(100_000) }), NOW),
      ),
    ).resolves.toEqual({ code: 'invalid_request', status: 400 });
  });

  it('signs an expiry of exactly ten minutes from the call', () => {
    const request = handOff(build().authorize(query(), NOW));
    const exp = claimsOf(request)['exp'] as number;
    expect([NOW + 600_000, (NOW + 600_000) / 1000]).toContain(exp);
  });

  it('gives two authorizations for the same query the same-shaped but independent hand-offs that both verify', async () => {
    const assistant = build();
    const a = handOff(assistant.authorize(query(), NOW));
    const b = handOff(assistant.authorize(query(), NOW));
    await expect(assistant.approve(a, ACCOUNT, NOW)).resolves.toContain(
      'code=',
    );
    await expect(assistant.approve(b, ACCOUNT, NOW)).resolves.toContain(
      'code=',
    );
  });
});

describe('adversarial: approve', () => {
  it('accepts a request this test signs the documented way, proving the forgery helper is faithful', async () => {
    const request = handOff(build().authorize(query(), NOW));
    const resigned = sign(claimsOf(request));

    await expect(build().approve(resigned, ACCOUNT, NOW)).resolves.toContain(
      'code=',
    );
  });

  it.each([
    ['an empty string', ''],
    ['a lone dot', '.'],
    ['a payload with no signature', 'e30.'],
    ['a signature with no payload', '.abc'],
    ['an extra segment', 'a.b.c'],
    ['a valid request with a third segment appended', 'VALID.extra'],
    ['unicode', '\u{1F512}.\u{1F512}'],
    ['a null byte', 'a\u0000.b'],
  ])('refuses %s as invalid_request', async (_, request) => {
    const assistant = build();
    const real = handOff(assistant.authorize(query(), NOW));
    const input =
      request === 'a.b.c' || request === 'VALID.extra'
        ? request === 'a.b.c'
          ? `${real}.x`
          : `${real}.extra`
        : request;

    await expect(
      refusal(() => assistant.approve(input, ACCOUNT, NOW)),
    ).resolves.toEqual({ code: 'invalid_request', status: 400 });
  });

  it('refuses a truncated signature at every cut', async () => {
    const assistant = build();
    const real = handOff(assistant.authorize(query(), NOW));
    for (const cut of [1, 2, 10, 43]) {
      await expect(
        refusal(() => assistant.approve(real.slice(0, -cut), ACCOUNT, NOW)),
      ).resolves.toEqual({ code: 'invalid_request', status: 400 });
    }
  });

  it('refuses a non-string request without a server error', async () => {
    for (const bad of [undefined, null, 5, {}, ['a.b']]) {
      await expect(
        refusal(() => build().approve(bad as never, ACCOUNT, NOW)),
      ).resolves.toMatchObject({ status: 400 });
    }
  });

  it('refuses a request whose payload was signed with another secret', async () => {
    const claims = claimsOf(handOff(build().authorize(query(), NOW)));

    await expect(
      refusal(() => build().approve(sign(claims, 'attacker'), ACCOUNT, NOW)),
    ).resolves.toEqual({ code: 'invalid_request', status: 400 });
  });

  it('refuses a payload that is not JSON even when correctly signed', async () => {
    const payload = Buffer.from('not json').toString('base64url');
    const mac = createHmac('sha256', TOKEN_SECRET)
      .update(`assistant-sign-in-request.${payload}`)
      .digest('base64url');

    await expect(
      refusal(() => build().approve(`${payload}.${mac}`, ACCOUNT, NOW)),
    ).resolves.toMatchObject({ status: 400 });
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
    ['no expiry', { client_id: 'motorfix-broker' }],
  ])(
    'refuses a correctly signed payload that is %s without a server error',
    async (_, claims) => {
      await expect(
        refusal(() => build().approve(sign(claims), ACCOUNT, NOW)),
      ).resolves.toMatchObject({ status: expect.any(Number) });
    },
  );

  it('refuses a correctly signed request naming another redirect address', async () => {
    const claims = {
      ...claimsOf(handOff(build().authorize(query(), NOW))),
      redirect_uri: 'https://evil.test/cb',
    };

    const outcome = await refusal(() =>
      build().approve(sign(claims), ACCOUNT, NOW),
    );

    expect(outcome.status).toBe(400);
  });

  it('refuses a correctly signed request naming another client', async () => {
    const claims = {
      ...claimsOf(handOff(build().authorize(query(), NOW))),
      client_id: 'someone-else',
    };

    const outcome = await refusal(() =>
      build().approve(sign(claims), ACCOUNT, NOW),
    );

    expect(outcome.status).toBe(400);
  });

  it('refuses a request issued before the configured redirect address changed', async () => {
    const request = handOff(build().authorize(query(), NOW));
    const rotated = { ...BROKER, redirectUri: 'https://id2.motorfix.test/cb' };

    const outcome = await refusal(() =>
      build(fakePrisma(), rotated).approve(request, ACCOUNT, NOW),
    );

    expect(outcome.status).toBe(400);
  });

  it('refuses a request when no broker is configured', async () => {
    const request = handOff(build().authorize(query(), NOW));

    const outcome = await refusal(() =>
      build(fakePrisma(), null).approve(request, ACCOUNT, NOW),
    );

    expect(outcome.status).toBe(400);
  });

  it('refuses a request with a string expiry as expired or invalid, never as good', async () => {
    const claims = {
      ...claimsOf(handOff(build().authorize(query(), NOW))),
      exp: String(NOW + 600_000),
    };

    const outcome = await refusal(() =>
      build().approve(sign(claims), ACCOUNT, NOW),
    );

    expect(outcome.status).toBeGreaterThanOrEqual(400);
  });

  it('keeps a hostile state from adding or overriding query parameters', async () => {
    const assistant = build();
    const hostile = 'a&code=evil&state=x#frag';
    const request = handOff(
      assistant.authorize(query({ state: hostile }), NOW),
    );

    const redirect = new URL(await assistant.approve(request, ACCOUNT, NOW));

    expect(redirect.searchParams.getAll('code')).toHaveLength(1);
    expect(redirect.searchParams.getAll('state')).toEqual([hostile]);
    expect(redirect.hash).toBe('');
  });

  it('round-trips a unicode state and nonce', async () => {
    const assistant = build();
    const request = handOff(
      assistant.authorize(
        query({ nonce: 'n-ăș', state: 'stare-ăîșț-\u{1F697}' }),
        NOW,
      ),
    );
    const redirect = new URL(await assistant.approve(request, ACCOUNT, NOW));
    const code = redirect.searchParams.get('code') ?? '';

    expect(redirect.searchParams.get('state')).toBe('stare-ăîșț-\u{1F697}');
    const tokens = await assistant.exchange(body(code), NOW + 1000);
    const { payload } = await jwtVerify(
      tokens.id_token,
      new TextEncoder().encode(BROKER.clientSecret),
      { currentDate: new Date(NOW + 1000) },
    );
    expect(payload['nonce']).toBe('n-ăș');
  });

  it('stores codes that differ between approvals of the same request', async () => {
    const prisma = fakePrisma();
    const assistant = build(prisma);
    const request = handOff(assistant.authorize(query(), NOW));

    const first = new URL(await assistant.approve(request, ACCOUNT, NOW));
    const second = new URL(await assistant.approve(request, ACCOUNT, NOW));

    expect(first.searchParams.get('code')).not.toBe(
      second.searchParams.get('code'),
    );
    expect(prisma.rows).toHaveLength(2);
  });
});

describe('adversarial: exchange', () => {
  it('lets only one of twenty concurrent exchanges win', async () => {
    const assistant = build();
    const code = await codeFor(assistant);

    const answers = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        assistant.exchange(body(code), NOW + 1000),
      ),
    );

    expect(answers.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
  });

  it('refuses a replay with the same code long after, as invalid_grant', async () => {
    const assistant = build();
    const code = await codeFor(assistant);
    await assistant.exchange(body(code), NOW + 1000);

    await expect(
      refusal(() => assistant.exchange(body(code), NOW + 1001)),
    ).resolves.toEqual({ code: 'invalid_grant', status: 400 });
  });

  it('accepts a code one millisecond before it lapses and refuses it at the instant', async () => {
    const early = build();
    const code = await codeFor(early);
    await expect(
      early.exchange(body(code), NOW + 59_999),
    ).resolves.toMatchObject({
      token_type: 'Bearer',
    });

    const late = build();
    const code2 = await codeFor(late);
    await expect(
      refusal(() => late.exchange(body(code2), NOW + 60_000)),
    ).resolves.toEqual({ code: 'invalid_grant', status: 400 });
  });

  it('refuses an expired code when the clock is far in the future', async () => {
    const assistant = build();
    const code = await codeFor(assistant);

    await expect(
      refusal(() =>
        assistant.exchange(body(code), NOW + 10 * 365 * 86_400_000),
      ),
    ).resolves.toEqual({ code: 'invalid_grant', status: 400 });
  });

  it.each([
    ['upper-cased', (c: string) => c.toUpperCase()],
    ['padded with a space', (c: string) => ` ${c}`],
    ['followed by a newline', (c: string) => `${c}\n`],
    ['truncated', (c: string) => c.slice(0, -1)],
    ['doubled', (c: string) => `${c}${c}`],
    [
      'the stored hash',
      (c: string) => createHash('sha256').update(c).digest('hex'),
    ],
  ])('refuses a code %s', async (_, mutate) => {
    const assistant = build();
    const code = await codeFor(assistant);

    await expect(
      refusal(() => assistant.exchange(body(mutate(code)), NOW + 1000)),
    ).resolves.toEqual({ code: 'invalid_grant', status: 400 });
  });

  it('does not burn a code on a request with the wrong secret', async () => {
    const assistant = build();
    const code = await codeFor(assistant);
    await refusal(() =>
      assistant.exchange(body(code, { client_secret: 'wrong' }), NOW + 1000),
    );

    await expect(
      assistant.exchange(body(code), NOW + 2000),
    ).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it.each([
    ['a prefix of the secret', BROKER.clientSecret.slice(0, 10)],
    ['the secret plus a character', `${BROKER.clientSecret}x`],
    ['an empty secret', ''],
    ['the secret upper-cased', BROKER.clientSecret.toUpperCase()],
    ['a same-length unicode secret', 'é'.repeat(BROKER.clientSecret.length)],
    ['a number', 12345],
    ['an array holding the secret', [BROKER.clientSecret]],
    ['an object', { toString: () => BROKER.clientSecret }],
    ['null', null],
    ['a secret 100000 characters long', 'z'.repeat(100_000)],
  ])('refuses %s as invalid_client', async (_, secret) => {
    const assistant = build();
    const code = await codeFor(assistant);

    await expect(
      refusal(() =>
        assistant.exchange(body(code, { client_secret: secret }), NOW + 1000),
      ),
    ).resolves.toEqual({ code: 'invalid_client', status: 401 });
  });

  it.each([
    ['no client id', { client_id: undefined }],
    ['an empty client id', { client_id: '' }],
    ['an array client id', { client_id: [BROKER.clientId] }],
    ['an upper-cased client id', { client_id: 'MOTORFIX-BROKER' }],
  ])('refuses %s as invalid_client', async (_, overrides) => {
    const assistant = build();
    const code = await codeFor(assistant);

    await expect(
      refusal(() => assistant.exchange(body(code, overrides), NOW + 1000)),
    ).resolves.toEqual({ code: 'invalid_client', status: 401 });
  });

  it.each([
    ['an array', ['x']],
    ['a number', 7],
    ['an object', { a: 1 }],
    ['null', null],
    ['an empty string', ''],
  ])('answers invalid_grant for a code that is %s', async (_, code) => {
    await expect(
      refusal(() => build().exchange(body(code), NOW)),
    ).resolves.toEqual({ code: 'invalid_grant', status: 400 });
  });

  it.each([
    ['trailing slash', `${BROKER.redirectUri}/`],
    ['upper case', BROKER.redirectUri.toUpperCase()],
    ['no redirect address', undefined],
    ['an array', [BROKER.redirectUri]],
  ])(
    'answers invalid_grant for a redirect address with %s',
    async (_, redirect) => {
      const assistant = build();
      const code = await codeFor(assistant);

      await expect(
        refusal(() =>
          assistant.exchange(
            body(code, { redirect_uri: redirect }),
            NOW + 1000,
          ),
        ),
      ).resolves.toEqual({ code: 'invalid_grant', status: 400 });
    },
  );

  it.each([
    ['implicit', 'implicit'],
    ['password', 'password'],
    ['client credentials', 'client_credentials'],
    ['upper case', 'AUTHORIZATION_CODE'],
    ['padded', ' authorization_code'],
    ['missing', undefined],
    ['empty', ''],
    ['an array', ['authorization_code']],
    ['a number', 1],
  ])('answers unsupported_grant_type for %s', async (_, grant) => {
    const assistant = build();
    const code = await codeFor(assistant);

    await expect(
      refusal(() =>
        assistant.exchange(body(code, { grant_type: grant }), NOW + 1000),
      ),
    ).resolves.toEqual({ code: 'unsupported_grant_type', status: 400 });
  });

  it('refuses a body that is null or empty without a server error', async () => {
    await expect(
      refusal(() => build().exchange(null as never, NOW)),
    ).resolves.toMatchObject({ status: expect.any(Number) });
    await expect(
      refusal(() => build().exchange({}, NOW)),
    ).resolves.toMatchObject({ status: expect.any(Number) });
  });

  it('ignores a code_verifier and an extra field without failing', async () => {
    const assistant = build();
    const code = await codeFor(assistant);

    await expect(
      assistant.exchange(
        body(code, { code_verifier: 'whatever', extra: { a: 1 } }),
        NOW + 1000,
      ),
    ).resolves.toMatchObject({ token_type: 'Bearer' });
  });

  it('refuses everything while no broker is configured', async () => {
    const prisma = fakePrisma();
    const code = await codeFor(build(prisma));

    await expect(
      refusal(() => build(prisma, null).exchange(body(code), NOW + 1000)),
    ).resolves.toMatchObject({ status: expect.any(Number) });
  });

  it('keeps one code from yielding a token for a different account than the one that approved', async () => {
    const assistant = build();
    const request = handOff(assistant.authorize(query(), NOW));
    const other = '11111111-2222-3333-4444-555555555555';
    const a =
      new URL(await assistant.approve(request, ACCOUNT, NOW)).searchParams.get(
        'code',
      ) ?? '';
    const b =
      new URL(await assistant.approve(request, other, NOW)).searchParams.get(
        'code',
      ) ?? '';
    const verify = async (code: string) => {
      const tokens = await assistant.exchange(body(code), NOW + 1000);
      const { payload } = await jwtVerify(
        tokens.id_token,
        new TextEncoder().encode(BROKER.clientSecret),
        { currentDate: new Date(NOW + 1000) },
      );
      return payload.sub;
    };

    expect(await verify(a)).toBe(ACCOUNT);
    expect(await verify(b)).toBe(other);
  });
});

describe('adversarial: id token claims', () => {
  const tokenAt = async (at: number) => {
    const assistant = build();
    const code = await codeFor(assistant);
    const tokens = await assistant.exchange(body(code), at);
    return jwtVerify(
      tokens.id_token,
      new TextEncoder().encode(BROKER.clientSecret),
      {
        currentDate: new Date(at),
      },
    );
  };

  it('carries exactly the documented claims', async () => {
    const { payload } = await tokenAt(NOW + 1000);

    expect(Object.keys(payload).sort()).toEqual(
      ['aud', 'exp', 'iat', 'iss', 'nonce', 'sub'].sort(),
    );
    expect(payload.iss).toBe(BROKER.webUrl);
    expect(payload.aud).toBe(BROKER.clientId);
    expect(payload.sub).toBe(ACCOUNT);
  });

  it('dates the token from the exchange instant, in seconds', async () => {
    const { payload } = await tokenAt(NOW + 1000);

    expect(payload.iat).toBe(Math.floor((NOW + 1000) / 1000));
    expect(payload.exp).toBe(Math.floor((NOW + 1000) / 1000) + 300);
  });

  it('is rejected after five minutes', async () => {
    const assistant = build();
    const code = await codeFor(assistant);
    const tokens = await assistant.exchange(body(code), NOW + 1000);

    await expect(
      jwtVerify(
        tokens.id_token,
        new TextEncoder().encode(BROKER.clientSecret),
        {
          currentDate: new Date(NOW + 1000 + 301_000),
        },
      ),
    ).rejects.toThrow();
  });

  it('is not verifiable with the application token secret', async () => {
    const assistant = build();
    const code = await codeFor(assistant);
    const tokens = await assistant.exchange(body(code), NOW + 1000);

    await expect(
      jwtVerify(tokens.id_token, new TextEncoder().encode(TOKEN_SECRET), {
        currentDate: new Date(NOW + 1000),
      }),
    ).rejects.toThrow();
  });

  it('is not verifiable for another audience', async () => {
    const assistant = build();
    const code = await codeFor(assistant);
    const tokens = await assistant.exchange(body(code), NOW + 1000);

    await expect(
      jwtVerify(
        tokens.id_token,
        new TextEncoder().encode(BROKER.clientSecret),
        {
          audience: 'someone-else',
          currentDate: new Date(NOW + 1000),
        },
      ),
    ).rejects.toThrow();
  });

  it('never leaks the broker secret or the code into the token', async () => {
    const assistant = build();
    const code = await codeFor(assistant);
    const tokens = await assistant.exchange(body(code), NOW + 1000);
    const decoded = Buffer.from(
      tokens.id_token.split('.')[1] ?? '',
      'base64url',
    ).toString();

    expect(decoded).not.toContain(BROKER.clientSecret);
    expect(decoded).not.toContain(code);
  });
});
