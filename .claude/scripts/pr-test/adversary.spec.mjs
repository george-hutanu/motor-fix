import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEEDED, callEndpoints, changedEndpoints, exampleValue, firstId, roleFor, seedPassword } from './endpoints.mjs';
import { cutOffFinding, readinessOutcome } from './findings.mjs';
import { cleanStale, createBucket, localPlan, runDirPrefix, appEnv } from './services.mjs';
import { missingReport, postVerdict } from './post.mjs';
import { dropExpected, loadProblem, parseRoute, sessionCookie } from './sweep.mjs';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const secured = { security: [{ bearer: [] }] };
const listen = (server, port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => server.close(() => resolve()));

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'adversary-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

describe('which operations changed, hostile documents', () => {
  it('is empty when nothing differs', () => {
    const doc = { paths: { '/a': { get: { summary: 'x' } } } };
    assert.deepEqual(changedEndpoints(doc, structuredClone(doc)), []);
  });

  it('is empty for a head with no paths', () => {
    assert.deepEqual(changedEndpoints({ paths: { '/a': { get: {} } } }, {}), []);
    assert.deepEqual(changedEndpoints(null, { paths: {} }), []);
  });

  it('treats an operation whose keys are only reordered as unchanged', () => {
    const base = { paths: { '/a': { get: { summary: 's', description: 'd' } } } };
    const head = { paths: { '/a': { get: { description: 'd', summary: 's' } } } };
    assert.deepEqual(changedEndpoints(base, head), []);
  });

  it('does not list an operation that was removed', () => {
    const base = { paths: { '/a': { get: {}, post: {} } } };
    const head = { paths: { '/a': { get: {} } } };
    assert.deepEqual(changedEndpoints(base, head), []);
  });

  it('never turns a path-level field into an operation', () => {
    const head = { paths: { '/a': { summary: 'x', description: 'y', servers: [], 'x-internal': true, parameters: [], get: {} } } };
    assert.deepEqual(changedEndpoints(null, head).map((e) => `${e.method} ${e.path}`), ['GET /a']);
  });

  it('treats a base without a paths key as having no operations', () => {
    assert.deepEqual(changedEndpoints({}, { paths: { '/a': { delete: {} } } }).map((e) => e.method), ['DELETE']);
  });

  it('puts every sign-out last, whatever its spelling', () => {
    const head = { paths: { '/api/v1/auth/sign-out-all': { post: {} }, '/z': { get: {} }, '/api/v1/auth/sign-out': { post: {} }, '/a': { get: {} } } };
    const list = changedEndpoints(null, head).map((e) => e.path);
    assert.deepEqual(new Set(list.slice(-2)), new Set(['/api/v1/auth/sign-out-all', '/api/v1/auth/sign-out']));
  });
});

describe('who calls an operation, hostile paths', () => {
  it('is nobody when security is an explicit empty list', () => {
    assert.equal(roleFor('/api/v1/admin/news', { security: [] }), null);
  });

  it('is nobody for an open operation under a role path', () => {
    assert.equal(roleFor('/api/v1/admin/health', {}), null);
  });

  it('matches whole segments only', () => {
    assert.equal(roleFor('/api/v1/administrators', secured), 'driver');
    assert.equal(roleFor('/api/v1/superadmin/x', secured), 'driver');
  });

  it('finds a role in the last segment', () => {
    assert.equal(roleFor('/api/v1/admin', secured), 'admin');
    assert.equal(roleFor('/api/v1/receptionist', secured), 'receptionist');
    assert.equal(roleFor('/api/v1/mechanic/jobs/{id}', secured), 'mechanic');
  });

  it('gives each role its own seeded account', () => {
    assert.deepEqual(SEEDED, {
      admin: 'admin@example.test',
      driver: 'sofer@example.test',
      garage: 'service@example.test',
      mechanic: 'mecanic@example.test',
      receptionist: 'receptie@example.test',
    });
  });

  it('falls back to the default password when the variable is empty', () => {
    assert.equal(seedPassword({ SEED_PASSWORD: '' }), 'parola-de-test');
    assert.equal(seedPassword({ SEED_PASSWORD: undefined }), 'parola-de-test');
  });
});

describe('a value for a hostile schema', () => {
  const doc = {
    components: {
      schemas: {
        Node: { type: 'object', required: ['next'], properties: { next: { $ref: '#/components/schemas/Node' } } },
        Tree: { type: 'object', required: ['children'], properties: { children: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/Tree' } } } },
        A: { type: 'object', required: ['b'], properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', required: ['a'], properties: { a: { $ref: '#/components/schemas/A' } } },
        Loop: { $ref: '#/components/schemas/Loop' },
      },
    },
  };

  it('ends on a schema that requires itself', () => {
    const v = exampleValue({ $ref: '#/components/schemas/Node' }, doc);
    assert.equal(typeof v, 'object');
    assert.doesNotThrow(() => JSON.stringify(v));
  });

  it('ends on a tree whose array must hold itself', () => {
    const v = exampleValue({ $ref: '#/components/schemas/Tree' }, doc);
    assert.doesNotThrow(() => JSON.stringify(v));
    assert.ok(Array.isArray(v.children));
  });

  it('ends on two schemas that require each other', () => {
    const v = exampleValue({ $ref: '#/components/schemas/A' }, doc);
    assert.doesNotThrow(() => JSON.stringify(v));
  });

  it('ends on a reference that points only at itself', () => {
    const script = `import { exampleValue } from ${JSON.stringify(new URL('./endpoints.mjs', import.meta.url).href)};
      try { exampleValue({ $ref: '#/components/schemas/Loop' }, { components: { schemas: { Loop: { $ref: '#/components/schemas/Loop' } } } }); } catch {}`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000 });
    assert.equal(r.error, undefined, 'it did not end within five seconds');
    assert.equal(r.status, 0);
  });

  it('keeps a falsy enum value', () => {
    assert.equal(exampleValue({ type: 'integer', enum: [0, 1] }, doc), 0);
    assert.equal(exampleValue({ type: 'boolean', enum: [false] }, doc), false);
    assert.equal(exampleValue({ type: 'string', enum: [''] }, doc), '');
  });

  it('keeps a falsy example and default', () => {
    assert.equal(exampleValue({ type: 'integer', example: 0, default: 5 }, doc), 0);
    assert.equal(exampleValue({ type: 'boolean', example: false }, doc), false);
    assert.equal(exampleValue({ type: 'integer', default: 0 }, doc), 0);
    assert.equal(exampleValue({ type: 'boolean', default: false }, doc), false);
    assert.equal(exampleValue({ type: 'string', example: '' }, doc), '');
  });

  it('honours a zero or negative minimum', () => {
    assert.ok(exampleValue({ type: 'integer', minimum: 0 }, doc) >= 0);
    assert.ok(exampleValue({ type: 'integer', minimum: -5 }, doc) >= -5);
    assert.ok(exampleValue({ type: 'number', minimum: 2.5 }, doc) >= 2.5);
    assert.ok(exampleValue({ type: 'integer', minimum: 100 }, doc) >= 100);
  });

  it('honours a long minLength and a large minItems', () => {
    assert.ok(exampleValue({ type: 'string', minLength: 300 }, doc).length >= 300);
    assert.ok(exampleValue({ type: 'array', minItems: 4, items: { type: 'integer' } }, doc).length >= 4);
  });

  it('builds the common formats', () => {
    assert.match(exampleValue({ type: 'string', format: 'uuid' }, doc), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.match(exampleValue({ type: 'string', format: 'date' }, doc), /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotThrow(() => new URL(exampleValue({ type: 'string', format: 'uri' }, doc)));
  });

  it('gives a whole number for an int64 integer', () => {
    assert.ok(Number.isInteger(exampleValue({ type: 'integer', format: 'int64' }, doc)));
  });

  it('gives an empty object for an object with nothing required', () => {
    assert.deepEqual(exampleValue({ type: 'object', properties: { a: { type: 'string' } } }, doc), {});
  });

  it('gives a string for a nullable string', () => {
    assert.equal(typeof exampleValue({ type: 'string', nullable: true }, doc), 'string');
  });

  it('gives null or a string for a oneOf that starts with null', () => {
    const v = exampleValue({ oneOf: [{ type: 'null' }, { type: 'string' }] }, doc);
    assert.ok(v === null || typeof v === 'string');
  });

  it('gives a boolean for a boolean and a string for a bare string', () => {
    assert.equal(typeof exampleValue({ type: 'boolean' }, doc), 'boolean');
    assert.equal(typeof exampleValue({ type: 'string' }, doc), 'string');
  });
});

describe('an id from a hostile response', () => {
  it('is null when there is nothing to read', () => {
    for (const json of [null, undefined, 'text', 42, [], {}, [null], ['x'], [[{ id: 'a' }]]]) {
      assert.equal(firstId(json, 'id'), null, JSON.stringify(json));
    }
  });

  it('keeps an id of zero', () => {
    assert.equal(firstId([{ id: 0 }], 'id'), 0);
  });

  it('is null when the first item has no id although a later one does', () => {
    assert.equal(firstId([{ name: 'x' }, { id: 'b' }], 'id'), null);
  });

  it('is null when the id is null', () => {
    assert.equal(firstId([{ id: null }], 'id'), null);
  });

  it('falls back to the id when the item has no field named like the parameter', () => {
    assert.equal(firstId([{ id: 'x' }], 'garageId'), 'x');
  });

  it('is not fooled by a parameter named like an inherited property', () => {
    assert.equal(firstId([{ id: 'a' }], 'constructor'), 'a');
    assert.equal(firstId([{ id: 'a' }], 'toString'), 'a');
    assert.equal(firstId([{ id: 'a' }], '__proto__'), 'a');
  });

  it('reads a numeric id as the number', () => {
    assert.equal(String(firstId({ items: [{ id: 7 }] }, 'id')), '7');
  });

  it('finds a list one level further down', () => {
    assert.equal(firstId({ data: { items: [{ id: 'deep' }] } }, 'id'), 'deep');
  });
});

describe('calling the changed operations, hostile answers', () => {
  /** A fake API; `handler(req, body)` answers `[status, json | string, headers?]`, sign-in is built in. */
  async function api(handler = () => [404, {}], { signIn } = {}) {
    const seen = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let body;
        try {
          body = raw ? JSON.parse(raw) : undefined;
        } catch {
          body = { unparsable: raw };
        }
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, cookie: req.headers.cookie, type: req.headers['content-type'], body });
        const send = (status, payload, headers = {}) => {
          res.writeHead(status, { 'content-type': 'application/json', ...headers });
          res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
        };
        if (req.url === '/api/v1/auth/sign-in') {
          if (signIn) return send(...signIn(body));
          const role = Object.entries(SEEDED).find(([, email]) => email === body?.email)?.[0];
          if (!role || body.password !== 'parola-de-test') return send(401, { code: 'invalid_credentials' });
          return send(200, { accessToken: `token-${role}` }, { 'set-cookie': `mf_refresh=refresh-${role}; Path=/api/v1/auth; HttpOnly` });
        }
        send(...handler(req, body));
      });
    });
    const port = await listen(server);
    cleanups.push(() => close(server));
    return { seen, apiURL: `http://127.0.0.1:${port}`, server };
  }
  const opts = (apiURL, doc, endpoints = changedEndpoints(null, doc)) => ({ apiURL, endpoints, doc, password: 'parola-de-test' });

  it('has nothing to say for no endpoints, and signs nobody in', async () => {
    const a = await api();
    const out = await callEndpoints(opts(a.apiURL, { paths: {} }, []));
    assert.deepEqual([out.called, out.skipped, out.findings], [[], [], []]);
    assert.equal(a.seen.length, 0);
  });

  it('raises a finding from 500 up, and not for 499 or below', async () => {
    const doc = { paths: {} };
    const statuses = [200, 301, 400, 401, 403, 404, 422, 429, 499, 500, 501, 503, 599];
    for (const s of statuses) doc.paths[`/s${s}`] = { get: {} };
    const a = await api((req) => [Number(req.url.slice(2)), { code: 'x' }]);
    const out = await callEndpoints(opts(a.apiURL, doc));
    const flagged = out.findings.map((f) => f.title.match(/\/s(\d+)/)?.[1]).sort();
    assert.deepEqual(flagged, ['500', '501', '503', '599']);
    for (const f of out.findings) assert.equal(f.severity, 'high');
    assert.equal(out.called.length, statuses.length);
  });

  it('calls each method with its own verb', async () => {
    const doc = { paths: { '/a': { get: {}, post: {}, put: {}, patch: {}, delete: {} } } };
    const a = await api(() => [200, {}]);
    const out = await callEndpoints(opts(a.apiURL, doc));
    assert.deepEqual(a.seen.map((s) => s.method).sort(), ['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
    assert.equal(out.called.length, 5);
  });

  it('percent-encodes an id taken from the parent list', async () => {
    const doc = {
      paths: {
        '/api/v1/things': { get: secured },
        '/api/v1/things/{id}/read': { post: { ...secured, parameters: [{ in: 'path', name: 'id', required: true }] } },
      },
    };
    const a = await api((req) => (req.url === '/api/v1/things' ? [200, { items: [{ id: 'a b/c?d#é' }] }] : [204, {}]));
    const endpoints = changedEndpoints(null, doc).filter((e) => e.path.includes('{id}'));
    await callEndpoints(opts(a.apiURL, doc, endpoints));
    const call = a.seen.find((s) => s.method === 'POST' && s.url !== '/api/v1/auth/sign-in');
    assert.equal(call.url, `/api/v1/things/${encodeURIComponent('a b/c?d#é')}/read`);
  });

  it('percent-encodes a required query parameter and leaves out an optional one', async () => {
    const doc = {
      paths: {
        '/q': {
          get: {
            parameters: [
              { in: 'query', name: 'token', required: true, schema: { type: 'string', example: 'a b&c=d' } },
              { in: 'query', name: 'extra', required: false, schema: { type: 'string', example: 'nope' } },
            ],
          },
        },
      },
    };
    const a = await api(() => [200, {}]);
    await callEndpoints(opts(a.apiURL, doc));
    assert.equal(a.seen[0].url, `/q?token=${encodeURIComponent('a b&c=d')}`);
  });

  it('sends a JSON content type with a body that parses', async () => {
    const doc = { paths: { '/p': { post: { requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 0 } } } } } } } } } };
    const a = await api(() => [201, {}]);
    await callEndpoints(opts(a.apiURL, doc));
    assert.match(a.seen[0].type, /^application\/json/);
    assert.deepEqual(a.seen[0].body, { n: 0 });
  });

  it('names an operation it cannot sign in for when sign-in answers without a token', async () => {
    for (const answer of [[200, {}], [200, 'not json'], [200, { accessToken: null }], [500, { code: 'x' }]]) {
      const doc = { paths: { '/api/v1/me': { get: secured } } };
      const a = await api(() => [200, {}], { signIn: () => answer });
      const out = await callEndpoints(opts(a.apiURL, doc));
      assert.equal(a.seen.some((s) => s.url === '/api/v1/me'), false, JSON.stringify(answer));
      assert.equal(a.seen.some((s) => /undefined|null/.test(s.auth ?? '')), false);
      assert.match(out.skipped.join('\n'), /GET \/api\/v1\/me/);
    }
  });

  it('signs in once per role however many operations use it, and does not retry a refused one', async () => {
    const doc = { paths: { '/api/v1/admin/a': { get: secured }, '/api/v1/admin/b': { get: secured }, '/api/v1/admin/c': { post: secured }, '/api/v1/me': { get: secured } } };
    const a = await api(() => [200, {}]);
    await callEndpoints(opts(a.apiURL, doc));
    const signIns = a.seen.filter((s) => s.url === '/api/v1/auth/sign-in');
    assert.equal(signIns.length, 2);

    const b = await api(() => [200, {}]);
    await callEndpoints({ ...opts(b.apiURL, doc), password: 'wrong' });
    assert.equal(b.seen.filter((s) => s.url === '/api/v1/auth/sign-in').length, 2);
  });

  it('calls a sign-out last even when it is handed over first', async () => {
    const doc = { paths: { '/api/v1/auth/sign-out': { post: {} }, '/a': { get: {} }, '/b': { get: {} } } };
    const a = await api(() => [204, {}]);
    const endpoints = changedEndpoints(null, doc).sort((x, y) => (x.path.includes('sign-out') ? -1 : y.path.includes('sign-out') ? 1 : 0));
    assert.equal(endpoints[0].path, '/api/v1/auth/sign-out');
    await callEndpoints(opts(a.apiURL, doc, endpoints));
    assert.equal(a.seen.at(-1).url, '/api/v1/auth/sign-out');
  });

  it('gives a secured operation under auth both the token and the refresh cookie', async () => {
    const doc = { paths: { '/api/v1/auth/sessions': { get: secured } } };
    const a = await api(() => [200, {}]);
    await callEndpoints(opts(a.apiURL, doc));
    const call = a.seen.find((s) => s.url === '/api/v1/auth/sessions');
    assert.equal(call.auth, 'Bearer token-driver');
    assert.match(call.cookie ?? '', /mf_refresh=refresh-driver/);
  });

  it('names an operation whose parent list is not JSON', async () => {
    const doc = {
      paths: {
        '/api/v1/things': { get: {} },
        '/api/v1/things/{id}': { delete: { parameters: [{ in: 'path', name: 'id', required: true }] } },
      },
    };
    const a = await api((req) => (req.url === '/api/v1/things' ? [200, '<html>nope</html>'] : [204, {}]));
    const endpoints = changedEndpoints(null, doc).filter((e) => e.method === 'DELETE');
    const out = await callEndpoints(opts(a.apiURL, doc, endpoints));
    assert.match(out.skipped.join('\n'), /DELETE \/api\/v1\/things\/\{id\}/);
    assert.equal(a.seen.some((s) => s.method === 'DELETE'), false);
  });

  it('names every operation when the API is unreachable', async () => {
    const a = await api();
    await close(a.server);
    const doc = { paths: { '/x': { get: {} }, '/api/v1/me': { get: secured } } };
    const out = await callEndpoints(opts(a.apiURL, doc));
    const everything = [...out.called, ...out.skipped, ...out.findings.map((f) => f.title)].join('\n');
    assert.match(everything, /GET \/x/);
    assert.match(everything, /GET \/api\/v1\/me/);
  });

  it('lists every call of a large document', async () => {
    const doc = { paths: {} };
    for (let i = 0; i < 300; i++) doc.paths[`/bulk/${i}`] = { get: {} };
    const a = await api(() => [200, {}]);
    const out = await callEndpoints(opts(a.apiURL, doc));
    assert.equal(out.called.length, 300);
    assert.equal(out.skipped.length, 0);
  });
});

describe('readiness answers that are not what was expected', () => {
  const url = 'http://x/health/ready';
  const ask = (body, over = {}) => readinessOutcome({ name: 'api', status: 503, body, storage: false, url, ...over });

  it('blocks on any 503 whose body names no failed check', () => {
    for (const body of ['', '<html>', 'null', '[]', '"storage"', '42', '{}', '{"checks":null}', '{"checks":[]}', '{"checks":{"storage":"ok"}}']) {
      const out = ask(body);
      assert.equal(out.finding?.severity, 'blocker', body);
      assert.equal(out.note, undefined, body);
    }
  });

  it('blocks when there was no answer at all', () => {
    assert.equal(ask('', { status: null }).finding.severity, 'blocker');
    assert.equal(ask('', { status: undefined }).finding.severity, 'blocker');
  });

  it('says nothing on 200 whatever the body', () => {
    assert.deepEqual(ask('not json', { status: 200 }), {});
    assert.deepEqual(ask('', { status: 200 }), {});
  });

  it('is a note when storage fails in a way other than down', () => {
    const out = ask(JSON.stringify({ status: 'error', checks: { postgres: 'ok', redis: 'ok', storage: 'timeout' } }));
    assert.equal(out.finding, undefined);
    assert.match(out.note, /storage/);
  });

  it('blocks when another check is not ok, whatever its word for it', () => {
    const out = ask(JSON.stringify({ checks: { postgres: 'degraded', redis: 'ok', storage: 'down' } }));
    assert.equal(out.finding.severity, 'blocker');
    assert.match(out.finding.title, /postgres/);
  });

  it('names the worker in its note', () => {
    const out = ask(JSON.stringify({ checks: { postgres: 'ok', redis: 'ok', storage: 'down' } }), { name: 'worker' });
    assert.match(out.note, /worker/);
  });

  it('does not carry a huge body into the finding', () => {
    const out = ask('x'.repeat(10 * 1024 * 1024), { status: 502 });
    assert.equal(out.finding.severity, 'blocker');
    assert.ok(JSON.stringify(out).length < 100000);
  });
});

describe('a lap cut off', () => {
  it('names each of the three signals', () => {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const f = cutOffFinding(signal, 'booting');
      assert.equal(f.severity, 'blocker');
      assert.match(f.title, new RegExp(signal));
      assert.match(f.title, /booting/);
    }
  });
});

describe('a missing report, hostile reasons', () => {
  const base = { pr: 21, repo: 'george-hutanu/motor-fix', sha: 'abc1234def', lap: 1 };

  it('is a failure with one blocker even for an empty or absent reason, never printing undefined', () => {
    for (const reason of ['', undefined, null]) {
      const r = missingReport({ ...base, reason });
      assert.equal(r.verdict, 'failure');
      assert.equal(r.findings.length, 1);
      assert.equal(r.findings[0].severity, 'blocker');
      assert.doesNotMatch(r.summary, /undefined|null/);
    }
  });

  it('keeps a multi-line reason with markdown and unicode', () => {
    const reason = 'killed\n`SIGKILL` **now** <b>x</b> în fază ☃';
    const r = missingReport({ ...base, reason });
    assert.equal(r.verdict, 'failure');
    assert.match(r.markdown, /SIGKILL/);
    assert.match(r.markdown, /☃/);
  });

  it('keeps the status description within what GitHub accepts, however long the reason', () => {
    for (const reason of ['x'.repeat(100000), 'é'.repeat(500)]) {
      const r = missingReport({ ...base, reason });
      const calls = [];
      const gh = (args, o = {}) => {
        calls.push({ args, input: o.input });
        if (args.join(' ').includes('pr view')) return { code: 0, stdout: JSON.stringify({ body: 'Notion story: x' }), stderr: '' };
        return { code: 0, stdout: '{}', stderr: '' };
      };
      postVerdict({ pr: r.pr, repo: r.repo, sha: r.sha, verdict: r.verdict, summary: r.summary, body: r.markdown, lap: r.lap, gh, cloud: false });
      const status = calls.find((c) => c.args.some((x) => /statuses\/abc1234def$/.test(x)));
      assert.ok(status, 'a status was set');
      const description = status.args.find((x) => x.startsWith('description=')).slice('description='.length);
      assert.ok([...description].length <= 140, `description has ${[...description].length} characters`);
      assert.ok(status.args.includes('state=failure'));
    }
  });
});

describe('the route syntax, odd routes', () => {
  it('reads a plain root', () => {
    assert.deepEqual(parseRoute('/'), { path: '/', role: null, expect: null });
  });

  it('never gives a status that is not a whole number', () => {
    for (const spec of ['/a:b@c', '/de:', '/de:abc', '/de:404x', '/de:-1', '/de:4.5']) {
      const r = parseRoute(spec);
      assert.ok(r.expect === null || Number.isInteger(r.expect), `${spec} gave ${r.expect}`);
      assert.ok(r.path.startsWith('/'), `${spec} gave path ${r.path}`);
    }
  });

  it('ignores a status that is not a status', () => {
    for (const spec of ['/de:', '/de:abc', '/de:404x']) assert.equal(parseRoute(spec).expect, null, spec);
  });

  it('gives no empty role for a trailing @', () => {
    const r = parseRoute('/x@');
    assert.ok(r.role === null, `role was ${JSON.stringify(r.role)}`);
  });

  it('either refuses a role with no path or gives it a path', () => {
    let r;
    try {
      r = parseRoute('@driver');
    } catch {
      return;
    }
    assert.ok(r.path.startsWith('/'), `path was ${JSON.stringify(r.path)}`);
  });

  it('keeps a colon in a query that is not a status', () => {
    const r = parseRoute('/s?t=12:30');
    assert.equal(r.expect, null);
    assert.equal(r.path, '/s?t=12:30');
  });

  it('reads a unicode path with a status', () => {
    assert.deepEqual(parseRoute('/ștefan:404'), { path: '/ștefan', role: null, expect: 404 });
  });
});

describe('the load verdict, odd answers', () => {
  it('names the status in both directions', () => {
    assert.match(loadProblem(500, 404), /HTTP 500, expected 404/);
    assert.match(loadProblem(404, 200), /HTTP 404, expected 200/);
    assert.equal(loadProblem(200, 200), null);
    assert.equal(loadProblem(500, 500), null);
    assert.equal(loadProblem(204, null), null);
  });

  it('is no response when nothing came back, expected status or not', () => {
    assert.match(loadProblem(null, 404), /no response/);
    assert.match(loadProblem(undefined, null), /no response/);
  });
});

describe('what an expected status drops, odd observations', () => {
  const at = { route: '/de:404', path: '/de', expect: 404, viewport: 'desktop', scheme: 'light', lang: 'ro' };

  it('is empty for no observations and does not change its input', () => {
    assert.deepEqual(dropExpected([]), []);
    const obs = [{ ...at, kind: 'http', url: 'http://x/de', status: 404 }];
    const copy = structuredClone(obs);
    dropExpected(obs);
    assert.deepEqual(obs, copy);
  });

  it('keeps a different status on the expected page', () => {
    const kept = dropExpected([
      { ...at, kind: 'http', url: 'http://x/de', status: 401 },
      { ...at, kind: 'console', text: 'Failed to load resource: the server responded with a status of 401 (Unauthorized)' },
    ]);
    assert.equal(kept.length, 2);
  });

  it('keeps a load observation of the page, which is the wrong-status finding', () => {
    const kept = dropExpected([{ ...at, kind: 'load', text: 'HTTP 200, expected 404' }]);
    assert.equal(kept.length, 1);
  });

  it('keeps everything from a page that expects nothing', () => {
    const none = { route: '/', path: '/', viewport: 'desktop', scheme: 'light', lang: 'ro' };
    const obs = [
      { ...none, kind: 'http', url: 'http://x/', status: 404 },
      { ...none, expect: undefined, kind: 'console', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)' },
    ];
    assert.equal(dropExpected(obs).length, 2);
  });

  it('keeps the same status seen on another route', () => {
    const other = { ...at, route: '/other', path: '/other', expect: null };
    assert.equal(dropExpected([{ ...other, kind: 'http', url: 'http://x/other', status: 404 }]).length, 1);
  });
});

describe('the session cookie, odd origins', () => {
  it('keeps a refresh token exactly, whatever characters it holds', () => {
    const refresh = 'a.b-c_d=e;f g%20é+/';
    assert.equal(sessionCookie({ refresh, baseURL: 'http://127.0.0.1:4100' }).value, refresh);
  });

  it('takes the host without port or path from the base URL', () => {
    for (const baseURL of ['http://localhost:3000', 'http://localhost:3000/app/', 'http://localhost']) {
      const c = sessionCookie({ refresh: 'r', baseURL });
      assert.equal(c.domain, 'localhost', baseURL);
      assert.equal(c.path, '/api/v1/auth');
      assert.equal(c.httpOnly, true);
    }
  });
});

describe('an object store without Docker, odd inputs', () => {
  const ports = { postgres: 55001, redis: 55002, minio: 55003, minioConsole: 55004 };

  it('has no object store when the flag is left out', () => {
    const plan = localPlan({ dir: '/tmp/run', ports });
    assert.equal(plan.storage, false);
    assert.equal(plan.minio, undefined);
  });

  it('keeps a run directory with spaces as one argument and never doubles a slash', () => {
    const spaced = localPlan({ dir: '/tmp/my run', ports, minio: true });
    assert.equal(spaced.minio.cmd[2], '/tmp/my run/minio');
    const slashed = localPlan({ dir: '/tmp/run/', ports, minio: true });
    assert.doesNotMatch(slashed.minio.cmd[2], /\/\//);
  });

  it('gives the apps the storage keys MinIO is started with', () => {
    const plan = localPlan({ dir: '/tmp/run', ports, minio: true });
    const env = appEnv({ ports, storage: true });
    assert.equal(plan.minio.env.MINIO_ROOT_USER, env.STORAGE_ACCESS_KEY_ID);
    assert.match(env.STORAGE_ENDPOINT, /:55003/);
  });
});

describe('creating the bucket, hostile answers', () => {
  const ports = { postgres: 1, redis: 2, minio: 3, minioConsole: 4 };

  async function s3(status, body = '') {
    const server = createServer((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/xml' });
      res.end(body);
    });
    const port = await listen(server);
    cleanups.push(() => close(server));
    return appEnv({ ports: { ...ports, minio: port } });
  }

  it('rejects when nothing listens', { timeout: 30000 }, async () => {
    const probe = createServer();
    const port = await listen(probe);
    await close(probe);
    await assert.rejects(createBucket({ repoRoot, env: appEnv({ ports: { ...ports, minio: port } }) }));
  });

  it('rejects on a server error', { timeout: 30000 }, async () => {
    const env = await s3(500, '<?xml version="1.0"?><Error><Code>InternalError</Code><Message>x</Message></Error>');
    await assert.rejects(createBucket({ repoRoot, env }));
  });

  it('rejects on an empty 403', { timeout: 30000 }, async () => {
    const env = await s3(403, '');
    await assert.rejects(createBucket({ repoRoot, env }));
  });

  it('is fine twice in a row', async () => {
    const env = await s3(200);
    await createBucket({ repoRoot, env });
    await createBucket({ repoRoot, env });
  });
});

describe('the run directory prefix', () => {
  it('uses this process when no pid is given', () => {
    assert.equal(runDirPrefix(12), `mf-prtest-12-${process.pid}-`);
  });

  it('takes the PR as a number or a string', () => {
    assert.equal(runDirPrefix('12', 7), 'mf-prtest-12-7-');
  });
});

describe('what a killed lap left behind, hostile directories', () => {
  const recorder = (answer = () => ({ code: 0, stdout: '' })) => {
    const calls = [];
    const run = (cmd, args = []) => {
      calls.push([cmd, ...args].join(' '));
      return answer(cmd, args) ?? { code: 0, stdout: '' };
    };
    return { calls, run };
  };
  const dirs = (tmp, ...names) => {
    for (const n of names) mkdirSync(join(tmp, n), { recursive: true });
  };
  const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

  it('leaves a run alone when its pid belongs to another live process, with the real liveness check', () => {
    const tmp = tempDir();
    const child = spawn('sleep', ['30'], { stdio: 'ignore' });
    cleanups.push(() => child.kill());
    dirs(tmp, `mf-prtest-12-${child.pid}-aB3dE9`, `mf-prtest-12-${process.pid}-bB3dE9`);
    const { run, calls } = recorder();
    cleanStale({ tmp, repo: '/repo', run });
    assert.equal(existsSync(join(tmp, `mf-prtest-12-${child.pid}-aB3dE9`)), true);
    assert.equal(existsSync(join(tmp, `mf-prtest-12-${process.pid}-bB3dE9`)), true);
    assert.equal(calls.some((c) => c.includes(' down ')), false);
  });

  it('removes a run whose process has exited, with the real liveness check', () => {
    const tmp = tempDir();
    const pid = deadPid();
    dirs(tmp, `mf-prtest-12-${pid}-aB3dE9`);
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run });
    assert.equal(existsSync(join(tmp, `mf-prtest-12-${pid}-aB3dE9`)), false);
  });

  it('leaves a run owned by a process it may not signal', () => {
    const tmp = tempDir();
    dirs(tmp, 'mf-prtest-12-1-aB3dE9');
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run });
    assert.equal(existsSync(join(tmp, 'mf-prtest-12-1-aB3dE9')), true);
  });

  it('does not throw on a pid no process can have, and still cleans the others', () => {
    const tmp = tempDir();
    const pid = deadPid();
    dirs(tmp, 'mf-prtest-12-99999999999999-aB3dE9', `mf-prtest-12-${pid}-bB3dE9`);
    const { run } = recorder();
    assert.doesNotThrow(() => cleanStale({ tmp, repo: '/repo', run }));
    assert.equal(existsSync(join(tmp, `mf-prtest-12-${pid}-bB3dE9`)), false);
  });

  it('leaves a directory with no pid in its name or its worktree alone', () => {
    const tmp = tempDir();
    dirs(tmp, 'mf-prtest-12-k9Lm2P', 'mf-prtest-12-k9Lm3Q/not-a-worktree');
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    assert.equal(existsSync(join(tmp, 'mf-prtest-12-k9Lm2P')), true);
    assert.equal(existsSync(join(tmp, 'mf-prtest-12-k9Lm3Q')), true);
  });

  it('leaves names that only look like a run directory alone', () => {
    const tmp = tempDir();
    dirs(tmp, 'mf-prtestx-12-111-aB3dE9', 'xmf-prtest-12-111-aB3dE9', 'mf-prtest-12-111', 'my-mf-prtest-12-111-a');
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    for (const n of ['mf-prtestx-12-111-aB3dE9', 'xmf-prtest-12-111-aB3dE9', 'my-mf-prtest-12-111-a']) assert.equal(existsSync(join(tmp, n)), true, n);
  });

  it('leaves an old-style directory alone when the pid in its worktree name is alive', () => {
    const tmp = tempDir();
    dirs(tmp, 'mf-prtest-12-k9Lm2P/mf-prtest-12-abc1234-222');
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run, isAlive: (pid) => pid === 222 });
    assert.equal(existsSync(join(tmp, 'mf-prtest-12-k9Lm2P')), true);
  });

  it('never signals a pid file that does not hold a plain positive number', () => {
    const tmp = tempDir();
    const dead = join(tmp, 'mf-prtest-12-111-aB3dE9');
    mkdirSync(dead);
    const contents = ['-1', '0', 'abc', '', '  ', '1e3', '12 34', '9001; rm -rf /', Buffer.from([0xff, 0xfe, 0x39, 0x00])];
    contents.forEach((c, i) => writeFileSync(join(dead, i % 2 ? 'redis.pid' : 'minio.pid'), c));
    for (const c of contents) {
      writeFileSync(join(dead, 'redis.pid'), c);
      writeFileSync(join(dead, 'minio.pid'), c);
      const { run, calls } = recorder((cmd) => (cmd === 'ps' ? { code: 0, stdout: 'redis-server minio server' } : undefined));
      cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
      for (const call of calls.filter((x) => x.startsWith('kill'))) assert.match(call, /^kill [1-9]\d*$/, `pid file ${JSON.stringify(String(c))} gave "${call}"`);
      mkdirSync(dead, { recursive: true });
    }
  });

  it('removes the directory even when every command it runs fails', () => {
    const tmp = tempDir();
    dirs(tmp, 'mf-prtest-12-111-aB3dE9/pg');
    writeFileSync(join(tmp, 'mf-prtest-12-111-aB3dE9', 'pg', 'postmaster.pid'), '1');
    const { run } = recorder(() => ({ code: 127, stdout: '', stderr: 'command not found' }));
    cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    assert.equal(existsSync(join(tmp, 'mf-prtest-12-111-aB3dE9')), false);
  });

  it('removes a dead compose project that has no directory, and not a live one', () => {
    const tmp = tempDir();
    const { run, calls } = recorder((cmd, args) => (cmd === 'docker' && args.includes('ls') ? { code: 0, stdout: 'mf-prtest-13-333\nmf-prtest-13-444\nmf-test-x-1\n' } : undefined));
    cleanStale({ tmp, repo: '/repo', run, isAlive: (pid) => pid === 444 });
    assert.ok(calls.includes('docker compose -p mf-prtest-13-333 down -v --remove-orphans'));
    assert.ok(!calls.some((c) => c.includes('mf-prtest-13-444 down')));
    assert.ok(!calls.some((c) => c.includes('mf-test-x-1 down')));
  });

  it('is a no-op the second time', () => {
    const tmp = tempDir();
    dirs(tmp, 'mf-prtest-12-111-aB3dE9');
    const { run } = recorder();
    const first = cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    const second = cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    assert.ok(first.length >= 1);
    assert.equal(second.length, 0);
  });

  it('does nothing when the temp folder is missing or empty', () => {
    const tmp = tempDir();
    const { run } = recorder();
    assert.deepEqual(cleanStale({ tmp: join(tmp, 'absent'), repo: '/repo', run, isAlive: () => false }), []);
    assert.deepEqual(cleanStale({ tmp, repo: '/repo', run, isAlive: () => false }), []);
  });

  it('removes two hundred dead runs', () => {
    const tmp = tempDir();
    for (let i = 0; i < 200; i++) dirs(tmp, `mf-prtest-12-${1000 + i}-r${String(i).padStart(3, '0')}Xy`);
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    for (let i = 0; i < 200; i++) assert.equal(existsSync(join(tmp, `mf-prtest-12-${1000 + i}-r${String(i).padStart(3, '0')}Xy`)), false);
  });

  it('never deletes what a symlink points at', () => {
    const tmp = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, 'precious.txt'), 'keep');
    symlinkSync(outside, join(tmp, 'mf-prtest-12-111-lNk3d9'));
    dirs(tmp, 'mf-prtest-12-222-rEa1d9');
    symlinkSync(outside, join(tmp, 'mf-prtest-12-222-rEa1d9', 'inside-link'));
    const { run } = recorder();
    cleanStale({ tmp, repo: '/repo', run, isAlive: () => false });
    assert.equal(existsSync(join(outside, 'precious.txt')), true);
  });
});
