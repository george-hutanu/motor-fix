// @traces 365-FR-013
import { createHash } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { decodeProtectedHeader, jwtVerify } from 'jose';

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

// Only what the service asks of the sign-in code table.
function fakePrisma() {
  const rows: Row[] = [];
  return {
    assistantSignInCode: {
      async create({ data }: { data: Omit<Row, 'usedAt'> }) {
        rows.push({ ...data, usedAt: null });
        return data;
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

const service = (
  prisma = fakePrisma(),
  broker: AssistantBroker | null = BROKER,
) =>
  new AssistantService(prisma as never, {
    assistant: broker ?? undefined,
    databaseUrl: '',
    redisUrl: '',
    tokenSecret: TOKEN_SECRET,
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

const refusal = (run: () => unknown) => {
  try {
    run();
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

const asyncRefusal = async (run: () => Promise<unknown>) => {
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

const handOff = (location: string) => {
  const url = new URL(location);
  return url.searchParams.get('request') ?? '';
};

describe('the assistant sign-in hand-off', () => {
  it('sends the browser to the web connect route with a signed request', () => {
    const location = service().authorize(query(), NOW);

    expect(
      location.startsWith(
        'https://motorfix.test/app/assistant/connect?request=',
      ),
    ).toBe(true);
    expect(handOff(location)).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it.each([
    ['another client', { client_id: 'someone-else' }, 400, 'invalid_client'],
    [
      'another redirect address',
      { redirect_uri: 'https://evil.test/cb' },
      400,
      'invalid_client',
    ],
    ['no client', { client_id: undefined }, 400, 'invalid_client'],
    [
      'a token response type',
      { response_type: 'token' },
      400,
      'unsupported_response_type',
    ],
    ['no state', { state: undefined }, 400, 'invalid_request'],
    ['no nonce', { nonce: undefined }, 400, 'invalid_request'],
    ['a repeated state', { state: ['a', 'b'] }, 400, 'invalid_request'],
  ])('refuses %s', (_, overrides, status, code) => {
    expect(refusal(() => service().authorize(query(overrides), NOW))).toEqual({
      code,
      status,
    });
  });

  it('refuses everything while no broker is configured', () => {
    expect(
      refusal(() => service(fakePrisma(), null).authorize(query(), NOW)),
    ).toEqual({
      code: 'invalid_client',
      status: 400,
    });
  });

  it('answers the stored redirect address with a code and the state', async () => {
    const prisma = fakePrisma();
    const assistant = service(prisma);
    const request = handOff(assistant.authorize(query(), NOW));

    const redirect = new URL(
      await assistant.approve(request, ACCOUNT, NOW + 1000),
    );

    expect(`${redirect.origin}${redirect.pathname}`).toBe(BROKER.redirectUri);
    expect(redirect.searchParams.get('state')).toBe('state-1');
    const code = redirect.searchParams.get('code') ?? '';
    expect(code.length).toBeGreaterThanOrEqual(43);
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({
      accountId: ACCOUNT,
      clientId: BROKER.clientId,
      codeHash: createHash('sha256').update(code).digest('hex'),
      expiresAt: new Date(NOW + 1000 + 60_000),
      nonce: 'nonce-1',
      redirectUri: BROKER.redirectUri,
    });
    expect(JSON.stringify(prisma.rows)).not.toContain(code);
  });

  it('refuses a tampered request', async () => {
    const assistant = service();
    const request = handOff(assistant.authorize(query(), NOW));
    const [payload, signature] = request.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
        redirect_uri: 'https://evil.test/cb',
      }),
    ).toString('base64url');

    await expect(
      asyncRefusal(() =>
        assistant.approve(`${forged}.${signature}`, ACCOUNT, NOW),
      ),
    ).resolves.toEqual({
      code: 'invalid_request',
      status: 400,
    });
    await expect(
      asyncRefusal(() =>
        assistant.approve(`${payload}.x${signature}`, ACCOUNT, NOW),
      ),
    ).resolves.toEqual({
      code: 'invalid_request',
      status: 400,
    });
    await expect(
      asyncRefusal(() => assistant.approve('not-a-request', ACCOUNT, NOW)),
    ).resolves.toEqual({
      code: 'invalid_request',
      status: 400,
    });
  });

  it('refuses a request signed by another deployment', async () => {
    const other = new AssistantService(fakePrisma() as never, {
      assistant: BROKER,
      databaseUrl: '',
      redisUrl: '',
      tokenSecret: 'another-secret',
    });
    const request = handOff(other.authorize(query(), NOW));

    await expect(
      asyncRefusal(() => service().approve(request, ACCOUNT, NOW)),
    ).resolves.toEqual({
      code: 'invalid_request',
      status: 400,
    });
  });

  it('keeps a request good for 10 minutes and no longer', async () => {
    const assistant = service();
    const request = handOff(assistant.authorize(query(), NOW));

    await expect(
      assistant.approve(request, ACCOUNT, NOW + 10 * 60_000 - 1000),
    ).resolves.toContain('code=');
    await expect(
      asyncRefusal(() =>
        assistant.approve(request, ACCOUNT, NOW + 10 * 60_000),
      ),
    ).resolves.toEqual({
      code: 'request_expired',
      status: 410,
    });
  });
});

describe('the assistant token exchange', () => {
  async function codeFor(assistant: AssistantService, at = NOW) {
    const request = handOff(assistant.authorize(query(), at));
    const redirect = new URL(await assistant.approve(request, ACCOUNT, at));
    return redirect.searchParams.get('code') ?? '';
  }

  const body = (
    code: string,
    overrides: Record<string, string | undefined> = {},
  ) => ({
    client_id: BROKER.clientId,
    client_secret: BROKER.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: BROKER.redirectUri,
    ...overrides,
  });

  it('answers an HS256 id token for the approving account, signed with the broker secret', async () => {
    const assistant = service();
    const code = await codeFor(assistant);

    const tokens = await assistant.exchange(body(code), NOW + 5000);

    expect(tokens).toMatchObject({ expires_in: 300, token_type: 'Bearer' });
    expect(tokens.access_token).toBe(tokens.id_token);
    expect(decodeProtectedHeader(tokens.id_token).alg).toBe('HS256');
    const { payload } = await jwtVerify(
      tokens.id_token,
      new TextEncoder().encode(BROKER.clientSecret),
      {
        audience: BROKER.clientId,
        currentDate: new Date(NOW + 5000),
        issuer: BROKER.webUrl,
      },
    );
    expect(payload).toMatchObject({ nonce: 'nonce-1', sub: ACCOUNT });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(300);
  });

  it('exchanges a code once', async () => {
    const assistant = service();
    const code = await codeFor(assistant);

    const answers = await Promise.allSettled([
      assistant.exchange(body(code), NOW + 1000),
      assistant.exchange(body(code), NOW + 1000),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    await expect(
      asyncRefusal(() => assistant.exchange(body(code), NOW + 2000)),
    ).resolves.toEqual({
      code: 'invalid_grant',
      status: 400,
    });
  });

  it('keeps a code good for 60 seconds', async () => {
    const assistant = service();
    const code = await codeFor(assistant);

    await expect(
      asyncRefusal(() => assistant.exchange(body(code), NOW + 60_000)),
    ).resolves.toEqual({
      code: 'invalid_grant',
      status: 400,
    });
  });

  it.each([
    ['an unknown code', { code: 'unknown' }],
    ['no code', { code: undefined }],
    ['another redirect address', { redirect_uri: 'https://evil.test/cb' }],
  ])('answers one generic invalid_grant for %s', async (_, overrides) => {
    const assistant = service();
    const code = await codeFor(assistant);

    await expect(
      asyncRefusal(() => assistant.exchange(body(code, overrides), NOW + 1000)),
    ).resolves.toEqual({
      code: 'invalid_grant',
      status: 400,
    });
  });

  it.each([
    ['a wrong secret', { client_secret: 'wrong' }],
    ['no secret', { client_secret: undefined }],
    ['another client', { client_id: 'someone-else' }],
  ])('refuses %s as invalid_client', async (_, overrides) => {
    const assistant = service();
    const code = await codeFor(assistant);

    await expect(
      asyncRefusal(() => assistant.exchange(body(code, overrides), NOW + 1000)),
    ).resolves.toEqual({
      code: 'invalid_client',
      status: 401,
    });
  });

  it('refuses another grant type', async () => {
    const assistant = service();
    const code = await codeFor(assistant);

    await expect(
      asyncRefusal(() =>
        assistant.exchange(
          body(code, { grant_type: 'refresh_token' }),
          NOW + 1000,
        ),
      ),
    ).resolves.toEqual({ code: 'unsupported_grant_type', status: 400 });
  });

  it('never echoes the secret or the code in a refusal', async () => {
    const assistant = service();
    const code = await codeFor(assistant);
    const answers: unknown[] = [];
    for (const overrides of [
      { client_secret: 'wrong-secret-value' },
      { redirect_uri: 'https://evil.test/cb' },
    ]) {
      await assistant
        .exchange(body(code, overrides), NOW + 1000)
        .catch((error: HttpException) => {
          answers.push(error.getResponse());
        });
    }

    const text = JSON.stringify(answers);
    expect(answers).toHaveLength(2);
    expect(text).not.toContain(code);
    expect(text).not.toContain('wrong-secret-value');
    expect(text).not.toContain(BROKER.clientSecret);
  });
});
