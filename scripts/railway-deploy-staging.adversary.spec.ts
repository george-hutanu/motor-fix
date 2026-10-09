import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { deploy, servicesFor } from './railway-deploy.ts';

const ALL = {
  IMAGE_API: 'img/api@sha256:a',
  IMAGE_KEYCLOAK: 'img/keycloak@sha256:k',
  IMAGE_MCP: 'img/mcp@sha256:m',
  IMAGE_WEB: 'img/web@sha256:w',
  IMAGE_WORKER: 'img/worker@sha256:r',
  RAILWAY_SERVICE_API: 'sid-api',
  RAILWAY_SERVICE_KEYCLOAK: 'sid-keycloak',
  RAILWAY_SERVICE_MCP: 'sid-mcp',
  RAILWAY_SERVICE_WEB: 'sid-web',
  RAILWAY_SERVICE_WORKER: 'sid-worker',
};

describe('servicesFor under hostile input', () => {
  let notices: string[];

  beforeEach(() => {
    notices = [];
    jest.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      notices.push(a.join(' '));
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists staging in order with a health path and one replica for the two new services', () => {
    const list = servicesFor('staging', ALL);

    expect(
      list.map((s) => [s.name, s.healthcheckPath, s.replicas === 1]),
    ).toEqual([
      ['api', '/health/ready', true],
      ['worker', '/health/ready', true],
      ['web', '/health/ready', true],
      ['keycloak', '/realms/master', true],
      ['mcp', '/health/live', true],
    ]);
    expect(notices).toEqual([]);
  });

  // Railway refuses a health check path with a dot or a hyphen in it
  // ("Invalid input"); the paths it accepts hold letters and slashes only.
  it('sends every health check path as letters, digits and slashes only', () => {
    for (const environment of ['staging', 'production']) {
      for (const { healthcheckPath } of servicesFor(environment, ALL)) {
        expect(healthcheckPath).toMatch(/^\/[A-Za-z0-9/]+$/);
      }
    }
  });

  it('never lists mcp or keycloak for production, even with their ids and images set', () => {
    const list = servicesFor('production', ALL);

    expect(list.map((s) => s.name)).toEqual(['api', 'worker', 'web']);
    expect(notices).toEqual([]);
  });

  it('does not require mcp or keycloak variables for production', () => {
    const {
      IMAGE_KEYCLOAK: _a,
      IMAGE_MCP: _b,
      RAILWAY_SERVICE_KEYCLOAK: _c,
      RAILWAY_SERVICE_MCP: _d,
      ...three
    } = ALL;

    expect(servicesFor('production', three).map((s) => s.name)).toEqual([
      'api',
      'worker',
      'web',
    ]);
  });

  it('skips both with one notice each naming the variable when neither id is set', () => {
    const {
      RAILWAY_SERVICE_KEYCLOAK: _a,
      RAILWAY_SERVICE_MCP: _b,
      ...env
    } = ALL;

    const list = servicesFor('staging', env);

    expect(list.map((s) => s.name)).toEqual(['api', 'worker', 'web']);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('RAILWAY_SERVICE_KEYCLOAK');
    expect(notices[1]).toContain('RAILWAY_SERVICE_MCP');
  });

  it('skips a service whose id is the empty string, naming only the variable', () => {
    const list = servicesFor('staging', { ...ALL, RAILWAY_SERVICE_MCP: '' });

    expect(list.map((s) => s.name)).toEqual([
      'api',
      'worker',
      'web',
      'keycloak',
    ]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^::notice::/);
    expect(notices[0]).toContain('RAILWAY_SERVICE_MCP');
    expect(notices.join('\n')).not.toContain('sid-');
  });

  it('deploys keycloak alone when only its id is set', () => {
    const { RAILWAY_SERVICE_MCP: _a, ...env } = ALL;

    expect(servicesFor('staging', env).map((s) => s.name)).toEqual([
      'api',
      'worker',
      'web',
      'keycloak',
    ]);
  });

  it('fails naming IMAGE_MCP when the mcp id is set and its image is not', () => {
    const { IMAGE_MCP: _a, ...env } = ALL;

    expect(() => servicesFor('staging', env)).toThrow('IMAGE_MCP');
  });

  it('fails naming IMAGE_KEYCLOAK when the image is the empty string', () => {
    expect(() =>
      servicesFor('staging', { ...ALL, IMAGE_KEYCLOAK: '' }),
    ).toThrow('IMAGE_KEYCLOAK');
  });

  it('still requires the three always-present services', () => {
    expect(() =>
      servicesFor('staging', { ...ALL, RAILWAY_SERVICE_WORKER: undefined }),
    ).toThrow('RAILWAY_SERVICE_WORKER');
  });

  it.each([
    '',
    'prod',
    'Staging',
    'production ',
    'constructor',
    '__proto__',
    'toString',
  ])('rejects the unknown environment %j with the usage line', (name) => {
    expect(() => servicesFor(name, ALL)).toThrow('usage: railway-deploy.ts');
  });
});

describe('the staging deploy of five services', () => {
  let server: Server;
  let endpoint: string;
  let updates: { id: string; image?: string }[];
  let failing: string | undefined;

  // The fake Railway API: records image updates, fails the deployment of
  // the service named by `failing`.
  function answer(call: {
    query: string;
    variables: Record<string, unknown>;
  }): unknown {
    const id = String(call.variables['serviceId']);
    if (call.query.includes('serviceInstanceUpdate')) {
      const input = call.variables['input'] as { source?: { image?: string } };
      updates.push({ id, image: input.source?.image });
      return { serviceInstanceUpdate: true };
    }
    if (call.query.includes('serviceInstanceDeployV2'))
      return { serviceInstanceDeployV2: `dep-${id}` };
    if (call.query.includes('serviceInstance('))
      return { serviceInstance: { source: { image: `${id}@old` } } };
    const dep = String(call.variables['id']).replace('dep-', '');
    return { deployment: { status: dep === failing ? 'FAILED' : 'SUCCESS' } };
  }

  beforeEach(async () => {
    updates = [];
    failing = undefined;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        res.end(JSON.stringify({ data: answer(JSON.parse(body)) }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    endpoint = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve) => server.close(resolve));
  });

  const run = () =>
    deploy({
      endpoint,
      environmentId: 'env-1',
      limitMs: 200,
      pollMs: 5,
      services: servicesFor('staging', ALL),
      token: 'tok',
    });

  it('deploys all five in order when every health check passes', async () => {
    await run();

    expect(updates.map((u) => u.id)).toEqual([
      'sid-api',
      'sid-worker',
      'sid-web',
      'sid-keycloak',
      'sid-mcp',
    ]);
  });

  it('restores api, worker and web and never starts mcp when keycloak fails', async () => {
    failing = 'sid-keycloak';

    await expect(run()).rejects.toThrow('keycloak');

    expect(updates.map((u) => u.id)).not.toContain('sid-mcp');
    const restored = updates.filter((u) => u.image?.endsWith('@old'));
    expect(restored.map((u) => u.id).sort()).toEqual(
      ['sid-api', 'sid-keycloak', 'sid-web', 'sid-worker'].sort(),
    );
  });

  it('restores all four earlier services when mcp fails its health check', async () => {
    failing = 'sid-mcp';

    await expect(run()).rejects.toThrow('mcp');

    const restored = updates.filter((u) => u.image?.endsWith('@old'));
    expect(restored.map((u) => u.id).sort()).toEqual(
      ['sid-api', 'sid-keycloak', 'sid-mcp', 'sid-web', 'sid-worker'].sort(),
    );
  });
});
