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
