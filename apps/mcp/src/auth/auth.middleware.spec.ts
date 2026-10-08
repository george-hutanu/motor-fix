import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';

import { TEST_MCP_URL } from './auth.issuer.testing';
import { BearerAuth } from './auth.middleware';

const METADATA = `resource_metadata="http://127.0.0.1:3002/.well-known/oauth-protected-resource/mcp"`;
const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.c2VjcmV0.c2lnbmF0dXJl';

// @traces 365-FR-002 365-FR-017
describe('the bearer check in front of the MCP endpoint', () => {
  const verifyAccessToken = jest.fn<Promise<AuthInfo>, [string]>();
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const auth = new BearerAuth(
      { verifyAccessToken },
      { issuer: 'http://127.0.0.1:1/realms/x', mcpUrl: TEST_MCP_URL },
    );
    const app = express();
    app.post(
      '/mcp',
      (req, res, next) => void auth.use(req, res, next),
      (req, res) => {
        res.json({ auth: (req as { auth?: AuthInfo }).auth });
      },
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => verifyAccessToken.mockReset());

  const call = (authorization?: string) =>
    fetch(`${base}/mcp`, {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        ...(authorization && { authorization }),
      },
      method: 'POST',
    });

  it('asks for sign-in when no token is given, pointing at the metadata', async () => {
    const res = await call();

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer ${METADATA}`);
    expect(await res.json()).toEqual({
      code: 'sign_in_required',
      message: expect.any(String),
    });
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('treats another scheme as no token', async () => {
    const res = await call('Basic dXNlcjpwYXNz');

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer ${METADATA}`);
  });

  it('refuses a token the verifier rejects, naming invalid_token', async () => {
    verifyAccessToken.mockRejectedValue(new InvalidTokenError('expired'));

    const res = await call(`Bearer ${SECRET_TOKEN}`);
    const body = await res.text();

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer error="invalid_token", ${METADATA}`,
    );
    expect(JSON.parse(body)).toEqual({
      code: 'invalid_token',
      message: expect.any(String),
    });
    expect(body).not.toContain(SECRET_TOKEN);
    expect(verifyAccessToken).toHaveBeenCalledWith(SECRET_TOKEN);
  });

  it('answers 503 when the keys cannot be read, without blaming the token', async () => {
    verifyAccessToken.mockRejectedValue(new TypeError('fetch failed'));

    const res = await call(`Bearer ${SECRET_TOKEN}`);
    const body = await res.text();

    expect(res.status).toBe(503);
    expect(res.headers.get('www-authenticate')).toBeNull();
    expect(JSON.parse(body)).toEqual({
      code: 'service_unavailable',
      message: expect.any(String),
    });
    expect(body).not.toContain('fetch failed');
  });

  it('passes a verified call on with what the token says', async () => {
    const auth: AuthInfo = {
      clientId: 'https://claude.ai/oauth/mcp-client',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      extra: { accountId: '7d4ad0a4-5f35-4c55-9b55-7f3d3b0a2b11' },
      scopes: ['motorfix.read'],
      token: SECRET_TOKEN,
    };
    verifyAccessToken.mockResolvedValue(auth);

    const res = await call(`Bearer ${SECRET_TOKEN}`);

    expect(res.status).toBe(200);
    expect((await res.json()).auth).toMatchObject({
      clientId: auth.clientId,
      extra: auth.extra,
    });
  });
});
