import type { INestApplication } from '@nestjs/common';

import { bootMcp } from '../boot.testing';

const METADATA =
  'http://127.0.0.1:3002/.well-known/oauth-protected-resource/mcp';
const JWT_LIKE = 'eyJhbGciOiJub25lIn0.eyJzZWNyZXQiOiJTVVBFUlNFQ1JFVCJ9.c2ln';

describe('the MCP endpoint under hostile requests', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    ({ app, base } = await bootMcp());
  });

  afterAll(() => app.close());

  const post = (headers: Record<string, string> = {}, body = '{}') =>
    fetch(`${base}/mcp`, {
      body,
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...headers,
      },
      method: 'POST',
    });

  it.each([
    ['basic scheme', 'Basic dXNlcjpwYXNz'],
    ['bearer without a token', 'Bearer '],
    ['bearer alone', 'Bearer'],
    ['a token with no scheme', JWT_LIKE],
    ['an empty header', ' '],
  ])(
    'answers 401 sign_in_required or invalid_token for %s',
    async (_name, authorization) => {
      const res = await post({ authorization });

      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(
        `resource_metadata="${METADATA}"`,
      );
      expect((await res.json()).code).toMatch(
        /^(sign_in_required|invalid_token)$/,
      );
    },
  );

  it('does not echo a malformed bearer token in the body or the challenge', async () => {
    const res = await post({ authorization: `Bearer ${JWT_LIKE}` });
    const text =
      JSON.stringify([...res.headers.entries()]) + (await res.text());

    expect(res.status).toBe(401);
    expect(text).not.toContain(JWT_LIKE);
    expect(text).not.toContain('SUPERSECRET');
    expect(text).not.toContain('eyJzZWNyZXQiOiJTVVBFUlNFQ1JFVCJ9');
  });

  it('answers 401 for an alg none token with error invalid_token', async () => {
    const res = await post({ authorization: `Bearer ${JWT_LIKE}` });

    expect(res.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
    expect((await res.json()).code).toBe('invalid_token');
  });

  it('answers 401 before parsing a body that is not JSON', async () => {
    const res = await post({}, '{not json');

    expect(res.status).toBe(401);
  });

  it('answers 401 and not 500 when the body is empty and no token is given', async () => {
    const res = await post({}, '');

    expect(res.status).toBe(401);
  });

  it.each(['GET', 'DELETE'])(
    'answers 405 method_not_allowed to %s with a token',
    async (method) => {
      const res = await fetch(`${base}/mcp`, {
        headers: { authorization: `Bearer ${JWT_LIKE}` },
        method,
      });

      expect(res.status).toBe(405);
      expect(await res.json()).toMatchObject({ code: 'method_not_allowed' });
    },
  );

  it.each(['GET', 'DELETE'])(
    'answers 405 method_not_allowed to %s without a token',
    async (method) => {
      const res = await fetch(`${base}/mcp`, { method });

      expect(res.status).toBe(405);
      expect(await res.json()).toMatchObject({ code: 'method_not_allowed' });
    },
  );

  it('replaces an X-Request-Id with spaces or markup by a generated one', async () => {
    const res = await post({ 'x-request-id': '<script> alert(1) </script>' });

    const id = res.headers.get('x-request-id');
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[\w.-]{1,128}$/);
  });

  it('replaces an X-Request-Id longer than 128 characters', async () => {
    const res = await post({ 'x-request-id': 'a'.repeat(129) });

    expect(res.headers.get('x-request-id')).not.toBe('a'.repeat(129));
  });

  it('keeps an X-Request-Id of exactly 128 characters', async () => {
    const res = await post({ 'x-request-id': 'a'.repeat(128) });

    expect(res.headers.get('x-request-id')).toBe('a'.repeat(128));
  });

  it('serves the protected resource metadata on both paths with the contract shape', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const res = await fetch(`${base}${path}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        authorization_servers: [
          'http://127.0.0.1:1/realms/motorfix-assistants',
        ],
        bearer_methods_supported: ['header'],
        resource: 'http://127.0.0.1:3002/mcp',
        scopes_supported: ['motorfix.read', 'motorfix.act'],
      });
    }
  });

  it('does not put a database address or a password into any refusal', async () => {
    const res = await post({ authorization: `Bearer ${JWT_LIKE}` });
    const text = await res.text();

    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).not.toContain('127.0.0.1:1');
  });
});
