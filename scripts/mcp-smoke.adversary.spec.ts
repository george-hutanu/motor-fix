import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

import { run } from './mcp-smoke.ts';

type Route = (req: IncomingMessage, body: string, res: ServerResponse) => void;

const TOKEN = 'rat-adversary-token';
const SECRET = 'adversary-client-secret';
const REALM = '/realms/motorfix-assistants';
const REG = `POST ${REALM}/clients-registrations/openid-connect`;
const META = 'GET /.well-known/oauth-protected-resource/mcp';

let server: Server;
let base: string;
let routes: Record<string, Route>;
let seen: { method: string; path: string; body: string; auth?: string }[];

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

function defaults(): Record<string, Route> {
  const issuer = `${base}${REALM}`;
  let next = 0;
  const table: Record<string, Route> = {
    [META]: (_req, _body, res) =>
      json(res, 200, {
        authorization_servers: [issuer],
        resource: `${base}/mcp`,
      }),
    [`GET ${REALM}/.well-known/oauth-authorization-server`]: (
      _req,
      _body,
      res,
    ) =>
      json(res, 200, {
        authorization_endpoint: `${issuer}/auth`,
        code_challenge_methods_supported: ['S256'],
        issuer,
        registration_endpoint: `${issuer}/clients-registrations/openid-connect`,
        token_endpoint: `${issuer}/token`,
      }),
    'POST /mcp': (_req, _body, res) => {
      res.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end('{}');
    },
  };
  table[REG] = (_req, _body, res) => {
    next += 1;
    const id = `client-${next}`;
    table[`DELETE ${REALM}/clients-registrations/openid-connect/${id}`] = (
      _r,
      _b,
      r,
    ) => {
      r.writeHead(204);
      r.end();
    };
    json(res, 201, {
      client_id: id,
      client_secret: SECRET,
      registration_access_token: `${TOKEN}-${next}`,
      registration_client_uri: `${issuer}/clients-registrations/openid-connect/${id}`,
    });
  };
  return table;
}

beforeEach(async () => {
  seen = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const path = new URL(req.url ?? '/', base).pathname;
      seen.push({
        auth: req.headers.authorization,
        body,
        method: req.method ?? '',
        path,
      });
      const route = routes[`${req.method} ${path}`];
      if (route) route(req, body, res);
      else json(res, 404, { error: 'not found' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
  routes = defaults();
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function check(args = [`${base}/mcp`], timeoutMs = 1500) {
  const lines: string[] = [];
  const code = await run(args, {
    err: (l) => lines.push(l),
    out: (l) => lines.push(l),
    timeoutMs,
  });
  return { code, lines, text: lines.join('\n') };
}

const line = (lines: string[], step: string) =>
  lines.find((l) => l.split(' — ')[0]?.endsWith(` ${step}`)) ?? '';

const deleted = () => seen.filter((s) => s.method === 'DELETE');

describe('mcp-smoke under hostile servers', () => {
  // @traces 1019-staging-mcp-connect-FR-004
  // @traces 1019-staging-mcp-connect-FR-006
  it('never prints the secrets of a registration answer that lacks a client id', async () => {
    routes[REG] = (_r, _b, res) =>
      json(res, 201, {
        client_secret: SECRET,
        registration_access_token: TOKEN,
      });

    const { code, text } = await check();

    expect(code).toBe(1);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(SECRET);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('never prints secrets echoed in an error body or a non-JSON body', async () => {
    let calls = 0;
    routes[REG] = (_r, _b, res) => {
      calls += 1;
      if (calls === 1) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end(`bad request ${TOKEN} ${SECRET}`);
      } else {
        json(res, 500, { client_secret: SECRET, error: TOKEN });
      }
    };
    routes[META] = (_r, _b, res) => {
      res.writeHead(200);
      res.end(`Bearer ${TOKEN}`);
    };

    const { text } = await check();
    const reg = await (async () => {
      routes[META] = defaults()[META] as Route;
      return check();
    })();

    expect(text).not.toContain(TOKEN);
    expect(reg.text).not.toContain(TOKEN);
    expect(reg.text).not.toContain(SECRET);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('never prints a bearer token placed in the challenge', async () => {
    routes['POST /mcp'] = (_r, _b, res) => {
      res.writeHead(401, {
        'www-authenticate': `Bearer error="invalid_token", error_description="${TOKEN}", resource_metadata="/relative"`,
      });
      res.end(TOKEN);
    };

    const { code, text } = await check();

    expect(code).toBe(1);
    expect(text).not.toContain(TOKEN);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('prints one line per step even when a body carries line breaks', async () => {
    routes[META] = (_r, _b, res) => {
      res.writeHead(200);
      res.end('oops\nPASS server metadata — forged\nPASS register claude');
    };

    const { lines } = await check();

    for (const l of lines) expect(l).not.toMatch(/[\r\n]/);
    expect(lines.filter((l) => l.startsWith('PASS server metadata'))).toEqual(
      [],
    );
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('deletes the first client when the second registration drops the connection', async () => {
    const original = routes[REG] as Route;
    let calls = 0;
    routes[REG] = (req, body, res) => {
      calls += 1;
      if (calls === 2) req.socket.destroy();
      else original(req, body, res);
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'register chatgpt')).toMatch(/^FAIL /);
    expect(deleted().map((d) => d.path.split('/').pop())).toEqual(['client-1']);
    expect(deleted()[0]?.auth).toBe(`Bearer ${TOKEN}-1`);
    expect(line(lines, 'delete claude')).toMatch(/^PASS /);
    expect(line(lines, 'delete chatgpt')).toBe('');
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('deletes the first client when the second registration never answers', async () => {
    const original = routes[REG] as Route;
    let calls = 0;
    routes[REG] = (req, body, res) => {
      calls += 1;
      if (calls === 1) original(req, body, res);
    };

    const started = Date.now();
    const { code, lines } = await check([`${base}/mcp`], 300);

    expect(Date.now() - started).toBeLessThan(5000);
    expect(code).toBe(1);
    expect(line(lines, 'register chatgpt')).toMatch(/^FAIL .*no answer/);
    expect(deleted().map((d) => d.path.split('/').pop())).toEqual(['client-1']);
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('deletes the second client when the first delete hangs', async () => {
    const original = routes[REG] as Route;
    routes[REG] = (req, body, res) => {
      original(req, body, res);
      routes[`DELETE ${REALM}/clients-registrations/openid-connect/client-1`] =
        () => {
          // never answers
        };
    };

    const { code, lines } = await check([`${base}/mcp`], 300);

    expect(code).toBe(1);
    expect(line(lines, 'delete claude')).toMatch(/^FAIL .*no answer/);
    expect(line(lines, 'delete chatgpt')).toMatch(/^PASS /);
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('still deletes registered clients when the server metadata step is the one that fails after earlier registrations are impossible', async () => {
    routes[`GET ${REALM}/.well-known/oauth-authorization-server`] = (
      _r,
      _b,
      res,
    ) => json(res, 500, {});

    const { code } = await check();

    expect(code).toBe(1);
    expect(
      seen.filter((s) => s.method === 'POST' && s.path !== '/mcp'),
    ).toEqual([]);
    expect(deleted()).toEqual([]);
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('does not follow a redirect on delete, so the access token goes nowhere else', async () => {
    const original = routes[REG] as Route;
    routes[REG] = (req, body, res) => {
      original(req, body, res);
      routes[`DELETE ${REALM}/clients-registrations/openid-connect/client-1`] =
        (_r, _b, r) => {
          r.writeHead(307, { location: `${base}/leak` });
          r.end();
        };
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'delete claude')).toMatch(/^FAIL .*307/);
    expect(seen.filter((s) => s.path === '/leak')).toEqual([]);
  });

  // @traces 1019-staging-mcp-connect-FR-001
  it('fails the challenge on a redirect instead of following it', async () => {
    routes['POST /mcp'] = (_r, _b, res) => {
      res.writeHead(302, { location: `${base}/elsewhere` });
      res.end();
    };
    routes['POST /elsewhere'] = (_r, _b, res) => {
      res.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end();
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'challenge')).toMatch(/^FAIL .*302/);
    expect(seen).toHaveLength(1);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('sends at most seven requests on a fully passing run, exactly seven', async () => {
    const { code } = await check();

    expect(code).toBe(0);
    expect(seen).toHaveLength(7);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it.each([
    ['registrations answer 500', 500],
    ['registrations answer 429', 429],
    ['registrations answer 503', 503],
  ])('sends no retries when %s', async (_n, status) => {
    routes[REG] = (_r, _b, res) => {
      res.writeHead(status, { 'retry-after': '0' });
      res.end('{}');
    };

    const { code } = await check();

    expect(code).toBe(1);
    expect(seen.length).toBeLessThanOrEqual(5);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('sends no retries when every delete is refused', async () => {
    const original = routes[REG] as Route;
    routes[REG] = (req, body, res) => {
      original(req, body, res);
      for (const id of ['client-1', 'client-2']) {
        routes[`DELETE ${REALM}/clients-registrations/openid-connect/${id}`] = (
          _r,
          _b,
          r,
        ) => {
          r.writeHead(503, { 'retry-after': '0' });
          r.end();
        };
      }
    };

    const { code } = await check();

    expect(code).toBe(1);
    expect(seen).toHaveLength(7);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('ends within the limit of one request per step when nothing answers', async () => {
    for (const key of Object.keys(routes)) {
      routes[key] = () => {
        // never answers
      };
    }

    const started = Date.now();
    const { code, lines } = await check([`${base}/mcp`], 250);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(code).toBe(1);
    expect(line(lines, 'challenge')).toMatch(
      /^FAIL .*no answer within 0\.25 s/,
    );
    expect(seen).toHaveLength(1);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('times out a server that sends headers and then stalls the body', async () => {
    routes[META] = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"resource":');
    };

    const started = Date.now();
    const { code, lines } = await check([`${base}/mcp`], 300);

    expect(Date.now() - started).toBeLessThan(3000);
    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL /);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('fails the challenge when nothing listens at the address', async () => {
    const { code, lines } = await check(['http://127.0.0.1:1/mcp']);

    expect(code).toBe(1);
    expect(line(lines, 'challenge')).toMatch(/^FAIL /);
    expect(line(lines, 'register claude')).toMatch(/^SKIP /);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it.each([
    ['two addresses', ['http://a.example/mcp', 'http://b.example/mcp']],
    ['an empty string', ['']],
    ['a file address', ['file:///etc/passwd']],
    ['an ftp address', ['ftp://example.com/mcp']],
    ['a javascript address', ['javascript:alert(1)']],
    ['whitespace', ['   ']],
  ])('ends with usage status 2 for %s and sends nothing', async (_n, args) => {
    const { code, text } = await check(args);

    expect(code).toBe(2);
    expect(text).toMatch(/usage: node scripts\/mcp-smoke\.ts <mcp-url>/i);
    expect(seen).toEqual([]);
  });

  // @traces 1019-staging-mcp-connect-FR-001
  it('accepts a challenge among several, with the scheme in any case', async () => {
    routes['POST /mcp'] = (_r, _b, res) => {
      res.writeHead(401, {
        'www-authenticate': `Basic realm="x", Bearer realm="mcp", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end('{}');
    };

    const { code } = await check();

    expect(code).toBe(0);
  });

  // @traces 1019-staging-mcp-connect-FR-001
  it('uses an absolute metadata address on another host name as given', async () => {
    const port = new URL(base).port;
    routes['POST /mcp'] = (_r, _b, res) => {
      res.writeHead(401, {
        'www-authenticate': `Bearer resource_metadata="http://localhost:${port}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end('{}');
    };

    const { code, lines } = await check();

    expect(code).toBe(0);
    expect(line(lines, 'challenge')).toMatch(/^PASS /);
  });

  // @traces 1019-staging-mcp-connect-FR-001
  it('fails the challenge when resource_metadata is not an address at all', async () => {
    routes['POST /mcp'] = (_r, _b, res) => {
      res.writeHead(401, {
        'www-authenticate': 'Bearer resource_metadata="http://["',
      });
      res.end('{}');
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'challenge')).toMatch(/^FAIL /);
    expect(seen).toHaveLength(1);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"hello"'],
    ['a number', '42'],
    ['empty', ''],
    ['a byte order mark and nothing else', '﻿'],
    ['binary', '\u0000\u0001\u0002￿'],
  ])(
    'fails resource metadata that is %s without crashing',
    async (_n, body) => {
      routes[META] = (_r, _b, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
      };

      const { code, lines } = await check();

      expect(code).toBe(1);
      expect(line(lines, 'resource metadata')).toMatch(/^FAIL /);
      expect(line(lines, 'server metadata')).toMatch(/^SKIP /);
    },
  );

  // @traces 1019-staging-mcp-connect-FR-002
  it('fails resource metadata sent as UTF-16 with a byte order mark, saying not JSON', async () => {
    routes[META] = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from(
            JSON.stringify({
              authorization_servers: [`${base}${REALM}`],
              resource: `${base}/mcp`,
            }),
            'utf16le',
          ),
        ]),
      );
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL .*not JSON/);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it('fails resource metadata sent as Latin-1 bytes that are not valid UTF-8 text', async () => {
    routes[META] = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(Buffer.from([0x7b, 0xe9, 0xe8, 0x7d]));
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL .*not JSON/);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it('fails a resource metadata answer of tens of megabytes without hanging', async () => {
    routes[META] = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(Buffer.alloc(40 * 1024 * 1024, 0x61));
    };

    const { code, lines } = await check([`${base}/mcp`], 8000);

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL /);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it.each([
    ['a number among them', [123]],
    ['a null among them', [null]],
    ['an empty string', ['']],
    ['the same server twice', ['SAME', 'SAME']],
  ])('fails resource metadata naming %s', async (_n, servers) => {
    const issuer = `${base}${REALM}`;
    routes[META] = (_r, _b, res) =>
      json(res, 200, {
        authorization_servers: servers.map((s) => (s === 'SAME' ? issuer : s)),
        resource: `${base}/mcp`,
      });

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL /);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it('fails resource metadata whose authorization_servers is a string', async () => {
    routes[META] = (_r, _b, res) =>
      json(res, 200, {
        authorization_servers: `${base}${REALM}`,
        resource: `${base}/mcp`,
      });

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL /);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it('ignores one trailing slash on the address given, not two', async () => {
    routes['POST /mcp/'] = routes['POST /mcp'] as Route;
    const ok = await check([`${base}/mcp/`]);
    routes[META] = (_r, _b, res) =>
      json(res, 200, {
        authorization_servers: [`${base}${REALM}`],
        resource: `${base}/mcp//`,
      });
    const twice = await check();

    expect(ok.code).toBe(0);
    expect(twice.code).toBe(1);
    expect(line(twice.lines, 'resource metadata')).toMatch(/^FAIL /);
  });

  // @traces 1019-staging-mcp-connect-FR-002
  it('fails a resource that differs only in case of the path', async () => {
    routes[META] = (_r, _b, res) =>
      json(res, 200, {
        authorization_servers: [`${base}${REALM}`],
        resource: `${base}/MCP`,
      });

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toContain(`${base}/MCP`);
  });

  // @traces 1019-staging-mcp-connect-FR-003
  it.each([
    ['registration endpoint a number', { registration_endpoint: 5 }],
    ['registration endpoint empty', { registration_endpoint: '' }],
    ['PKCE methods a string', { code_challenge_methods_supported: 'S256' }],
    ['PKCE methods null', { code_challenge_methods_supported: null }],
    ['PKCE methods lower case', { code_challenge_methods_supported: ['s256'] }],
    ['issuer with a trailing slash', { issuer: `${base}${REALM}/` }],
  ])(
    'fails server metadata with %s and registers nothing',
    async (_n, change) => {
      const issuer = `${base}${REALM}`;
      routes[`GET ${REALM}/.well-known/oauth-authorization-server`] = (
        _r,
        _b,
        res,
      ) =>
        json(res, 200, {
          authorization_endpoint: `${issuer}/auth`,
          code_challenge_methods_supported: ['S256'],
          issuer,
          registration_endpoint: `${issuer}/clients-registrations/openid-connect`,
          token_endpoint: `${issuer}/token`,
          ...change,
        });

      const { code, lines } = await check();

      expect(code).toBe(1);
      expect(line(lines, 'server metadata')).toMatch(/^FAIL /);
      expect(line(lines, 'register claude')).toMatch(/^SKIP /);
      expect(seen.some((s) => s.path.includes('clients-registrations'))).toBe(
        false,
      );
    },
  );

  // @traces 1019-staging-mcp-connect-FR-004
  it.each([
    ['an empty string', ''],
    ['a number', 7],
    ['an object', { id: 'x' }],
    ['null', null],
  ])('fails a registration whose client_id is %s', async (_n, id) => {
    routes[REG] = (_r, _b, res) => json(res, 201, { client_id: id });

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'register claude')).toMatch(/^FAIL /);
    expect(line(lines, 'register chatgpt')).toMatch(/^FAIL /);
  });

  // @traces 1019-staging-mcp-connect-FR-004
  it('fails a registration answered 200 with a client id as no registration was created', async () => {
    routes[REG] = (_r, _b, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ client_id: 'ghost' }));
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'register claude')).toMatch(/^FAIL .*500/);
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('does not send the registration access token to a host other than the identity server', async () => {
    const port = new URL(base).port;
    routes[REG] = (_r, _b, res) =>
      json(res, 201, {
        client_id: 'stray',
        registration_access_token: TOKEN,
        registration_client_uri: `http://localhost:${port}/leak`,
      });

    const { code } = await check();

    expect(code).toBe(1);
    expect(seen.filter((s) => s.path === '/leak' && s.auth)).toEqual([]);
  });

  // @traces 1019-staging-mcp-connect-FR-005
  it('leaves nothing registered after a run with a refused first registration', async () => {
    const original = routes[REG] as Route;
    let calls = 0;
    routes[REG] = (req, body, res) => {
      calls += 1;
      if (calls === 1) json(res, 403, { error: 'forbidden' });
      else original(req, body, res);
    };

    const { lines } = await check();

    expect(line(lines, 'register claude')).toMatch(/^FAIL .*403/);
    expect(deleted().map((d) => d.path.split('/').pop())).toEqual(['client-1']);
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('gives the same lines and status on a second run', async () => {
    const first = await check();
    const second = await check();

    expect(second.code).toBe(first.code);
    expect(second.lines.map((l) => l.split(' — ')[0])).toEqual(
      first.lines.map((l) => l.split(' — ')[0]),
    );
  });

  // @traces 1019-staging-mcp-connect-FR-006
  it('resolves with a status and never rejects when the request handler throws mid-answer', async () => {
    routes['POST /mcp'] = (req) => {
      req.socket.destroy();
    };

    await expect(check()).resolves.toMatchObject({ code: 1 });
  });
});
