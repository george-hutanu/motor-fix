import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { SEEDED, callEndpoints, changedEndpoints, exampleValue, firstId, roleFor, seedPassword } from './endpoints.mjs';

const secured = { security: [{ bearer: [] }] };
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

describe('which operations changed', () => {
  const base = { paths: { '/health/live': { get: { summary: 'a' } }, '/garages': { get: { summary: 'old' } } } };
  const head = {
    paths: {
      '/health/live': { get: { summary: 'a' } },
      '/garages': { get: { summary: 'new' }, post: { summary: 'add' } },
      '/garages/{id}': { get: {}, patch: {}, delete: {}, parameters: [] },
      '/api/v1/auth/sign-out': { post: {} },
      '/quotes': { put: {} },
    },
  };

  it('lists every new or changed method, path parameters included, and nothing unchanged', () => {
    const list = changedEndpoints(base, head).map((e) => `${e.method} ${e.path}`);
    assert.deepEqual(list.slice().sort(), [
      'DELETE /garages/{id}',
      'GET /garages',
      'GET /garages/{id}',
      'PATCH /garages/{id}',
      'POST /api/v1/auth/sign-out',
      'POST /garages',
      'PUT /quotes',
    ]);
    assert.ok(!list.includes('GET /health/live'));
  });

  it('calls a sign-out last, so it cannot end the session the other calls use', () => {
    const list = changedEndpoints(base, head);
    assert.equal(list.at(-1).path, '/api/v1/auth/sign-out');
  });

  it('treats every operation as changed when the base has no document', () => {
    assert.deepEqual(changedEndpoints(null, { paths: { '/x': { get: {}, post: {} } } }).map((e) => e.method), ['GET', 'POST']);
  });
});

describe('who calls an operation', () => {
  it('is nobody for an open operation', () => {
    assert.equal(roleFor('/api/v1/auth/sign-in', {}), null);
  });

  it('is the role a path segment names, otherwise the driver', () => {
    assert.equal(roleFor('/api/v1/admin/news', secured), 'admin');
    assert.equal(roleFor('/api/v1/garage/jobs', secured), 'garage');
    assert.equal(roleFor('/api/v1/me', secured), 'driver');
  });

  it('signs in with the seeded accounts and their test password', () => {
    assert.equal(SEEDED.admin, 'admin@example.test');
    assert.equal(SEEDED.driver, 'sofer@example.test');
    assert.equal(seedPassword({}), 'parola-de-test');
    assert.equal(seedPassword({ SEED_PASSWORD: 'other' }), 'other');
  });
});

describe('a value for a schema', () => {
  const doc = {
    components: {
      schemas: {
        News: {
          type: 'object',
          required: ['title', 'audience', 'email', 'count', 'tags', 'when', 'inner'],
          properties: {
            title: { type: 'string', minLength: 5 },
            audience: { type: 'string', enum: ['drivers', 'garages'] },
            email: { type: 'string', format: 'email' },
            count: { type: 'integer', minimum: 3 },
            tags: { type: 'array', minItems: 1, items: { type: 'string', example: 'x' } },
            when: { type: 'string', format: 'date-time' },
            inner: { $ref: '#/components/schemas/Inner' },
            optional: { type: 'string' },
          },
        },
        Inner: { type: 'object', required: ['on'], properties: { on: { type: 'boolean' } } },
      },
    },
  };

  it('fills every required field and leaves the optional ones out', () => {
    const v = exampleValue({ $ref: '#/components/schemas/News' }, doc);
    assert.deepEqual(Object.keys(v).sort(), ['audience', 'count', 'email', 'inner', 'tags', 'title', 'when']);
    assert.ok(v.title.length >= 5);
    assert.equal(v.audience, 'drivers');
    assert.match(v.email, /^[^@]+@[^@]+\.[a-z]+$/);
    assert.equal(v.count, 3);
    assert.deepEqual(v.tags, ['x']);
    assert.ok(!Number.isNaN(Date.parse(v.when)));
    assert.deepEqual(v.inner, { on: true });
  });

  it('prefers the example, then the default', () => {
    assert.equal(exampleValue({ type: 'string', example: 'ro', default: 'en' }, doc), 'ro');
    assert.equal(exampleValue({ type: 'string', default: 'en' }, doc), 'en');
  });

  it('takes the first branch of a oneOf or allOf', () => {
    assert.equal(exampleValue({ oneOf: [{ type: 'integer' }, { type: 'string' }] }, doc), 1);
    assert.deepEqual(exampleValue({ allOf: [{ $ref: '#/components/schemas/Inner' }] }, doc), { on: true });
  });
});

describe('an id from a collection', () => {
  it('is the first item of the list, wherever the list is', () => {
    assert.equal(firstId([{ id: 'a' }, { id: 'b' }], 'id'), 'a');
    assert.equal(firstId({ items: [{ id: 'c' }], nextCursor: null }, 'id'), 'c');
    assert.equal(firstId({ data: [{ garageId: 'g', id: 'x' }] }, 'garageId'), 'g');
  });

  it('is null for an empty list or no list', () => {
    assert.equal(firstId({ items: [] }, 'id'), null);
    assert.equal(firstId({ count: 3 }, 'id'), null);
  });
});

describe('calling the changed operations', () => {
  /** A fake API: sign-in for the seeded accounts, a list, and whatever `routes` adds. */
  async function fakeApi(routes = {}) {
    const seen = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, cookie: req.headers.cookie, body });
        const send = (status, json, headers = {}) => {
          res.writeHead(status, { 'content-type': 'application/json', ...headers });
          res.end(JSON.stringify(json));
        };
        if (req.url === '/api/v1/auth/sign-in') {
          const role = Object.entries(SEEDED).find(([, email]) => email === body.email)?.[0];
          if (!role || body.password !== 'parola-de-test') return send(401, { code: 'invalid_credentials' });
          return send(200, { accessToken: `token-${role}` }, { 'set-cookie': `mf_refresh=refresh-${role}; Path=/api/v1/auth; HttpOnly` });
        }
        const route = routes[`${req.method} ${req.url}`];
        if (route) return send(...route);
        send(404, { code: 'not_found' });
      });
    });
    const port = await listen(server);
    return { server, seen, apiURL: `http://127.0.0.1:${port}` };
  }

  const doc = {
    paths: {
      '/api/v1/notifications': { get: { ...secured } },
      '/api/v1/notifications/{id}/read': { post: { ...secured, parameters: [{ in: 'path', name: 'id', required: true }] } },
      '/api/v1/admin/news': {
        post: {
          ...secured,
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } } } },
        },
      },
      '/api/v1/garages/{garageId}/jobs': { get: { ...secured, parameters: [{ in: 'path', name: 'garageId', required: true }] } },
      '/api/v1/notification-preferences/unsubscribe': { post: { parameters: [{ in: 'query', name: 'token', required: true, schema: { type: 'string', example: 'tok' } }] } },
      '/api/v1/auth/sign-out': { post: {} },
      '/api/v1/boom': { get: {} },
    },
  };
  const endpoints = changedEndpoints(null, doc).filter((e) => e.path !== '/api/v1/notifications');

  it('signs in as the right role, takes the id from the parent list and builds the body', async () => {
    const api = await fakeApi({
      'GET /api/v1/notifications': [200, { items: [{ id: 'n1' }] }],
      'POST /api/v1/notifications/n1/read': [204, {}],
      'POST /api/v1/admin/news': [201, { id: 'news-1' }],
      'POST /api/v1/notification-preferences/unsubscribe?token=tok': [200, {}],
      'POST /api/v1/auth/sign-out': [204, {}],
      'GET /api/v1/boom': [500, { code: 'internal_error' }],
    });
    try {
      const out = await callEndpoints({ apiURL: api.apiURL, endpoints, doc, password: 'parola-de-test' });
      const read = api.seen.find((s) => s.url === '/api/v1/notifications/n1/read');
      assert.equal(read.auth, 'Bearer token-driver');
      const news = api.seen.find((s) => s.url === '/api/v1/admin/news');
      assert.equal(news.auth, 'Bearer token-admin');
      assert.deepEqual(Object.keys(news.body), ['title']);
      const signOut = api.seen.find((s) => s.url === '/api/v1/auth/sign-out');
      assert.equal(signOut.auth, undefined, 'an open operation is called without a token');
      assert.match(signOut.cookie ?? '', /mf_refresh=refresh-driver/);
      assert.equal(api.seen.at(-1).url, '/api/v1/auth/sign-out');
      assert.ok(api.seen.some((s) => s.url === '/api/v1/notification-preferences/unsubscribe?token=tok'));

      assert.ok(out.called.includes('POST /api/v1/notifications/n1/read → 204'));
      assert.ok(out.called.includes('POST /api/v1/admin/news → 201'));
      assert.equal(out.findings.length, 1);
      assert.equal(out.findings[0].severity, 'high');
      assert.match(out.findings[0].title, /GET \/api\/v1\/boom answered 500/);
    } finally {
      await close(api.server);
    }
  });

  it('names each operation it could not call, with the reason', async () => {
    const api = await fakeApi({ 'GET /api/v1/notifications': [200, { items: [] }], 'GET /api/v1/garages': [404, {}] });
    try {
      const out = await callEndpoints({ apiURL: api.apiURL, endpoints, doc, password: 'parola-de-test' });
      const read = out.skipped.find((s) => s.startsWith('POST /api/v1/notifications/{id}/read'));
      assert.match(read, /no item in GET \/api\/v1\/notifications/);
      const jobs = out.skipped.find((s) => s.startsWith('GET /api/v1/garages/{garageId}/jobs'));
      assert.match(jobs, /GET \/api\/v1\/garages answered 404/);
    } finally {
      await close(api.server);
    }
  });

  it('names the operations it could not sign in for', async () => {
    const api = await fakeApi();
    try {
      const out = await callEndpoints({ apiURL: api.apiURL, endpoints, doc, password: 'wrong' });
      const news = out.skipped.find((s) => s.startsWith('POST /api/v1/admin/news'));
      assert.match(news, /could not sign in as admin.*401/);
      assert.equal(api.seen.filter((s) => s.url === '/api/v1/auth/sign-in').length, 2, 'one sign-in attempt per role');
    } finally {
      await close(api.server);
    }
  });
});
