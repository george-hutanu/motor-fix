import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { deploy, type Service } from './railway-deploy.ts';

type Call = { query: string; variables: Record<string, unknown> };

const services: Service[] = [
  {
    id: 'svc-api',
    image: 'ghcr.io/x/api@sha256:new',
    name: 'api',
    preDeploy: ['npx prisma migrate deploy'],
    replicas: 2,
  },
  {
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
          preDeployCommand: ['npx prisma migrate deploy'],
          region: 'europe-west4-drams3a',
          source: { image: 'ghcr.io/x/api@sha256:new' },
        },
        serviceId: 'svc-api',
      },
      {
        environmentId: 'env-1',
        input: {
          healthcheckPath: '/health/ready',
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

  // @traces 491-FR-005
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    cancel.abort();

    await expect(started).rejects.toThrow('cancelled');
    expect(updates().at(-1)).toEqual({
      environmentId: 'env-1',
      input: { source: { image: 'svc-api@sha256:old' } },
      serviceId: 'svc-api',
    });
    expect(calls.some((c) => c.variables['serviceId'] === 'svc-web')).toBe(
      false,
    );
  });

  // @traces 491-FR-005
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
    await new Promise((resolve) => setTimeout(resolve, 80));
    cancel.abort();

    await expect(started).rejects.toThrow('cancelled');
    const restores = updates().filter(
      (u) => !('healthcheckPath' in (u['input'] as object)),
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
    expect(redeploys).toEqual(['svc-api', 'svc-web', 'svc-api', 'svc-web']);
  });

  // @traces 491-FR-005
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
});
