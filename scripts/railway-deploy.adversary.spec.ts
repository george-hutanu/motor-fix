import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import {
  apiPreDeploy,
  deploy,
  putSeedPassword,
  type Service,
  seedPassword,
  servicesFor,
} from './railway-deploy.ts';

type Call = { query: string; variables: Record<string, unknown> };

const services: Service[] = [
  {
    healthcheckPath: '/health/ready',
    id: 'svc-api',
    image: 'img/api@sha256:new',
    name: 'api',
    replicas: 1,
  },
  {
    healthcheckPath: '/health/ready',
    id: 'svc-worker',
    image: 'img/worker@sha256:new',
    name: 'worker',
    replicas: 1,
  },
  {
    healthcheckPath: '/health/ready',
    id: 'svc-web',
    image: 'img/web@sha256:new',
    name: 'web',
    replicas: 1,
  },
];

describe('railway deploy under failure', () => {
  let server: Server;
  let endpoint: string;
  let calls: Call[];
  let statusFor: (serviceId: string, poll: number) => string;
  let previousFor: (serviceId: string) => string | null;
  let respond: (call: Call) => { status?: number; body: unknown } | undefined;
  let polls: Record<string, number>;

  beforeEach(async () => {
    calls = [];
    polls = {};
    respond = () => undefined;
    previousFor = (id) => `${id}@sha256:old`;
    statusFor = () => 'SUCCESS';
    const defaultAnswer = (call: Call): unknown => {
      const id = String(call.variables['serviceId']);
      const dep = String(call.variables['id']).replace('dep-', '');
      const previous = previousFor(id);
      const answers: [string, () => unknown][] = [
        [
          'serviceInstance(',
          () => ({
            serviceInstance: { source: previous ? { image: previous } : null },
          }),
        ],
        ['serviceInstanceUpdate', () => ({ serviceInstanceUpdate: true })],
        [
          'serviceInstanceDeployV2',
          () => ({ serviceInstanceDeployV2: `dep-${id}` }),
        ],
      ];
      const match = answers.find(([marker]) => call.query.includes(marker));
      if (match) return match[1]();
      polls[dep] = (polls[dep] ?? 0) + 1;
      return { deployment: { status: statusFor(dep, polls[dep] ?? 0) } };
    };
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        const custom = respond(call);
        if (custom) {
          res.statusCode = custom.status ?? 200;
          res.end(
            typeof custom.body === 'string'
              ? custom.body
              : JSON.stringify(custom.body),
          );
          return;
        }
        const data = defaultAnswer(call);
        res.end(JSON.stringify({ data }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    endpoint = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const run = (list: Service[] = services, limitMs = 200) =>
    deploy({
      endpoint,
      environmentId: 'env-1',
      limitMs,
      pollMs: 5,
      services: list,
      token: 'tok-secret',
    });

  const updates = () =>
    calls
      .filter((c) => c.query.includes('serviceInstanceUpdate'))
      .map((c) => ({
        id: c.variables['serviceId'],
        input: c.variables['input'] as { source?: { image?: string } },
      }));

  it('does nothing and resolves for an empty service list', async () => {
    await expect(run([])).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('deploys the services in the given order', async () => {
    await run();

    expect(updates().map((u) => u.id)).toEqual([
      'svc-api',
      'svc-worker',
      'svc-web',
    ]);
  });

  it.each(['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'])(
    'restores the previous image when the deployment ends as %s',
    async (status) => {
      statusFor = () => status;

      await expect(run()).rejects.toThrow(status);
      expect(updates().at(-1)).toEqual({
        id: 'svc-api',
        input: { source: { image: 'svc-api@sha256:old' } },
      });
    },
  );

  it('restores the previous images of the services already deployed when a later one fails', async () => {
    statusFor = (id) => (id === 'svc-web' ? 'FAILED' : 'SUCCESS');

    await expect(run()).rejects.toThrow('web: deployment FAILED');

    const restored = updates()
      .filter(
        (u) =>
          u.input.source?.image?.endsWith(':old') ||
          u.input.source?.image?.endsWith('@sha256:old'),
      )
      .map((u) => u.id)
      .sort();
    expect(restored).toEqual(['svc-api', 'svc-web', 'svc-worker']);
    const deploys = (id: string) =>
      calls.filter(
        (c) =>
          c.query.includes('serviceInstanceDeployV2') &&
          c.variables['serviceId'] === id,
      ).length;
    expect([
      deploys('svc-api'),
      deploys('svc-worker'),
      deploys('svc-web'),
    ]).toEqual([2, 2, 1]);
  });

  it('does not write an empty image when the service had no previous image', async () => {
    previousFor = () => null;
    statusFor = () => 'FAILED';

    await expect(run()).rejects.toThrow('api: deployment FAILED');

    const last = updates().at(-1);
    expect(last?.input.source?.image).not.toBeUndefined();
    expect(last?.input.source?.image).toBe('img/api@sha256:new');
  });

  it('fails with the GraphQL error message when the API rejects the token', async () => {
    respond = () => ({ body: { errors: [{ message: 'Not Authorized' }] } });

    await expect(run()).rejects.toThrow('Not Authorized');
  });

  it('never prints the token in an error', async () => {
    respond = () => ({ body: { errors: [{ message: 'Not Authorized' }] } });

    await expect(run()).rejects.not.toThrow(/tok-secret/);
  });

  it('rejects with a clear error when Railway answers 502 with HTML', async () => {
    respond = () => ({ body: '<html>Bad Gateway</html>', status: 502 });

    await expect(run()).rejects.toThrow();
  });

  it('rejects when the endpoint is unreachable', async () => {
    await new Promise((resolve) => server.close(resolve));

    await expect(run()).rejects.toThrow();
    server = createServer();
  });

  it('restores the previous image when status polling itself starts failing', async () => {
    respond = (call) =>
      call.query.includes('deployment(')
        ? { body: { errors: [{ message: 'rate limited' }] } }
        : undefined;

    await expect(run()).rejects.toThrow();

    expect(updates().at(-1)?.input).toEqual({
      source: { image: 'svc-api@sha256:old' },
    });
  });

  it('times out on a deployment that stays in progress and names the limit', async () => {
    statusFor = () => 'DEPLOYING';

    await expect(run(services, 100)).rejects.toThrow(
      'api: not healthy within 0.1 s',
    );
  });

  it('times out when the limit is zero without polling forever', async () => {
    statusFor = () => 'DEPLOYING';

    await expect(run(services, 0)).rejects.toThrow('api: not healthy');
  });

  it('does not touch later services after a failure', async () => {
    statusFor = () => 'FAILED';

    await expect(run()).rejects.toThrow();

    const touched = new Set(calls.map((c) => c.variables['serviceId']));
    expect(touched.has('svc-worker')).toBe(false);
    expect(touched.has('svc-web')).toBe(false);
  });

  it('sends the migration command only to the service that has one', async () => {
    await run([
      { ...services[0]!, preDeploy: ['npx prisma migrate deploy'] },
      services[2]!,
    ]);

    const inputs = calls
      .filter((c) => c.query.includes('serviceInstanceUpdate'))
      .map((c) => c.variables['input'] as Record<string, unknown>);
    expect(inputs[0]).toHaveProperty('preDeployCommand', [
      'npx prisma migrate deploy',
    ]);
    expect(inputs[1]).not.toHaveProperty('preDeployCommand');
  });
});

describe('the staging seed password under hostile input', () => {
  const PASSWORD = 'p"a\\ss/&=é 7!';
  let calls: Call[];
  let respond: (
    call: Call,
    raw: { send: (status: number, text: string) => void },
  ) => void;
  let endpoint: string;
  let server: Server;

  beforeEach(async () => {
    calls = [];
    respond = (call, raw) => {
      raw.send(200, JSON.stringify({ data: answerFor(call) }));
    };
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        res.setHeader('content-type', 'application/json');
        respond(call, {
          send: (status, text) => {
            res.statusCode = status;
            res.end(text);
          },
        });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql/v2`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  function answerFor(call: Call) {
    const id = call.variables['serviceId'];
    if (call.query.includes('serviceInstance(')) {
      return { serviceInstance: { source: { image: `${id}@sha256:old` } } };
    }
    if (call.query.includes('serviceInstanceUpdate')) {
      return { serviceInstanceUpdate: true };
    }
    if (call.query.includes('serviceInstanceDeployV2')) {
      return { serviceInstanceDeployV2: `dep-${id}` };
    }
    if (call.query.includes('variableUpsert')) return { variableUpsert: true };
    return { deployment: { status: 'SUCCESS' } };
  }

  const options = () => ({
    endpoint,
    environmentId: 'env-1',
    limitMs: 1_000,
    pollMs: 1,
    services: [],
    token: 'tok',
  });
  const target = { projectId: 'p1', serviceId: 'svc-api' };

  async function messageOf(promise: Promise<unknown>) {
    try {
      await promise;
    } catch (error) {
      return (error as Error).message;
    }
    return 'did not fail';
  }

  const echoes: [string, (v: string) => string][] = [
    ['verbatim', (v) => `bad value ${v}`],
    ['twice in one message', (v) => `${v} and again ${v}`],
    ['surrounded by quotes', (v) => `invalid "${v}"`],
  ];

  // @traces 1370-release-seed-no-ssh-FR-003
  it.each(echoes)(
    'redacts a password echoed %s in a GraphQL error',
    async (_, text) => {
      respond = (_c, raw) =>
        raw.send(
          200,
          JSON.stringify({ errors: [{ message: text(PASSWORD) }] }),
        );

      const message = await messageOf(
        putSeedPassword(options(), 'staging', target, PASSWORD),
      );

      expect(message).not.toContain(PASSWORD);
      expect(message).toContain('[redacted]');
    },
  );

  // @traces 1370-release-seed-no-ssh-FR-003
  it('redacts a password echoed in an HTTP 400 error body', async () => {
    respond = (_c, raw) =>
      raw.send(
        400,
        JSON.stringify({ errors: [{ message: `got ${PASSWORD}` }] }),
      );

    const message = await messageOf(
      putSeedPassword(options(), 'staging', target, PASSWORD),
    );

    expect(message).toBe('Railway API answered HTTP 400: got [redacted]');
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('redacts a password that Railway echoes JSON-escaped inside its error text', async () => {
    respond = (_c, raw) =>
      raw.send(
        200,
        JSON.stringify({
          errors: [
            {
              message: `rejected input ${JSON.stringify({ value: PASSWORD })}`,
            },
          ],
        }),
      );

    const message = await messageOf(
      putSeedPassword(options(), 'staging', target, PASSWORD),
    );

    expect(message).not.toContain(JSON.stringify(PASSWORD).slice(1, -1));
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('redacts a password that Railway echoes URL-encoded inside its error text', async () => {
    respond = (_c, raw) =>
      raw.send(
        200,
        JSON.stringify({
          errors: [
            { message: `bad query ?value=${encodeURIComponent(PASSWORD)}` },
          ],
        }),
      );

    const message = await messageOf(
      putSeedPassword(options(), 'staging', target, PASSWORD),
    );

    expect(message).not.toContain(encodeURIComponent(PASSWORD));
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('does not leave the password in a message that echoes only its first half', async () => {
    const password = 'Tr0ub4dor&3-horse';
    respond = (_c, raw) =>
      raw.send(
        200,
        JSON.stringify({
          errors: [{ message: `too short: ${password.slice(0, 8)}` }],
        }),
      );

    const message = await messageOf(
      putSeedPassword(options(), 'staging', target, password),
    );

    expect(message).not.toContain(password.slice(0, 8));
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('redacts the password when the token fallback retry also echoes it', async () => {
    let n = 0;
    respond = (_c, raw) => {
      n += 1;
      const message = n === 1 ? 'Not Authorized' : `bad ${PASSWORD}`;
      raw.send(200, JSON.stringify({ errors: [{ message }] }));
    };

    const message = await messageOf(
      putSeedPassword(options(), 'staging', target, PASSWORD),
    );

    expect(n).toBe(2);
    expect(message).toBe('bad [redacted]');
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('redacts a regex-special password without mangling the rest of the text', async () => {
    const password = '$&.*+?(a|b)[x]\\1';
    respond = (_c, raw) =>
      raw.send(
        200,
        JSON.stringify({ errors: [{ message: `abc ${password} xyz abc` }] }),
      );

    const message = await messageOf(
      putSeedPassword(options(), 'staging', target, password),
    );

    expect(message).toBe('abc [redacted] xyz abc');
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('keeps the password out of an error from a later call of the same deploy', async () => {
    const api: Service = {
      healthcheckPath: '/health/ready',
      id: 'svc-api',
      image: 'img/api@sha256:new',
      name: 'api',
      replicas: 1,
    };
    respond = (call, raw) => {
      if (call.query.includes('serviceInstanceDeployV2')) {
        raw.send(
          200,
          JSON.stringify({ errors: [{ message: `env has ${PASSWORD}` }] }),
        );
        return;
      }
      raw.send(200, JSON.stringify({ data: answerFor(call) }));
    };

    const message = await messageOf(
      deploy({ ...options(), secrets: [PASSWORD], services: [api] }),
    );

    expect(message).toBe('env has [redacted]');
  });

  // @traces 1370-release-seed-no-ssh-FR-003
  it('keeps the password out of the error when the api deployment fails', async () => {
    const api: Service = {
      healthcheckPath: '/health/ready',
      id: 'svc-api',
      image: 'img/api@sha256:new',
      name: 'api',
      preDeploy: apiPreDeploy('staging'),
      replicas: 1,
    };
    respond = (call, raw) => {
      const data = call.query.includes('deployment(')
        ? { deployment: { status: 'FAILED' } }
        : answerFor(call);
      raw.send(200, JSON.stringify({ data }));
    };

    const message = await messageOf(
      deploy({ ...options(), secrets: [PASSWORD], services: [api] }),
    );

    expect(message).toContain('api: deployment FAILED');
    expect(message).toContain('sh scripts/api-pre-deploy.sh staging');
    expect(message).not.toContain(PASSWORD);
    expect(calls.filter((c) => JSON.stringify(c).includes(PASSWORD))).toEqual(
      [],
    );
  });

  // @traces 1370-release-seed-no-ssh-FR-002
  it.each([
    'production',
    'Staging',
    'STAGING',
    ' staging',
    'staging ',
    'staging\n',
    'staging-2',
    'stagin',
    'prod',
    '',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
  ])('writes no variable for the environment %j', async (environment) => {
    const message = await messageOf(
      putSeedPassword(options(), environment, target, PASSWORD),
    );

    expect(message).toBe('SEED_PASSWORD is written to staging only');
    expect(calls).toEqual([]);
  });

  // @traces 1370-release-seed-no-ssh-FR-001
  it.each([
    'Staging',
    'STAGING',
    ' staging',
    'staging ',
    'staging-2',
    '',
    '__proto__',
    'constructor',
    'toString',
    'production ',
    'Production',
  ])('refuses a pre-deploy command for the environment %j', (environment) => {
    expect(() => apiPreDeploy(environment)).toThrow(
      'usage: railway-deploy.ts <staging|production>',
    );
  });

  // @traces 1370-release-seed-no-ssh-FR-001
  it('puts the seed in no production service pre-deploy command, with every variable set', () => {
    const env = {
      IMAGE_API: 'a',
      IMAGE_KEYCLOAK: 'k',
      IMAGE_MCP: 'm',
      IMAGE_WEB: 'w',
      IMAGE_WORKER: 'x',
      RAILWAY_SERVICE_API: '1',
      RAILWAY_SERVICE_KEYCLOAK: '2',
      RAILWAY_SERVICE_MCP: '3',
      RAILWAY_SERVICE_WEB: '4',
      RAILWAY_SERVICE_WORKER: '5',
      SEED_PASSWORD: PASSWORD,
    };

    const production = servicesFor('production', env);

    expect(production.map((s) => s.name)).toEqual(['api', 'worker', 'web']);
    expect(JSON.stringify(production)).not.toMatch(/seed|reset-staging/i);
    const staging = servicesFor('staging', env);
    expect(staging.filter((s) => s.preDeploy)).toHaveLength(1);
    expect(staging.find((s) => s.name === 'api')?.preDeploy).toEqual([
      'sh scripts/api-pre-deploy.sh staging',
    ]);
  });

  // @traces 1370-release-seed-no-ssh-FR-002
  it.each(['production', 'Staging', 'STAGING', '', '__proto__', 'staging '])(
    'returns no seed password for the environment %j',
    (environment) => {
      expect(
        seedPassword(environment, { SEED_PASSWORD: PASSWORD }),
      ).toBeUndefined();
    },
  );

  // @traces 1370-release-seed-no-ssh-FR-002
  it.each([undefined, ''])(
    'rejects a staging password of %j naming the variable',
    (value) => {
      expect(() => seedPassword('staging', { SEED_PASSWORD: value })).toThrow(
        /SEED_PASSWORD/,
      );
    },
  );

  // @traces 1370-release-seed-no-ssh-FR-002
  it('returns a staging password byte for byte, whitespace and unicode included', () => {
    const value = '  pä ss\t\n';

    expect(seedPassword('staging', { SEED_PASSWORD: value })).toBe(value);
  });
});

describe('the deploy script as a process, with odd environments and a missing project', () => {
  const script = join(__dirname, 'railway-deploy.ts');
  const PASSWORD = 'tajna-de-proba-93';
  let calls: Call[];
  let server: Server;
  let endpoint: string;

  beforeEach(async () => {
    calls = [];
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        calls.push(JSON.parse(body) as Call);
        res.end(JSON.stringify({ data: { variableUpsert: true } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql/v2`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  function run(args: string[], extra: Record<string, string> = {}) {
    const child = spawn(process.execPath, [script, ...args], {
      env: {
        IMAGE_API: 'ghcr.io/x/api@sha256:new',
        IMAGE_WEB: 'ghcr.io/x/web@sha256:new',
        IMAGE_WORKER: 'ghcr.io/x/worker@sha256:new',
        PATH: process.env['PATH'],
        RAILWAY_API_ENDPOINT: endpoint,
        RAILWAY_API_TOKEN: 'fake-token',
        RAILWAY_ENVIRONMENT_ID: 'env-fake',
        RAILWAY_PROJECT_ID: 'project-fake',
        RAILWAY_SERVICE_API: 'svc-api',
        RAILWAY_SERVICE_WEB: 'svc-web',
        RAILWAY_SERVICE_WORKER: 'svc-worker',
        SEED_PASSWORD: PASSWORD,
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (c) => {
      out += c;
    });
    child.stderr?.on('data', (c) => {
      out += c;
    });
    return new Promise<{ code: number | null; out: string }>((resolve) =>
      child.on('close', (code) => resolve({ code, out })),
    );
  }

  // @traces 1370-release-seed-no-ssh-FR-002
  it.each([
    [['Staging']],
    [['STAGING']],
    [['staging ']],
    [['']],
    [[]],
    [['__proto__']],
  ])(
    'exits 1 with the usage line and no Railway call for the arguments %j',
    async (args) => {
      const { code, out } = await run(args);
      expect(code).toBe(1);
      expect(out).toContain('usage: railway-deploy.ts <staging|production>');
      expect(calls).toEqual([]);
      expect(out).not.toContain(PASSWORD);
    },
    15_000,
  );

  // @traces 1370-release-seed-no-ssh-FR-002
  it('fails a staging run with no project id before any Railway call, naming the variable', async () => {
    const { code, out } = await run(['staging'], { RAILWAY_PROJECT_ID: '' });

    expect(code).toBe(1);
    expect(out).toContain('missing environment variable RAILWAY_PROJECT_ID');
    expect(calls).toEqual([]);
    expect(out).not.toContain(PASSWORD);
  }, 15_000);

  // @traces 1370-release-seed-no-ssh-FR-003
  it('keeps the password out of the output when the endpoint is refused as not loopback', async () => {
    const { code, out } = await run(['staging'], {
      RAILWAY_API_ENDPOINT: 'https://evil.example/graphql',
    });

    expect(code).toBe(1);
    expect(out).toContain('loopback');
    expect(out).not.toContain(PASSWORD);
  }, 15_000);

  // @traces 1370-release-seed-no-ssh-FR-003
  it('keeps the password out of the output when the connection is dropped mid-request', async () => {
    server.removeAllListeners('request');
    server.on('request', (req) => {
      req.on('data', () => {});
      req.on('end', () => req.socket.destroy());
    });

    const { code, out } = await run(['staging']);

    expect(code).toBe(1);
    expect(out).not.toContain(PASSWORD);
  }, 15_000);
});
