import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { deploy, type Service } from './railway-deploy.ts';

type Call = { query: string; variables: Record<string, unknown> };

const services: Service[] = [
  { id: 'svc-api', image: 'img/api@sha256:new', name: 'api', replicas: 1 },
  {
    id: 'svc-worker',
    image: 'img/worker@sha256:new',
    name: 'worker',
    replicas: 1,
  },
  { id: 'svc-web', image: 'img/web@sha256:new', name: 'web', replicas: 1 },
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

  it.each([
    'FAILED',
    'CRASHED',
    'REMOVED',
    'SKIPPED',
  ])('restores the previous image when the deployment ends as %s', async (status) => {
    statusFor = () => status;

    await expect(run()).rejects.toThrow(status);
    expect(updates().at(-1)).toEqual({
      id: 'svc-api',
      input: { source: { image: 'svc-api@sha256:old' } },
    });
  });

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
