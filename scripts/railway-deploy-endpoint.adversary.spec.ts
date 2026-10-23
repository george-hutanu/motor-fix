import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { railwayEndpoint } from './railway-deploy.ts';

const script = join(__dirname, 'railway-deploy.ts');
const DEFAULT = 'https://backboard.railway.com/graphql/v2';

const endpoint = (value: string | undefined) =>
  railwayEndpoint({ RAILWAY_API_ENDPOINT: value });

// @traces 506-FR-001
describe('railwayEndpoint default', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('uses the Railway url when the variable is %s', (_name, value) => {
    expect(endpoint(value)).toBe(DEFAULT);
  });

  it('uses the Railway url for an empty environment', () => {
    expect(railwayEndpoint({})).toBe(DEFAULT);
  });

  it('ignores unrelated variables that look like the endpoint', () => {
    expect(
      railwayEndpoint({ RAILWAY_API_ENDPOINT_X: 'http://127.0.0.1:1/' }),
    ).toBe(DEFAULT);
  });
});

// @traces 506-FR-001
describe('railwayEndpoint loopback overrides', () => {
  it.each([
    'http://127.0.0.1:4010/graphql',
    'http://localhost:4010/graphql',
    'http://[::1]:4010/graphql',
    'https://127.0.0.1/graphql/v2',
    'http://127.0.0.1',
    'HTTP://LOCALHOST:4010/graphql',
    'http://127.0.0.1:4010/graphql?x=1#frag',
    'http://user:pw@127.0.0.1:4010/graphql',
  ])('accepts %s', (value) => {
    expect(endpoint(value)).toBe(value);
  });
});

// @traces 506-FR-002
describe('railwayEndpoint refusals', () => {
  it.each([
    'https://backboard.railway.com/graphql/v2',
    'http://example.com/graphql',
    'http://127.0.0.1.evil.com/graphql',
    'http://localhost.evil.com/graphql',
    'http://evil.com/127.0.0.1',
    'http://evil.com?h=localhost',
    'http://127.0.0.1@evil.com/graphql',
    'http://localhost:80@evil.com/graphql',
    'http://evil.com#@127.0.0.1',
    'http://0.0.0.0:4010/graphql',
    'http://[::]:4010/graphql',
    'http://10.0.0.1/graphql',
    'http://169.254.169.254/latest',
    'http://[::ffff:8.8.8.8]/graphql',
  ])('refuses the non-loopback host %s naming the variable', (value) => {
    expect(() => endpoint(value)).toThrow(/RAILWAY_API_ENDPOINT/);
  });

  it.each([
    'ftp://127.0.0.1/graphql',
    'file:///etc/passwd',
    'ws://127.0.0.1:4010/graphql',
    'wss://localhost/graphql',
    'javascript:alert(1)',
    'data:text/plain,http://127.0.0.1',
  ])('refuses the non-http scheme in %s', (value) => {
    expect(() => endpoint(value)).toThrow(/RAILWAY_API_ENDPOINT/);
  });

  it.each([
    ' ',
    '\n',
    'not a url',
    '127.0.0.1:4010/graphql',
    'localhost:4010',
    '//127.0.0.1/graphql',
    '/graphql',
    'http://',
    'http:///graphql',
    'http://[::1',
    'http://127.0.0.1:99999/graphql',
    'null',
    'undefined',
  ])('refuses the unparseable value %j naming the variable', (value) => {
    expect(() => endpoint(value)).toThrow(/RAILWAY_API_ENDPOINT/);
  });

  it('refuses a loopback url with leading whitespace around a foreign host', () => {
    expect(() => endpoint(' http://evil.com ')).toThrow(/RAILWAY_API_ENDPOINT/);
  });
});

type Run = { code: number | null; signal: string | null; output: string };

function minimalEnv(endpointValue: string): Record<string, string> {
  return {
    IMAGE_API: 'ghcr.io/x/api@sha256:new',
    IMAGE_WEB: 'ghcr.io/x/web@sha256:new',
    IMAGE_WORKER: 'ghcr.io/x/worker@sha256:new',
    RAILWAY_API_ENDPOINT: endpointValue,
    RAILWAY_API_TOKEN: 'fake-token',
    RAILWAY_ENVIRONMENT_ID: 'env-fake',
    RAILWAY_SERVICE_API: 'svc-api',
    RAILWAY_SERVICE_WEB: 'svc-web',
    RAILWAY_SERVICE_WORKER: 'svc-worker',
  };
}

function runCli(endpointValue: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, 'production'], {
      env: minimalEnv(endpointValue),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const take = (chunk: Buffer) => {
      output += chunk;
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, output, signal });
    });
  });
}

describe('the deploy script refuses a bad endpoint before any call', () => {
  let server: Server | undefined;
  let hits = 0;
  let port = 0;

  beforeEach(async () => {
    hits = 0;
    server = createServer((req, res) => {
      hits += 1;
      req.resume();
      res.statusCode = 500;
      res.end('{}');
    });
    await new Promise<void>((resolve) =>
      server?.listen(0, '127.0.0.1', resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
  });

  // @traces 506-FR-002
  it.each([
    ['a wildcard host', (p: number) => `http://0.0.0.0:${p}/graphql`],
    [
      'a foreign host behind loopback userinfo',
      (p: number) => `http://127.0.0.1:${p}@0.0.0.0:${p}/graphql`,
    ],
    ['a non-http scheme', (p: number) => `ftp://127.0.0.1:${p}/graphql`],
    ['a value that is not a url', () => 'not a url'],
  ])(
    'exits 1 naming the variable for %s and makes no call',
    async (_n, build) => {
      const run = await runCli(build(port));
      expect(run).toMatchObject({ code: 1, signal: null });
      expect(run.output).toContain('RAILWAY_API_ENDPOINT');
      expect(run.output).not.toContain('fake-token');
      expect(hits).toBe(0);
    },
  );
});
