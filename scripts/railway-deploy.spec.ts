import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import {
  API_PRE_DEPLOY,
  deploy,
  type Service,
  servicesFor,
} from './railway-deploy.ts';

type Call = { query: string; variables: Record<string, unknown> };

const services: Service[] = [
  {
    healthcheckPath: '/health/ready',
    id: 'svc-api',
    image: 'ghcr.io/x/api@sha256:new',
    name: 'api',
    preDeploy: API_PRE_DEPLOY,
    replicas: 2,
  },
  {
    healthcheckPath: '/health/live',
    id: 'svc-web',
    image: 'ghcr.io/x/web@sha256:new',
    name: 'web',
    replicas: 2,
  },
];

function answer(call: Call, status: () => string = () => 'DEPLOYING') {
  const serviceId = call.variables['serviceId'];
  if (call.query.includes('serviceInstance(')) {
    return {
      serviceInstance: { source: { image: `${serviceId}@sha256:old` } },
    };
  }
  if (call.query.includes('serviceInstanceUpdate')) {
    return { serviceInstanceUpdate: true };
  }
  if (call.query.includes('serviceInstanceDeployV2')) {
    return { serviceInstanceDeployV2: `dep-${serviceId}` };
  }
  return { deployment: { status: status() } };
}

// Resolves once the fake API has received a call matching the predicate, so a
// test cancels at a known point rather than after a guessed delay.
async function seenIn(calls: () => Call[], match: (call: Call) => boolean) {
  const until = Date.now() + 2_000;
  while (!calls().some(match)) {
    if (Date.now() > until) throw new Error('the expected call never came');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

// @traces 878-FR-001
describe('the api pre-deploy step', () => {
  it('migrates, then applies the monitor role password', () => {
    expect(API_PRE_DEPLOY).toEqual([
      'npx prisma migrate deploy && node scripts/monitor-password.ts',
    ]);
  });
});

describe('railway deploy', () => {
  let server: Server;
  let endpoint: string;
  let calls: Call[];
  let statuses: string[];

  beforeEach(async () => {
    calls = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        res.end(
          JSON.stringify({
            data: answer(call, () => statuses.shift() ?? 'DEPLOYING'),
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    endpoint = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const run = () =>
    deploy({
      endpoint,
      environmentId: 'env-1',
      limitMs: 200,
      pollMs: 5,
      services,
      token: 't',
    });

  const seen = (match: (call: Call) => boolean) => seenIn(() => calls, match);

  const updates = () =>
    calls
      .filter((c) => c.query.includes('serviceInstanceUpdate'))
      .map((c) => c.variables);

  it('points each service at its image in the EU region and waits for it', async () => {
    statuses = ['DEPLOYING', 'SUCCESS', 'SUCCESS'];

    await run();

    expect(updates()).toEqual([
      {
        environmentId: 'env-1',
        input: {
          healthcheckPath: '/health/ready',
          healthcheckTimeout: 300,
          numReplicas: 2,
          preDeployCommand: API_PRE_DEPLOY,
          region: 'europe-west4-drams3a',
          source: { image: 'ghcr.io/x/api@sha256:new' },
        },
        serviceId: 'svc-api',
      },
      {
        environmentId: 'env-1',
        input: {
          healthcheckPath: '/health/live',
          healthcheckTimeout: 300,
          numReplicas: 2,
          region: 'europe-west4-drams3a',
          source: { image: 'ghcr.io/x/web@sha256:new' },
        },
        serviceId: 'svc-web',
      },
    ]);
  });

  it('sends the token as a bearer token', async () => {
    let auth: string | undefined;
    server.prependListener('request', (req) => {
      auth = req.headers.authorization;
    });
    statuses = ['SUCCESS', 'SUCCESS'];

    await run();

    expect(auth).toBe('Bearer t');
  });

  it('puts the previous image back and fails when a deployment fails', async () => {
    statuses = ['FAILED'];

    await expect(run()).rejects.toThrow('api: deployment FAILED');
    expect(updates().at(-1)).toEqual({
      environmentId: 'env-1',
      input: { source: { image: 'svc-api@sha256:old' } },
      serviceId: 'svc-api',
    });
    expect(calls.some((c) => c.variables['serviceId'] === 'svc-web')).toBe(
      false,
    );
  });

  it('puts the previous image back when the run is cancelled mid-deploy', async () => {
    statuses = [];
    const cancel = new AbortController();
    const started = deploy({
      endpoint,
      environmentId: 'env-1',
      limitMs: 10_000,
      pollMs: 5,
      services,
      signal: cancel.signal,
      token: 't',
    });
    await seen((c) => c.query.includes('deployment('));
    cancel.abort();

    await expect(started).rejects.toThrow('cancelled');
    expect(updates().at(-1)).toEqual({
      environmentId: 'env-1',
      input: { source: { image: 'svc-api@sha256:old' } },
      serviceId: 'svc-api',
    });
    const redeploys = calls
      .filter((c) => c.query.includes('serviceInstanceDeployV2'))
      .map((c) => c.variables['serviceId']);
    expect(redeploys).toEqual(['svc-api', 'svc-api']);
    expect(calls.some((c) => c.variables['serviceId'] === 'svc-web')).toBe(
      false,
    );
  });

  it('redeploys the services already live when the run is cancelled', async () => {
    statuses = ['SUCCESS'];
    const cancel = new AbortController();
    const started = deploy({
      endpoint,
      environmentId: 'env-1',
      limitMs: 10_000,
      pollMs: 5,
      services,
      signal: cancel.signal,
      token: 't',
    });
    await seen(
      (c) =>
        c.query.includes('deployment(') && c.variables['id'] === 'dep-svc-web',
    );
    cancel.abort();

    await expect(started).rejects.toThrow('cancelled');
    const restores = updates().filter(
      (u) => !('healthcheckPath' in (u['input'] as object)),
    );
    restores.sort((x, y) =>
      String(x['serviceId']).localeCompare(String(y['serviceId'])),
    );
    expect(restores).toEqual([
      {
        environmentId: 'env-1',
        input: { source: { image: 'svc-api@sha256:old' } },
        serviceId: 'svc-api',
      },
      {
        environmentId: 'env-1',
        input: { source: { image: 'svc-web@sha256:old' } },
        serviceId: 'svc-web',
      },
    ]);
    const redeploys = calls
      .filter((c) => c.query.includes('serviceInstanceDeployV2'))
      .map((c) => c.variables['serviceId']);
    expect(redeploys.slice(0, 2)).toEqual(['svc-api', 'svc-web']);
    expect(redeploys.slice(2).sort()).toEqual(['svc-api', 'svc-web']);
  });

  it('redeploys the previous image when cancelled while the deploy request is in flight', async () => {
    statuses = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancel = new AbortController();
    const slow = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        if (
          call.query.includes('serviceInstanceDeployV2') &&
          !cancel.signal.aborted
        ) {
          await held;
        }
        res.end(JSON.stringify({ data: answer(call) }));
      });
    });
    await new Promise<void>((resolve) => slow.listen(0, resolve));
    const started = deploy({
      endpoint: `http://localhost:${(slow.address() as AddressInfo).port}`,
      environmentId: 'env-1',
      limitMs: 10_000,
      pollMs: 5,
      services,
      signal: cancel.signal,
      token: 't',
    });
    await seen((c) => c.query.includes('serviceInstanceDeployV2'));
    cancel.abort();

    await expect(started).rejects.toThrow('cancelled');
    release();
    await new Promise((resolve) => slow.close(resolve));
    expect(updates().at(-1)).toEqual({
      environmentId: 'env-1',
      input: { source: { image: 'svc-api@sha256:old' } },
      serviceId: 'svc-api',
    });
    const redeploys = calls
      .filter((c) => c.query.includes('serviceInstanceDeployV2'))
      .map((c) => c.variables['serviceId']);
    expect(redeploys).toEqual(['svc-api', 'svc-api']);
  });

  it('still restores the other services when one restore fails', async () => {
    statuses = ['SUCCESS', 'FAILED'];
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        const input = call.variables['input'] as
          | { source?: { image?: string } }
          | undefined;
        if (input?.source?.image === 'svc-api@sha256:old') {
          res.end(JSON.stringify({ errors: [{ message: 'busy' }] }));
          return;
        }
        res.end(
          JSON.stringify({
            data: answer(call, () => statuses.shift() ?? 'DEPLOYING'),
          }),
        );
      });
    });

    await expect(run()).rejects.toThrow('web: deployment FAILED');
    expect(updates()).toContainEqual({
      environmentId: 'env-1',
      input: { source: { image: 'svc-web@sha256:old' } },
      serviceId: 'svc-web',
    });
  });

  it('fails as cancelled without touching anything when cancelled before it starts', async () => {
    const cancel = new AbortController();
    cancel.abort();

    await expect(
      deploy({
        endpoint,
        environmentId: 'env-1',
        limitMs: 200,
        pollMs: 5,
        services,
        signal: cancel.signal,
        token: 't',
      }),
    ).rejects.toThrow('cancelled');
    expect(updates()).toEqual([]);
  });

  it('puts the previous image back when the health check never passes in time', async () => {
    statuses = [];

    await expect(run()).rejects.toThrow('api: not healthy');
    expect(updates().at(-1)?.['input']).toEqual({
      source: { image: 'svc-api@sha256:old' },
    });
  });
});

describe('railway deploy when the Railway API itself fails', () => {
  it('names the HTTP status instead of failing to parse an error page', async () => {
    const down = createServer((_req, res) =>
      res.writeHead(502, { 'content-type': 'text/html' }).end('<html>'),
    );
    await new Promise<void>((resolve) => down.listen(0, resolve));
    const endpoint = `http://localhost:${(down.address() as AddressInfo).port}`;

    await expect(
      deploy({
        endpoint,
        environmentId: 'env-1',
        limitMs: 200,
        pollMs: 5,
        services,
        token: 't',
      }),
    ).rejects.toThrow('Railway API answered HTTP 502');

    await new Promise((resolve) => down.close(resolve));
  });

  it("names Railway's GraphQL errors from a 400 body", async () => {
    const invalid = createServer((_req, res) =>
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          errors: [
            { message: 'Variable "$serviceId" of type "String" is wrong.' },
            { message: 'Variable "$environmentId" is wrong.' },
          ],
        }),
      ),
    );
    await new Promise<void>((resolve) => invalid.listen(0, resolve));
    const endpoint = `http://localhost:${(invalid.address() as AddressInfo).port}`;

    await expect(
      deploy({
        endpoint,
        environmentId: 'env-1',
        limitMs: 200,
        pollMs: 5,
        services,
        token: 't',
      }),
    )
      .rejects.toThrow(
        'Railway API answered HTTP 400: Variable "$serviceId" of type "String" is wrong.; Variable "$environmentId" is wrong.',
      )
      .finally(() => new Promise((resolve) => invalid.close(resolve)));
  });
});

// Railway's public schema (backboard.railway.com/graphql/v2): every argument
// below is String!, except serviceInstanceUpdate's environmentId (String).
// A nullable variable in a String! position fails validation with HTTP 400.
describe('railway deploy query variables', () => {
  const NON_NULL: Record<string, string[]> = {
    deployment: ['id'],
    serviceInstance: ['serviceId', 'environmentId'],
    serviceInstanceDeployV2: ['serviceId', 'environmentId'],
    serviceInstanceUpdate: ['serviceId'],
  };

  it('declares String! for every argument Railway requires', async () => {
    const queries: string[] = [];
    const fake = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        queries.push(call.query);
        res.end(JSON.stringify({ data: answer(call, () => 'SUCCESS') }));
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, resolve));
    const endpoint = `http://localhost:${(fake.address() as AddressInfo).port}`;

    try {
      await deploy({
        endpoint,
        environmentId: 'env-1',
        limitMs: 200,
        pollMs: 5,
        services,
        token: 't',
      });
    } finally {
      await new Promise((resolve) => fake.close(resolve));
    }

    for (const [field, args] of Object.entries(NON_NULL)) {
      const query = queries.find((q) => q.includes(` ${field}(`));
      expect(query).toBeDefined();
      for (const arg of args) expect(query).toContain(`$${arg}: String!`);
    }
  });
});

describe('railway deploy with a project token', () => {
  let server: Server;
  let endpoint: string;
  let seen: { authorization?: string; project?: string }[];
  // Answers "Not Authorized" (HTTP 200, as Railway does) to a bearer token.
  let bearerRefused: boolean;

  beforeEach(async () => {
    seen = [];
    bearerRefused = false;
    server = createServer((req, res) => {
      const headers = {
        authorization: req.headers.authorization,
        project: req.headers['project-access-token'] as string | undefined,
      };
      seen.push(headers);
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        if (bearerRefused && headers.authorization) {
          res.end(
            JSON.stringify({
              data: null,
              errors: [{ message: 'Not Authorized' }],
            }),
          );
          return;
        }
        const call = JSON.parse(body) as Call;
        res.end(JSON.stringify({ data: answer(call, () => 'SUCCESS') }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    endpoint = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const run = (tokenKind?: 'bearer' | 'project') =>
    deploy({
      endpoint,
      environmentId: 'env-1',
      limitMs: 200,
      pollMs: 5,
      services,
      token: 't',
      ...(tokenKind && { tokenKind }),
    });

  it('sends a project token as Project-Access-Token, never as a bearer', async () => {
    await run('project');

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((h) => h.project === 't' && !h.authorization)).toBe(true);
  });

  it('retries as a project token when Railway refuses the bearer, then keeps it', async () => {
    bearerRefused = true;

    await run();

    expect(seen[0]).toEqual({ authorization: 'Bearer t', project: undefined });
    expect(
      seen.slice(1).every((h) => h.project === 't' && !h.authorization),
    ).toBe(true);
  });

  it('does not retry an explicit bearer token, and says Railway refused it', async () => {
    bearerRefused = true;

    await expect(run('bearer')).rejects.toThrow('Not Authorized');
    expect(seen.every((h) => !h.project)).toBe(true);
  });
});

const ALL = {
  IMAGE_API: 'img/api@sha256:a',
  IMAGE_KEYCLOAK: 'img/keycloak@sha256:k',
  IMAGE_MCP: 'img/mcp@sha256:m',
  IMAGE_WEB: 'img/web@sha256:w',
  IMAGE_WORKER: 'img/worker@sha256:r',
  RAILWAY_SERVICE_API: 'svc-api',
  RAILWAY_SERVICE_KEYCLOAK: 'svc-keycloak',
  RAILWAY_SERVICE_MCP: 'svc-mcp',
  RAILWAY_SERVICE_WEB: 'svc-web',
  RAILWAY_SERVICE_WORKER: 'svc-worker',
};

const REALM_HEALTH = '/realms/motorfix-assistants';

describe('the services each environment deploys', () => {
  let notices: string[];

  beforeEach(() => {
    notices = [];
    jest.spyOn(console, 'log').mockImplementation((line: string) => {
      notices.push(line);
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const names = (list: Service[]) => list.map((s) => s.name);

  it('deploys the identity server, then the MCP server, after the three apps on staging', () => {
    const list = servicesFor('staging', ALL);

    expect(names(list)).toEqual(['api', 'worker', 'web', 'keycloak', 'mcp']);
    expect(list.map((s) => [s.name, s.healthcheckPath, s.replicas])).toEqual([
      ['api', '/health/ready', 1],
      ['worker', '/health/ready', 1],
      ['web', '/health/ready', 1],
      ['keycloak', REALM_HEALTH, 1],
      ['mcp', '/health/live', 1],
    ]);
    expect(list.find((s) => s.name === 'mcp')).toMatchObject({
      id: 'svc-mcp',
      image: 'img/mcp@sha256:m',
    });
    expect(list.find((s) => s.name === 'api')?.preDeploy).toEqual(
      API_PRE_DEPLOY,
    );
    expect(list.find((s) => s.name === 'mcp')?.preDeploy).toBeUndefined();
    expect(notices).toEqual([]);
  });

  it('keeps production to the three apps, api and web on two replicas', () => {
    const read: string[] = [];
    const env = new Proxy(ALL as Record<string, string>, {
      get(target, key: string) {
        read.push(key);
        return target[key];
      },
    });

    const list = servicesFor('production', env);

    expect(list.map((s) => [s.name, s.replicas])).toEqual([
      ['api', 2],
      ['worker', 1],
      ['web', 2],
    ]);
    expect(read.filter((k) => /MCP|KEYCLOAK/.test(k))).toEqual([]);
    expect(notices).toEqual([]);
  });

  it('refuses an environment it does not know', () => {
    expect(() => servicesFor('preview', ALL)).toThrow(
      'usage: railway-deploy.ts <staging|production>',
    );
  });

  it('skips both new services with a notice each before the owner has created them', () => {
    const {
      RAILWAY_SERVICE_MCP: _m,
      RAILWAY_SERVICE_KEYCLOAK: _k,
      ...env
    } = ALL;

    expect(names(servicesFor('staging', env))).toEqual([
      'api',
      'worker',
      'web',
    ]);
    expect(notices).toEqual([
      '::notice::RAILWAY_SERVICE_KEYCLOAK is not set; keycloak was not deployed for this release.',
      '::notice::RAILWAY_SERVICE_MCP is not set; mcp was not deployed for this release.',
    ]);
  });

  it('treats an empty id as not set', () => {
    const env = { ...ALL, RAILWAY_SERVICE_MCP: '' };

    expect(names(servicesFor('staging', env))).toEqual([
      'api',
      'worker',
      'web',
      'keycloak',
    ]);
    expect(notices).toEqual([
      '::notice::RAILWAY_SERVICE_MCP is not set; mcp was not deployed for this release.',
    ]);
  });

  it('fails when a new service has its id but no image', () => {
    const { IMAGE_MCP: _i, ...env } = ALL;

    expect(() => servicesFor('staging', env)).toThrow(
      'missing environment variable IMAGE_MCP',
    );
  });

  it.each(['API', 'WORKER', 'WEB'])(
    'still fails when RAILWAY_SERVICE_%s is missing',
    (app) => {
      const env: Record<string, string> = { ...ALL };
      delete env[`RAILWAY_SERVICE_${app}`];

      expect(() => servicesFor('staging', env)).toThrow(
        `missing environment variable RAILWAY_SERVICE_${app}`,
      );
    },
  );
});

describe('a staging release whose identity server fails its health check', () => {
  let server: Server;
  let calls: Call[];

  beforeEach(async () => {
    calls = [];
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        const id = String(call.variables['id']);
        res.end(
          JSON.stringify({
            data: answer(call, () =>
              id === 'dep-svc-keycloak' ? 'FAILED' : 'SUCCESS',
            ),
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve) => server.close(resolve));
  });

  it('restores the three apps, never starts the MCP server, and sends each health path', async () => {
    await expect(
      deploy({
        endpoint: `http://localhost:${(server.address() as AddressInfo).port}`,
        environmentId: 'env-1',
        limitMs: 200,
        pollMs: 5,
        services: servicesFor('staging', ALL),
        token: 't',
      }),
    ).rejects.toThrow('keycloak: deployment FAILED');

    const updates = calls
      .filter((c) => c.query.includes('serviceInstanceUpdate'))
      .map((c) => c.variables);
    const deploys = updates.filter(
      (u) => 'healthcheckPath' in (u['input'] as object),
    );
    expect(
      deploys.map((u) => [
        u['serviceId'],
        (u['input'] as { healthcheckPath: string }).healthcheckPath,
      ]),
    ).toEqual([
      ['svc-api', '/health/ready'],
      ['svc-worker', '/health/ready'],
      ['svc-web', '/health/ready'],
      ['svc-keycloak', REALM_HEALTH],
    ]);
    const restored = updates
      .filter((u) => !('healthcheckPath' in (u['input'] as object)))
      .map((u) => u['serviceId'])
      .sort();
    expect(restored).toEqual([
      'svc-api',
      'svc-keycloak',
      'svc-web',
      'svc-worker',
    ]);
    expect(calls.some((c) => c.variables['serviceId'] === 'svc-mcp')).toBe(
      false,
    );
  });
});

const keycloak = (file: string) =>
  readFileSync(join(__dirname, '..', 'infra', 'keycloak', file), 'utf8');

describe('the keycloak image', () => {
  const dockerfile = keycloak('Dockerfile');

  it('is Keycloak 26.8 with the realm in its import folder and a small heap', () => {
    expect(dockerfile).toMatch(/^FROM quay\.io\/keycloak\/keycloak:26\.8$/m);
    expect(dockerfile).toMatch(
      /^COPY realm-motorfix-assistants\.json \/opt\/keycloak\/data\/import\/$/m,
    );
    expect(dockerfile).toMatch(/^ENV JAVA_OPTS_KC_HEAP="-Xms128m -Xmx512m"$/m);
  });

  it('starts behind the proxy, imports the realm and takes its address from the environment', () => {
    const cmd = dockerfile.match(/^CMD (\[.*\])$/m)?.[1];

    expect(cmd && JSON.parse(cmd)).toEqual([
      'start',
      '--import-realm',
      '--features=cimd,resource-indicators',
      '--proxy-headers=xforwarded',
      '--http-enabled=true',
    ]);
    expect(dockerfile).not.toContain('--hostname');
  });

  // The realm's own endpoint: Keycloak opens its port only once the import
  // has finished, and a failed import stops the server.
  it('is checked at the endpoint of the realm it imports', () => {
    const { realm } = JSON.parse(
      keycloak('realm-motorfix-assistants.json'),
    ) as {
      realm: string;
    };

    expect(REALM_HEALTH).toBe(`/realms/${realm}`);
    expect(
      servicesFor('staging', ALL).find((s) => s.name === 'keycloak')
        ?.healthcheckPath,
    ).toBe(REALM_HEALTH);
  });
});

describe('the keycloak README', () => {
  const readme = keycloak('README.md');

  it.each([
    'MCP_URL',
    'ASSISTANT_ISSUER',
    'ASSISTANT_TRUSTED_DOMAINS',
    'ASSISTANT_BROKER_CLIENT_ID',
    'ASSISTANT_BROKER_CLIENT_SECRET',
    'ASSISTANT_BROKER_REDIRECT_URI',
    'PUBLIC_WEB_URL',
    'API_INTERNAL_URL',
    'DATABASE_URL',
    'APP_ENV',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_EXPORTER_OTLP_PROTOCOL',
    'KC_DB',
    'KC_DB_URL',
    'KC_DB_USERNAME',
    'KC_DB_PASSWORD',
    'KC_HOSTNAME',
    'KC_BOOTSTRAP_ADMIN_USERNAME',
    'KC_BOOTSTRAP_ADMIN_PASSWORD',
    'RAILWAY_SERVICE_MCP',
    'RAILWAY_SERVICE_KEYCLOAK',
  ])('names %s for the staging setup', (name) => {
    const setup = readme.slice(readme.indexOf('## Railway'));

    expect(setup).toMatch(new RegExp(`\`${name}\``));
  });

  it('leaves ASSISTANT_ALLOW_HTTP off staging', () => {
    const setup = readme.slice(readme.indexOf('## Railway'));
    const lines = setup
      .split('\n')
      .filter((l) => l.includes('ASSISTANT_ALLOW_HTTP'));

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => /not set|never|without/i.test(l))).toBe(true);
  });

  it('holds names only: no digest, Railway address or id', () => {
    expect(readme).not.toMatch(/sha256|railway\.app|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('says production gets neither service', () => {
    const setup = readme.slice(readme.indexOf('## Railway'));

    expect(setup).toMatch(/[Ss]taging only/);
  });
});
