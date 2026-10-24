import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

// Starts the deploy script as the release workflow does, as its own process,
// against a fake Railway API on 127.0.0.1, and cancels it the way a cancelled
// run does: SIGINT, then SIGTERM while the restore is still in flight.

type Call = { query: string; variables: Record<string, unknown> };

const script = join(__dirname, 'railway-deploy.ts');

async function until(check: () => boolean, what: string) {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const isRestore = (call: Call) =>
  call.query.includes('serviceInstanceUpdate') &&
  String(
    (call.variables['input'] as { source?: { image?: string } }).source?.image,
  ).endsWith('@sha256:old');

// What Railway answers: the previous image, an accepted update, a deployment
// id, and a deployment that is still going.
function answer(call: Call) {
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
  return { deployment: { status: 'DEPLOYING' } };
}

// @traces 506-FR-003
describe('the deploy script as a process, cancelled mid-deploy', () => {
  it('restores the previous image through SIGINT then SIGTERM and exits 1 as cancelled', async () => {
    const calls: Call[] = [];
    let held: ServerResponse | undefined;
    const reply = (res: ServerResponse, data: unknown) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data }));
    };
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        if (isRestore(call) && !held) held = res;
        else reply(res, answer(call));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;

    let child: ChildProcess | undefined;
    try {
      // Only what the script reads, all fake: nothing from this environment's
      // Railway, GitHub or Grafana variables reaches it.
      child = spawn(process.execPath, [script, 'production'], {
        env: {
          IMAGE_API: 'ghcr.io/x/api@sha256:new',
          IMAGE_WEB: 'ghcr.io/x/web@sha256:new',
          IMAGE_WORKER: 'ghcr.io/x/worker@sha256:new',
          RAILWAY_API_ENDPOINT: `http://127.0.0.1:${port}/graphql/v2`,
          RAILWAY_API_TOKEN: 'fake-token',
          RAILWAY_ENVIRONMENT_ID: 'env-fake',
          RAILWAY_SERVICE_API: 'svc-api',
          RAILWAY_SERVICE_WEB: 'svc-web',
          RAILWAY_SERVICE_WORKER: 'svc-worker',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });
      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) =>
        child?.on('close', (code, signal) => resolve({ code, signal })),
      );
      let gone = false;
      void exited.then(() => {
        gone = true;
      });

      await until(
        () => gone || calls.some((c) => c.query.includes('deployment(')),
        'the api deployment to be polled',
      );
      child.kill('SIGINT');
      await until(() => gone || held !== undefined, 'the restore request');
      child.kill('SIGTERM');
      // The second signal must not end the run while the restore is open.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(gone).toBe(false);
      if (held) reply(held, { serviceInstanceUpdate: true });

      await until(() => gone, 'the exit');
      const { code, signal } = await exited;
      expect({ code, signal }).toEqual({ code: 1, signal: null });
      expect(stderr).toContain(
        'SIGINT: cancelling, restoring the previous images',
      );
      expect(stderr).toContain('deploy cancelled');
      const restore = calls.findIndex(isRestore);
      expect(calls[restore]?.variables['serviceId']).toBe('svc-api');
      // The api's deployment was in flight, so it is redeployed on the old image.
      expect(
        calls
          .slice(restore + 1)
          .some(
            (c) =>
              c.query.includes('serviceInstanceDeployV2') &&
              c.variables['serviceId'] === 'svc-api',
          ),
      ).toBe(true);
    } finally {
      child?.kill('SIGKILL');
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 15_000);
});

// What a Railway whose deployments all succeed answers; with echo, it
// refuses the variable write and repeats the value it was sent.
function succeeding(call: Call, echo: boolean) {
  if (call.query.includes('variableUpsert')) {
    const { value } = call.variables['input'] as { value: string };
    return echo
      ? { errors: [{ message: `refused value ${value}` }] }
      : { data: { variableUpsert: true } };
  }
  if (call.query.includes('deployment(')) {
    return { data: { deployment: { status: 'SUCCESS' } } };
  }
  return { data: answer(call) };
}

// The release as the staging and production jobs start it, against a fake
// Railway API whose deployments all succeed.
describe('the deploy script as a process, with the staging seed password', () => {
  const PASSWORD = 'parola-de-proba-71';
  let calls: Call[];
  let echo: boolean;
  let endpoint: string;
  let server: ReturnType<typeof createServer>;

  beforeEach(async () => {
    calls = [];
    echo = false;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const call = JSON.parse(body) as Call;
        calls.push(call);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(succeeding(call, echo)));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    endpoint = `http://127.0.0.1:${port}/graphql/v2`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  function run(environment: string, extra: Record<string, string> = {}) {
    const child = spawn(process.execPath, [script, environment], {
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
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      out += chunk;
    });
    return new Promise<{ code: number | null; out: string }>((resolve) =>
      child.on('close', (code) => resolve({ code, out })),
    );
  }

  const upserts = () => calls.filter((c) => c.query.includes('variableUpsert'));
  const apiPreDeploy = () =>
    calls
      .filter(
        (c) =>
          c.query.includes('serviceInstanceUpdate') &&
          c.variables['serviceId'] === 'svc-api',
      )
      .map(
        (c) =>
          (c.variables['input'] as { preDeployCommand?: string[] })
            .preDeployCommand,
      )[0];

  // @traces 1370-release-seed-no-ssh-FR-002
  // @traces 1370-release-seed-no-ssh-FR-003
  it('writes the password onto the api service before deploying anything, and never prints it', async () => {
    const { code, out } = await run('staging', { SEED_PASSWORD: PASSWORD });

    expect(code).toBe(0);
    expect(calls[0]?.query).toContain('variableUpsert');
    expect(calls[0]?.variables['input']).toEqual({
      environmentId: 'env-fake',
      name: 'SEED_PASSWORD',
      projectId: 'project-fake',
      serviceId: 'svc-api',
      skipDeploys: true,
      value: PASSWORD,
    });
    expect(upserts()).toHaveLength(1);
    expect(apiPreDeploy()?.join(' ')).toContain(
      'SEED_ONLY=1 sh scripts/reset-staging.sh',
    );
    expect(out).not.toContain(PASSWORD);
  }, 15_000);

  // @traces 1370-release-seed-no-ssh-FR-003
  it('keeps the password out of stdout and stderr when Railway echoes it in an error, and deploys nothing', async () => {
    echo = true;

    const { code, out } = await run('staging', { SEED_PASSWORD: PASSWORD });

    expect(code).toBe(1);
    expect(out).toContain('refused value [redacted]');
    expect(out).not.toContain(PASSWORD);
    expect(calls.some((c) => c.query.includes('serviceInstanceUpdate'))).toBe(
      false,
    );
  }, 15_000);

  // @traces 1370-release-seed-no-ssh-FR-002
  it.each([
    ['unset', {}],
    ['empty', { SEED_PASSWORD: '' }],
  ])(
    'fails a staging run whose password is %s before any Railway call',
    async (_, extra) => {
      const { code, out } = await run('staging', extra);

      expect(code).toBe(1);
      expect(out).toContain(
        'The staging environment has no SEED_PASSWORD secret',
      );
      expect(calls).toEqual([]);
    },
    15_000,
  );

  // @traces 1370-release-seed-no-ssh-FR-001
  // @traces 1370-release-seed-no-ssh-FR-002
  it('sends production neither the password nor the seed, even with the password set', async () => {
    const { code, out } = await run('production', { SEED_PASSWORD: PASSWORD });

    expect(code).toBe(0);
    expect(upserts()).toEqual([]);
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);
    expect(apiPreDeploy()).toEqual([
      'npx prisma migrate deploy && node scripts/monitor-password.ts',
    ]);
    expect(out).not.toContain(PASSWORD);
  }, 15_000);
});
