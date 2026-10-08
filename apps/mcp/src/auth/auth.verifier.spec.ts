import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { SignJWT } from 'jose';

import {
  TEST_MCP_URL,
  type TestIssuer,
  testIssuer,
} from './auth.issuer.testing';
import { TokenVerifier } from './auth.verifier';

// @traces 365-FR-003
describe('the assistant token verifier', () => {
  let realm: TestIssuer;
  let verifier: TokenVerifier;
  let offset = 0;
  const realNow = Date.now;

  beforeAll(async () => {
    realm = await testIssuer();
  });

  afterAll(() => realm.close());

  beforeEach(() => {
    offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    realm.keyRequests.length = 0;
    verifier = new TokenVerifier({
      issuer: realm.issuer,
      mcpUrl: TEST_MCP_URL,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const refused = (token: Promise<string> | string) =>
    expect(
      Promise.resolve(token).then((t) => verifier.verifyAccessToken(t)),
    ).rejects.toBeInstanceOf(InvalidTokenError);

  it('accepts a token of the realm for this server, reading its claims', async () => {
    const token = await realm.sign({
      claims: {
        azp: 'https://chatgpt.com/connector',
        motorfix_account_id: '7d4ad0a4-5f35-4c55-9b55-7f3d3b0a2b11',
        scope: 'openid motorfix.read',
      },
    });

    const auth = await verifier.verifyAccessToken(token);

    expect(auth).toMatchObject({
      clientId: 'https://chatgpt.com/connector',
      extra: { accountId: '7d4ad0a4-5f35-4c55-9b55-7f3d3b0a2b11' },
      scopes: ['motorfix.read'],
    });
    expect(auth.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('accepts a token whose audience list holds this server', async () => {
    await expect(
      verifier.verifyAccessToken(
        await realm.sign({ claims: { aud: ['account', TEST_MCP_URL] } }),
      ),
    ).resolves.toBeDefined();
  });

  it('accepts a token that expired within the 30 s tolerance', async () => {
    const now = Math.floor(Date.now() / 1000);

    await expect(
      verifier.verifyAccessToken(
        await realm.sign({ claims: { exp: now - 20, iat: now - 900 } }),
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a token that expired past the tolerance', async () => {
    const now = Math.floor(Date.now() / 1000);

    await refused(realm.sign({ claims: { exp: now - 45, iat: now - 900 } }));
  });

  it('refuses a token with no expiry', () =>
    refused(realm.sign({ omit: ['exp'] })));

  it('refuses a token of another issuer', () =>
    refused(
      realm.sign({ claims: { iss: 'http://127.0.0.1:1/realms/other' } }),
    ));

  it('refuses a token for another audience', () =>
    refused(
      realm.sign({ claims: { aud: 'https://api.motorfix.example/api/v1' } }),
    ));

  it('refuses a token signed by a key that only borrows a published id', () =>
    refused(realm.sign({ forged: true })));

  it('refuses a token signed with a shared secret', () =>
    refused(
      new SignJWT({
        aud: TEST_MCP_URL,
        azp: 'client',
        iss: realm.issuer,
        motorfix_account_id: '7d4ad0a4-5f35-4c55-9b55-7f3d3b0a2b11',
        scope: 'motorfix.read',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('a-secret-of-at-least-32-bytes!!!')),
    ));

  it.each(['motorfix_account_id', 'azp', 'scope'])(
    'refuses a token without %s',
    (claim) => refused(realm.sign({ omit: [claim] })),
  );

  it('refuses an account id that is not a uuid', () =>
    refused(realm.sign({ claims: { motorfix_account_id: 'admin' } })));

  it('refuses what is not a token at all', () => refused('not-a-token'));

  it('keeps the key set for 10 minutes, then fetches it again', async () => {
    await verifier.verifyAccessToken(await realm.sign());
    offset = 9 * 60_000;
    await verifier.verifyAccessToken(await realm.sign());

    expect(realm.keyRequests).toHaveLength(1);

    offset = 11 * 60_000;
    await verifier.verifyAccessToken(await realm.sign());

    expect(realm.keyRequests).toHaveLength(2);
  });

  it('fetches the key set again for a rotated key', async () => {
    await verifier.verifyAccessToken(await realm.sign());
    await realm.rotate();
    offset = 61_000;

    await expect(
      verifier.verifyAccessToken(await realm.sign()),
    ).resolves.toBeDefined();
    expect(realm.keyRequests).toHaveLength(2);
  });

  it('fetches the key set for unknown key ids at most once a minute', async () => {
    await verifier.verifyAccessToken(await realm.sign());
    offset = 61_000;

    await refused(realm.sign({ unpublished: true }));
    await refused(realm.sign({ unpublished: true }));
    offset = 90_000;
    await refused(realm.sign({ unpublished: true }));

    expect(realm.keyRequests).toHaveLength(2);

    offset = 122_000;
    await refused(realm.sign({ unpublished: true }));

    expect(realm.keyRequests).toHaveLength(3);
  });

  it('never sends the token to the identity server', async () => {
    const token = await realm.sign();

    await verifier.verifyAccessToken(token);

    expect(realm.keyRequests).toHaveLength(1);
    expect(JSON.stringify(realm.keyRequests)).not.toContain(token);
    expect(realm.keyRequests[0]?.authorization).toBeUndefined();
  });

  it('reports an identity server it cannot reach apart from a bad token', async () => {
    const down = new TokenVerifier({
      issuer: 'http://127.0.0.1:1/realms/motorfix-assistants',
      mcpUrl: TEST_MCP_URL,
    });

    const result = down.verifyAccessToken(await realm.sign());

    await expect(result).rejects.toBeDefined();
    await expect(result).rejects.not.toBeInstanceOf(InvalidTokenError);
  });
});
