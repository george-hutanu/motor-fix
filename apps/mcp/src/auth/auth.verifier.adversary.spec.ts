import { createHmac, randomUUID } from 'node:crypto';

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import {
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';

import {
  TEST_MCP_URL,
  type TestIssuer,
  testIssuer,
} from './auth.issuer.testing';
import { TokenVerifier } from './auth.verifier';

const b64 = (value: unknown) =>
  Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(value),
  ).toString('base64url');

describe('the assistant token verifier under hostile tokens', () => {
  let realm: TestIssuer;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    realm = await testIssuer();
  });

  afterAll(() => realm.close());

  beforeEach(() => {
    verifier = new TokenVerifier({
      issuer: realm.issuer,
      mcpUrl: TEST_MCP_URL,
    });
  });

  const now = () => Math.floor(Date.now() / 1000);
  const goodClaims = () => ({
    aud: TEST_MCP_URL,
    azp: 'client',
    exp: now() + 600,
    iat: now(),
    iss: realm.issuer,
    motorfix_account_id: randomUUID(),
    scope: 'openid motorfix.read',
    sub: randomUUID(),
  });

  const refused = async (token: string) => {
    await expect(verifier.verifyAccessToken(token)).rejects.toBeInstanceOf(
      InvalidTokenError,
    );
  };

  const publishedKid = async () =>
    decodeProtectedHeader(await realm.sign()).kid as string;

  it('refuses a token with alg none and no signature', async () => {
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(goodClaims())}.`;

    await refused(token);
  });

  it('refuses alg none carrying the published key id', async () => {
    const header = { alg: 'none', kid: await publishedKid() };
    await refused(`${b64(header)}.${b64(goodClaims())}.`);
  });

  it('refuses an HS256 token signed with the published public key material', async () => {
    const keys = (await (
      await fetch(`${realm.issuer}/protocol/openid-connect/certs`)
    ).json()) as {
      keys: { kid: string; n: string }[];
    };
    const key = keys.keys[keys.keys.length - 1] as { kid: string; n: string };
    const signingInput = `${b64({ alg: 'HS256', kid: key.kid, typ: 'JWT' })}.${b64(goodClaims())}`;
    const mac = createHmac('sha256', key.n)
      .update(signingInput)
      .digest('base64url');

    await refused(`${signingInput}.${mac}`);
  });

  it('refuses an HS256 token signed with an arbitrary secret', async () => {
    const token = await new SignJWT(goodClaims())
      .setProtectedHeader({ alg: 'HS256', kid: await publishedKid() })
      .sign(new TextEncoder().encode('x'.repeat(32)));

    await refused(token);
  });

  it('refuses an RS384 token from an unknown key even with the right claims', async () => {
    const { privateKey } = await generateKeyPair('RS384');
    const token = await new SignJWT(goodClaims())
      .setProtectedHeader({ alg: 'RS384', kid: await publishedKid() })
      .sign(privateKey);

    await refused(token);
  });

  it('refuses a token whose header points to a key set of the attacker', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const token = await new SignJWT(goodClaims())
      .setProtectedHeader({
        alg: 'RS256',
        jku: 'http://127.0.0.1:1/keys',
        jwk: { ...jwk, kid: 'mine' },
        kid: 'mine',
      })
      .sign(privateKey);

    await refused(token);
  });

  it('refuses a token signed with a key id the realm never published', async () => {
    await refused(await realm.sign({ unpublished: true }));
  });

  it('refuses a token signed by another key that claims the published id', async () => {
    await refused(await realm.sign({ forged: true }));
  });

  it('refuses a token with no key id in its header', async () => {
    const { privateKey } = await generateKeyPair('RS256');
    const token = await new SignJWT(goodClaims())
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    await refused(token);
  });

  it('refuses a token whose payload was swapped after signing', async () => {
    const [header, , signature] = (await realm.sign()).split('.');

    await refused(
      `${header}.${b64({ ...goodClaims(), scope: 'motorfix.act' })}.${signature}`,
    );
  });

  it('refuses an audience array that leaves out this server', async () => {
    await refused(
      await realm.sign({ claims: { aud: ['http://127.0.0.1:3002', 'other'] } }),
    );
  });

  it('accepts an audience array that includes this server', async () => {
    const auth = await verifier.verifyAccessToken(
      await realm.sign({
        claims: { aud: ['https://other.example', TEST_MCP_URL] },
      }),
    );

    expect(auth.scopes).toEqual(['motorfix.read', 'motorfix.act']);
  });

  it.each([
    ['trailing slash', `${TEST_MCP_URL}/`],
    ['upper case host', TEST_MCP_URL.replace('127.0.0.1', 'LOCALHOST')],
    ['a prefix', 'http://127.0.0.1:3002'],
    ['empty string', ''],
  ])('refuses an audience that is %s', async (_name, aud) => {
    await refused(await realm.sign({ claims: { aud } }));
  });

  it('refuses a token with an empty audience array', async () => {
    await refused(await realm.sign({ claims: { aud: [] } }));
  });

  it('refuses an issuer with a trailing slash', async () => {
    await refused(await realm.sign({ claims: { iss: `${realm.issuer}/` } }));
  });

  it('refuses a token not valid yet', async () => {
    await refused(await realm.sign({ claims: { nbf: now() + 3600 } }));
  });

  it('accepts a token whose nbf is in the past', async () => {
    const auth = await verifier.verifyAccessToken(
      await realm.sign({ claims: { nbf: now() - 60 } }),
    );

    expect(auth.scopes).toContain('motorfix.read');
  });

  it.each([
    ['an hour ago', -3600],
    ['two minutes ago', -120],
  ])('refuses a token that expired %s', async (_name, delta) => {
    await refused(await realm.sign({ claims: { exp: now() + delta } }));
  });

  it('refuses a token with no expiry', async () => {
    await refused(await realm.sign({ omit: ['exp'] }));
  });

  it('refuses an expiry given as a string', async () => {
    await refused(
      await realm.sign({ claims: { exp: String(now() + 600) as never } }),
    );
  });

  it.each(['scope', 'azp', 'motorfix_account_id'])(
    'refuses a token without %s',
    async (claim) => {
      await refused(await realm.sign({ omit: [claim] }));
    },
  );

  it.each([
    ['empty scope', { scope: '' }],
    ['scope as a number', { scope: 7 }],
    ['scope as an array', { scope: ['motorfix.read'] }],
    ['scope as null', { scope: null }],
    ['empty azp', { azp: '' }],
    ['azp as a number', { azp: 5 }],
    ['account id that is no uuid', { motorfix_account_id: 'admin' }],
    ['account id as a number', { motorfix_account_id: 42 }],
    ['account id as an array', { motorfix_account_id: [randomUUID()] }],
    ['account id as null', { motorfix_account_id: null }],
    [
      'account id with a trailing newline',
      { motorfix_account_id: `${randomUUID()}\n` },
    ],
    ['account id in a sql fragment', { motorfix_account_id: "' OR 1=1 --" }],
  ])('refuses a token with %s', async (_name, claims) => {
    await refused(await realm.sign({ claims: claims as never }));
  });

  it('does not grant a scope that only matches by prefix', async () => {
    const auth = await verifier.verifyAccessToken(
      await realm.sign({ claims: { scope: 'motorfix.reader motorfix.actor' } }),
    );

    expect(auth.scopes).not.toContain('motorfix.read');
    expect(auth.scopes).not.toContain('motorfix.act');
  });

  it('reads scopes separated by several spaces and tabs without inventing empty ones', async () => {
    const auth = await verifier.verifyAccessToken(
      await realm.sign({
        claims: { scope: '  motorfix.read   motorfix.act ' },
      }),
    );

    expect(auth.scopes).not.toContain('');
    expect(auth.scopes).toEqual(
      expect.arrayContaining(['motorfix.read', 'motorfix.act']),
    );
  });

  it.each([
    ['empty', ''],
    ['one segment', 'abc'],
    ['two segments', 'abc.def'],
    ['four segments', 'a.b.c.d'],
    ['dots only', '..'],
    ['unicode', 'ţoken.ünï.çödé'],
    ['not base64', '!!!.???.***'],
    ['a null byte', 'a\u0000b.c.d'],
    ['a huge token', `${'A'.repeat(200_000)}.${'B'.repeat(10)}.C`],
  ])('refuses a %s token', async (_name, token) => {
    await refused(token);
  });

  it('refuses a token whose header is not JSON', async () => {
    await refused(`${b64('not json')}.${b64(goodClaims())}.sig`);
  });

  it('refuses a token whose payload is a JSON array', async () => {
    await refused(`${b64({ alg: 'RS256' })}.${b64([1, 2])}.sig`);
  });

  it('does not repeat the token in the refusal message', async () => {
    const token = `${b64({ alg: 'none' })}.${b64(goodClaims())}.`;

    const error = await verifier
      .verifyAccessToken(token)
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(InvalidTokenError);
    expect((error as Error).message).not.toContain(token);
    expect((error as Error).message).not.toContain(
      token.split('.')[1] as string,
    );
  });

  it('verifies a hundred tokens in parallel with a single key fetch at most a few times', async () => {
    realm.keyRequests.length = 0;
    const tokens = await Promise.all(
      Array.from({ length: 100 }, () => realm.sign()),
    );

    const results = await Promise.all(
      tokens.map((t) => verifier.verifyAccessToken(t)),
    );

    expect(results).toHaveLength(100);
    expect(realm.keyRequests.length).toBeLessThanOrEqual(2);
  });

  it('does not refetch keys for every token with an unknown key id', async () => {
    await verifier.verifyAccessToken(await realm.sign());
    realm.keyRequests.length = 0;

    for (let i = 0; i < 20; i++) {
      await verifier
        .verifyAccessToken(await realm.sign({ unpublished: true }))
        .catch(() => undefined);
    }

    expect(realm.keyRequests.length).toBeLessThanOrEqual(1);
  });

  // The key set is fetched again at most once a minute, so a flood of
  // unknown key ids cannot hammer the identity server.
  it('accepts a token signed with a key published after a rotation once the minute has passed', async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await verifier.verifyAccessToken(await realm.sign());
      await realm.rotate();
      const token = await realm.sign();
      await refused(token);

      clock.mockReturnValue(start + 61_000);
      const auth = await verifier.verifyAccessToken(token);

      expect(auth.scopes).toContain('motorfix.read');
    } finally {
      clock.mockRestore();
    }
  });
});
