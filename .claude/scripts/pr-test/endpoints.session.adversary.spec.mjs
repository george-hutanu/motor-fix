// @traces 1230-FR-011
import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { SEEDED, seededSession, setLanguage } from './endpoints.mjs';

const servers = [];
afterEach(async () => {
  while (servers.length) await new Promise((r) => servers.pop().close(r));
});

async function api({ signInStatus = 200, patchStatus = 200, cookie = 'mf_refresh=refresh-abc; Path=/; HttpOnly', body = { accessToken: 'access-1' } } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
      if (req.url === '/api/v1/auth/sign-in') {
        res.writeHead(signInStatus, { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) });
        return res.end(JSON.stringify(body));
      }
      if (req.url === '/api/v1/me' && req.method === 'PATCH') {
        res.writeHead(patchStatus, { 'content-type': 'application/json' });
        return res.end('{}');
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

const closedPort = async () => {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
};

describe('the seeded session and the account language', () => {
  it('signs the role in, sets the language with the access token, and returns the refresh token', async () => {
    const a = await api();
    const refresh = await seededSession(a.url, 'pw')('driver', 'en');
    assert.equal(refresh, 'refresh-abc');
    assert.equal(a.seen.length, 2);
    assert.equal(a.seen[0].body.email, SEEDED.driver);
    assert.equal(a.seen[0].body.password, 'pw');
    assert.deepEqual(a.seen[1], { method: 'PATCH', url: '/api/v1/me', auth: 'Bearer access-1', body: { language: 'en' } });
  });

  it('sets the language each time it is asked, so ro then en then ro all land', async () => {
    const a = await api();
    const session = seededSession(a.url, 'pw');
    for (const lang of ['ro', 'en', 'ro']) await session('driver', lang);
    assert.deepEqual(a.seen.filter((s) => s.method === 'PATCH').map((s) => s.body.language), ['ro', 'en', 'ro']);
  });

  it('sets nothing when no language is asked for', async () => {
    const a = await api();
    await seededSession(a.url, 'pw')('driver');
    assert.deepEqual(a.seen.map((s) => s.method), ['POST']);
  });

  it('refuses a role that is not seeded before any call', async () => {
    const a = await api();
    await assert.rejects(seededSession(a.url, 'pw')('admin-of-everything', 'en'), /admin-of-everything/);
    assert.deepEqual(a.seen, []);
  });

  it('refuses a role named like an object property', async () => {
    const a = await api();
    for (const role of ['__proto__', 'constructor', 'toString']) await assert.rejects(seededSession(a.url, 'pw')(role, 'en'), /no seeded account/);
    assert.deepEqual(a.seen, []);
  });

  it('names the call and its status when the API refuses the language update', async () => {
    const a = await api({ patchStatus: 500 });
    await assert.rejects(seededSession(a.url, 'pw')('driver', 'en'), (e) => /PATCH \/api\/v1\/me/.test(e.message) && /500/.test(e.message) && /driver/.test(e.message));
  });

  it('names the status of a refused language update that is a client error too', async () => {
    const a = await api({ patchStatus: 422 });
    await assert.rejects(seededSession(a.url, 'pw')('garage', 'en'), /422/);
  });

  it('rejects when sign-in is refused, and sets no language', async () => {
    const a = await api({ signInStatus: 401 });
    await assert.rejects(seededSession(a.url, 'wrong')('driver', 'en'), /401/);
    assert.equal(a.seen.filter((s) => s.method === 'PATCH').length, 0);
  });

  it('rejects when sign-in answers with no access token', async () => {
    const a = await api({ body: {} });
    await assert.rejects(seededSession(a.url, 'pw')('driver', 'en'), /no access token/);
  });

  it('rejects, naming the call, when the API is unreachable for the language update', async () => {
    await assert.rejects(setLanguage(await closedPort(), 't', 'en', 'driver'), /PATCH \/api\/v1\/me.*failed/s);
  });

  it('rejects, not hangs or crashes, when sign-in cannot connect', async () => {
    await assert.rejects(seededSession(await closedPort(), 'pw')('driver', 'en'));
  });

  it('puts the language it was given in the body verbatim', async () => {
    const a = await api();
    await setLanguage(a.url, 't', 'e"n\\', 'driver');
    assert.equal(a.seen[0].body.language, 'e"n\\');
  });
});
