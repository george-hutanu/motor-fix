import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { join } from 'node:path';

import { run } from './mcp-smoke.ts';

// A stand-in for the MCP server and its identity server on one port: each
// route answers as the real one does, and a test overrides the route it breaks.
type Route = (req: IncomingMessage, body: string, res: ServerResponse) => void;

const TOKEN = 'rat-secret-value';
const SECRET = 'client-secret-value';

let server: Server;
let base: string;
let routes: Record<string, Route>;
let seen: { method: string; path: string; body: string; auth?: string }[];

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

function defaults(): Record<string, Route> {
  const issuer = `${base}/realms/motorfix-assistants`;
  let next = 0;
  return {
    'DELETE /realms/motorfix-assistants/clients-registrations/openid-connect/client-1':
      (_req, _body, res) => {
        res.writeHead(204);
        res.end();
      },
    'DELETE /realms/motorfix-assistants/clients-registrations/openid-connect/client-2':
      (_req, _body, res) => {
        res.writeHead(204);
        res.end();
      },
    'GET /.well-known/oauth-protected-resource/mcp': (_req, _body, res) =>
      json(res, 200, {
        authorization_servers: [issuer],
        resource: `${base}/mcp`,
      }),
    'GET /realms/motorfix-assistants/.well-known/oauth-authorization-server': (
      _req,
      _body,
      res,
    ) =>
      json(res, 200, {
        authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
        code_challenge_methods_supported: ['plain', 'S256'],
        issuer,
        registration_endpoint: `${issuer}/clients-registrations/openid-connect`,
        token_endpoint: `${issuer}/protocol/openid-connect/token`,
      }),
    'POST /mcp': (_req, _body, res) => {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end(JSON.stringify({ code: 'sign_in_required' }));
    },
    'POST /realms/motorfix-assistants/clients-registrations/openid-connect': (
      _req,
      _body,
      res,
    ) => {
      next += 1;
      json(res, 201, {
        client_id: `client-${next}`,
        client_secret: SECRET,
        registration_access_token: `${TOKEN}-${next}`,
        registration_client_uri: `${issuer}/clients-registrations/openid-connect/client-${next}`,
      });
    },
  };
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

async function check(args = [`${base}/mcp`], timeoutMs = 2000) {
  const lines: string[] = [];
  const code = await run(args, {
    err: (line) => lines.push(line),
    out: (line) => lines.push(line),
    timeoutMs,
  });
  return { code, lines, text: lines.join('\n') };
}

const line = (lines: string[], step: string) =>
  lines.find((l) => l.split(' — ')[0]?.endsWith(` ${step}`)) ?? '';

describe('mcp-smoke', () => {
  // @traces 1019-FR-006
  it('passes every step against a server set up correctly and exits 0', async () => {
    const { code, lines } = await check();

    expect(code).toBe(0);
    expect(lines.map((l) => l.split(' — ')[0])).toEqual([
      'PASS challenge',
      'PASS resource metadata',
      'PASS server metadata',
      'PASS register claude',
      'PASS register chatgpt',
      'PASS delete claude',
      'PASS delete chatgpt',
    ]);
  });

  // @traces 1019-FR-006
  it('ends with usage status 2 and sends nothing without an absolute address', async () => {
    for (const args of [[], ['mcp.example'], ['/mcp']]) {
      const { code, text } = await check(args);

      expect(code).toBe(2);
      expect(text).toMatch(/usage: node scripts\/mcp-smoke\.ts <mcp-url>/i);
    }
    expect(seen).toEqual([]);
  });

  // @traces 1019-FR-001
  it('sends an unsigned MCP request', async () => {
    await check();

    const first = seen[0];
    expect(first?.method).toBe('POST');
    expect(first?.path).toBe('/mcp');
    expect(first?.auth).toBeUndefined();
    expect(JSON.parse(first?.body ?? '{}')).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/list',
    });
  });

  // @traces 1019-FR-001
  // @traces 1019-FR-006
  it.each([
    ['answers 200', 200, undefined],
    ['has no challenge', 401, undefined],
    ['challenges with another scheme', 401, 'Basic realm="x"'],
    ['names no resource_metadata', 401, 'Bearer realm="mcp"'],
    [
      'names a relative resource_metadata',
      401,
      'Bearer resource_metadata="/meta"',
    ],
  ])(
    'fails the challenge when the server %s, and skips what depends on it',
    async (_name, status, header) => {
      routes['POST /mcp'] = (_req, _body, res) => {
        res.writeHead(status, header ? { 'www-authenticate': header } : {});
        res.end('{}');
      };

      const { code, lines } = await check();

      expect(code).toBe(1);
      expect(line(lines, 'challenge')).toMatch(/^FAIL challenge — .+/);
      for (const step of [
        'resource metadata',
        'server metadata',
        'register claude',
        'register chatgpt',
      ]) {
        expect(line(lines, step)).toMatch(/^SKIP /);
      }
      expect(seen).toHaveLength(1);
    },
  );

  // @traces 1019-FR-001
  it.each([
    [
      'after another scheme naming its own',
      (meta: string) =>
        `Other resource_metadata="https://elsewhere.invalid/x", Bearer resource_metadata="${meta}"`,
      0,
    ],
    [
      'on a Bearer challenge with parameters before it',
      (meta: string) => `Bearer realm="mcp", resource_metadata="${meta}"`,
      0,
    ],
    [
      'only on another scheme after Bearer',
      (meta: string) => `Bearer realm="mcp", Other resource_metadata="${meta}"`,
      1,
    ],
  ])(
    'reads resource_metadata from the Bearer challenge only: %s',
    async (_name, header, expected) => {
      const meta = `${base}/.well-known/oauth-protected-resource/mcp`;
      routes['POST /mcp'] = (_req, _body, res) => {
        res.writeHead(401, { 'www-authenticate': header(meta) });
        res.end('{}');
      };

      const { code, lines } = await check();

      expect(code).toBe(expected);
      if (expected === 0) {
        expect(line(lines, 'challenge')).toContain(meta);
      } else {
        expect(line(lines, 'challenge')).toMatch(
          /^FAIL challenge — .*resource_metadata/,
        );
        expect(seen).toHaveLength(1);
      }
    },
  );

  // @traces 1019-FR-002
  it('ignores one trailing slash on each side of the resource', async () => {
    routes['GET /.well-known/oauth-protected-resource/mcp'] = (_r, _b, res) =>
      json(res, 200, {
        authorization_servers: [`${base}/realms/motorfix-assistants`],
        resource: `${base}/mcp/`,
      });

    const { code } = await check();

    expect(code).toBe(0);
  });

  // @traces 1019-FR-002
  it('fails the resource metadata on another resource, printing both', async () => {
    routes['GET /.well-known/oauth-protected-resource/mcp'] = (_r, _b, res) =>
      json(res, 200, {
        authorization_servers: [`${base}/realms/motorfix-assistants`],
        resource: 'https://old.example/mcp',
      });

    const { code, lines } = await check();

    expect(code).toBe(1);
    const failed = line(lines, 'resource metadata');
    expect(failed).toMatch(/^FAIL /);
    expect(failed).toContain('https://old.example/mcp');
    expect(failed).toContain(`${base}/mcp`);
    expect(line(lines, 'server metadata')).toMatch(/^SKIP /);
  });

  // @traces 1019-FR-002
  it.each([
    ['none', []],
    ['two', ['https://a.example', 'https://b.example']],
  ])(
    'fails the resource metadata naming %s authorization servers',
    async (_n, servers) => {
      routes['GET /.well-known/oauth-protected-resource/mcp'] = (_r, _b, res) =>
        json(res, 200, {
          authorization_servers: servers,
          resource: `${base}/mcp`,
        });

      const { code, lines } = await check();

      expect(code).toBe(1);
      expect(line(lines, 'resource metadata')).toMatch(/^FAIL /);
    },
  );

  // @traces 1019-FR-002
  it('fails a metadata answer that is not JSON, saying so', async () => {
    routes['GET /.well-known/oauth-protected-resource/mcp'] = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>hello</html>');
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(/^FAIL .*not JSON/);
  });

  // @traces 1019-FR-003
  it.each([
    ['another issuer', { issuer: 'https://other.example' }],
    ['no authorization endpoint', { authorization_endpoint: undefined }],
    ['no token endpoint', { token_endpoint: undefined }],
    ['no registration endpoint', { registration_endpoint: undefined }],
    ['no S256', { code_challenge_methods_supported: ['plain'] }],
    ['no PKCE methods', { code_challenge_methods_supported: undefined }],
  ])(
    'fails the server metadata with %s, and registers nothing',
    async (_name, change) => {
      const path =
        'GET /realms/motorfix-assistants/.well-known/oauth-authorization-server';
      const issuer = `${base}/realms/motorfix-assistants`;
      routes[path] = (_r, _b, res) =>
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
      expect(line(lines, 'register chatgpt')).toMatch(/^SKIP /);
      expect(seen.some((s) => s.path.includes('clients-registrations'))).toBe(
        false,
      );
    },
  );

  // @traces 1019-FR-003
  it.each([
    ['registration_endpoint', '/register'],
    ['token_endpoint', 'token'],
    ['authorization_endpoint', 'ftp://idp.example/auth'],
  ])(
    'fails the server metadata when %s is not an absolute http(s) URL, naming it',
    async (key, value) => {
      const path =
        'GET /realms/motorfix-assistants/.well-known/oauth-authorization-server';
      const issuer = `${base}/realms/motorfix-assistants`;
      routes[path] = (_r, _b, res) =>
        json(res, 200, {
          authorization_endpoint: `${issuer}/auth`,
          code_challenge_methods_supported: ['S256'],
          issuer,
          registration_endpoint: `${issuer}/clients-registrations/openid-connect`,
          token_endpoint: `${issuer}/token`,
          [key]: value,
        });

      const { code, lines } = await check();

      expect(code).toBe(1);
      const failed = line(lines, 'server metadata');
      expect(failed).toMatch(/^FAIL /);
      expect(failed).toContain(key);
      expect(failed).toContain(value);
      expect(line(lines, 'register claude')).toMatch(/^SKIP /);
      expect(seen.some((s) => s.path.includes('clients-registrations'))).toBe(
        false,
      );
    },
  );

  // @traces 1019-FR-004
  it('registers a public client with each assistant callback, without credentials', async () => {
    await check();

    const registrations = seen.filter(
      (s) => s.method === 'POST' && s.path.endsWith('/openid-connect'),
    );
    expect(registrations).toHaveLength(2);
    const bodies = registrations.map((r) => JSON.parse(r.body));
    expect(bodies.map((b) => b.redirect_uris)).toEqual([
      ['https://claude.ai/api/mcp/auth_callback'],
      ['https://chatgpt.com/connector_platform_oauth_redirect'],
    ]);
    for (const body of bodies) {
      expect(body.token_endpoint_auth_method).toBe('none');
    }
    for (const r of registrations) expect(r.auth).toBeUndefined();
  });

  // @traces 1019-FR-004
  // @traces 1019-FR-005
  it('still registers ChatGPT when Claude is refused, and deletes only what was registered', async () => {
    const path =
      'POST /realms/motorfix-assistants/clients-registrations/openid-connect';
    const original = routes[path];
    let calls = 0;
    routes[path] = (req, body, res) => {
      calls += 1;
      if (calls === 1) json(res, 403, { error: 'insufficient_scope' });
      else original?.(req, body, res);
    };

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'register claude')).toMatch(/^FAIL .*403/);
    expect(line(lines, 'register chatgpt')).toMatch(/^PASS /);
    expect(line(lines, 'delete claude')).toBe('');
    expect(line(lines, 'delete chatgpt')).toMatch(/^PASS /);
  });

  // @traces 1019-FR-004
  it.each([
    ['an object without one', { client_name: 'x' }],
    ['null', null],
    ['an array', [{ client_id: 'x' }]],
  ])(
    'fails a registration whose answer is %s, naming the client id',
    async (_n, answer) => {
      routes[
        'POST /realms/motorfix-assistants/clients-registrations/openid-connect'
      ] = (_r, _b, res) => json(res, 201, answer);

      const { code, lines } = await check();

      expect(code).toBe(1);
      expect(line(lines, 'register claude')).toMatch(/^FAIL .*client id/);
    },
  );

  // @traces 1019-FR-005
  it('deletes each client with its own registration access token', async () => {
    await check();

    const deletes = seen.filter((s) => s.method === 'DELETE');
    expect(deletes.map((d) => [d.path.split('/').pop(), d.auth])).toEqual([
      ['client-1', `Bearer ${TOKEN}-1`],
      ['client-2', `Bearer ${TOKEN}-2`],
    ]);
  });

  // @traces 1019-FR-005
  it('fails when the identity server refuses a delete', async () => {
    routes[
      'DELETE /realms/motorfix-assistants/clients-registrations/openid-connect/client-2'
    ] = (_r, _b, res) => json(res, 401, { error: 'invalid_token' });

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'delete claude')).toMatch(/^PASS /);
    expect(line(lines, 'delete chatgpt')).toMatch(/^FAIL .*401/);
  });

  // @traces 1019-FR-005
  it('fails the delete of a client registered without a way to delete it', async () => {
    routes[
      'POST /realms/motorfix-assistants/clients-registrations/openid-connect'
    ] = (_r, _b, res) => json(res, 201, { client_id: 'orphan' });

    const { code, lines } = await check();

    expect(code).toBe(1);
    expect(line(lines, 'register claude')).toMatch(/^PASS /);
    expect(line(lines, 'delete claude')).toMatch(/^FAIL /);
  });

  // @traces 1019-FR-006
  it('never prints a registration access token or a client secret', async () => {
    routes[
      'DELETE /realms/motorfix-assistants/clients-registrations/openid-connect/client-1'
    ] = (_r, _b, res) => json(res, 500, { detail: SECRET, error: TOKEN });

    const { text } = await check();

    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(SECRET);
  });

  // @traces 1019-FR-006
  it('fails a step whose server does not answer within the limit', async () => {
    routes['GET /.well-known/oauth-protected-resource/mcp'] = () => {
      // never answers
    };

    const { code, lines } = await check([`${base}/mcp`], 300);

    expect(code).toBe(1);
    expect(line(lines, 'resource metadata')).toMatch(
      /^FAIL .*no answer within 0\.3 s/,
    );
  });
});

// The owner's instructions: the setup steps and the section on connecting
// each assistant carry every item the instructions must name.
describe('infra/keycloak/README.md', () => {
  const readme = readFileSync(
    join(__dirname, '..', 'infra', 'keycloak', 'README.md'),
    'utf8',
  );
  const start = readme.indexOf('## Connecting Claude and ChatGPT');
  const section =
    start < 0 ? '' : (readme.slice(start).split(/\n## /)[0] ?? '');

  // @traces 1019-FR-008
  it('names MCP_URL among the GitHub staging variables', () => {
    expect(readme).toMatch(
      /GitHub `staging` environment[\s\S]{0,400}`MCP_URL`/,
    );
  });

  // @traces 1019-FR-008
  it.each([
    ['the check to run first', 'node scripts/mcp-smoke.ts'],
    ['Claude', 'Claude'],
    ['ChatGPT', 'ChatGPT'],
    ['custom connector', 'custom connector'],
    ['developer mode', 'Developer mode'],
    ['the tool', '`get_my_account`'],
    ['the date field', '- date:'],
    ['the client field', '- client:'],
    ['the tool field', '- tool called:'],
    ['the outcome field', '- result: pass or fail'],
    ['the error field', '- error text:'],
    ['ST-1016', '#1106'],
    ['ST-365', '#869'],
    ['the address move', '#1307'],
  ])('the connecting section names %s', (_what, text) => {
    expect(section).toContain(text);
  });
});
