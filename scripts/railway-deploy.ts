// Points each Railway service of one environment at an image digest built by
// the release workflow, deploys it, and waits until Railway's health check
// passes. On failure the service is pointed back at its previous image; Railway
// itself keeps traffic on the previous deployment. SIGINT or SIGTERM (a
// cancelled workflow run) stops the wait and restores the same way.
//
//   node scripts/railway-deploy.ts <staging|production>
//
// Reads RAILWAY_API_TOKEN, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_<APP> and
// IMAGE_<APP> for APP in API, WORKER, WEB.

export interface Service {
  name: string;
  id: string;
  image: string;
  replicas: number;
  preDeploy?: string[];
}

interface Options {
  endpoint: string;
  token: string;
  environmentId: string;
  services: Service[];
  limitMs: number;
  pollMs: number;
  // Aborted when the run is cancelled: waiting and in-flight calls stop, and
  // the restore runs without it.
  signal?: AbortSignal;
}

const REGION = 'europe-west4-drams3a';
const HEALTH_TIMEOUT_S = 300;
const DONE = 'SUCCESS';
const FAILED = ['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED'];

async function graphql<T>(
  options: Options,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(options.endpoint, {
    body: JSON.stringify({ query, variables }),
    headers: {
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Railway API answered HTTP ${res.status}`);
  const body = (await res.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!body.data) {
    throw new Error(
      body.errors?.map((e) => e.message).join('; ') ?? `HTTP ${res.status}`,
    );
  }
  return body.data;
}

const CANCELLED = 'deploy cancelled';

function stopIfCancelled(options: Options) {
  if (options.signal?.aborted) throw new Error(CANCELLED);
}

const pause = (options: Options) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, options.pollMs);
    options.signal?.addEventListener('abort', done);
  });

const update = (options: Options, serviceId: string, input: object) =>
  graphql(
    options,
    'mutation ($serviceId: String!, $environmentId: String, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }',
    { environmentId: options.environmentId, input, serviceId },
  );

async function waitFor(
  options: Options,
  deploymentId: string,
): Promise<string> {
  const until = Date.now() + options.limitMs;
  while (Date.now() < until) {
    stopIfCancelled(options);
    const { deployment } = await graphql<{ deployment: { status: string } }>(
      options,
      'query ($id: String!) { deployment(id: $id) { status } }',
      { id: deploymentId },
    );
    if (deployment.status === DONE || FAILED.includes(deployment.status)) {
      return deployment.status;
    }
    await pause(options);
  }
  stopIfCancelled(options);
  return 'TIMED_OUT';
}

const previousImage = async (options: Options, service: Service) => {
  const { serviceInstance } = await graphql<{
    serviceInstance: { source: { image: string | null } | null };
  }>(
    options,
    'query ($serviceId: String, $environmentId: String) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { source { image } } }',
    { environmentId: options.environmentId, serviceId: service.id },
  );
  return serviceInstance.source?.image ?? undefined;
};

const redeploy = (options: Options, service: Service) =>
  graphql<{ serviceInstanceDeployV2: string }>(
    options,
    'mutation ($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
    { environmentId: options.environmentId, serviceId: service.id },
  );

// One service this run touched: the image it ran before, whether a
// deployment of the new image was requested, and whether it went live.
interface Touched {
  service: Service;
  previous?: string;
  started: boolean;
  live: boolean;
}

async function deployOne(options: Options, entry: Touched) {
  const { service } = entry;
  await update(options, service.id, {
    healthcheckPath: '/health/ready',
    healthcheckTimeout: HEALTH_TIMEOUT_S,
    numReplicas: service.replicas,
    ...(service.preDeploy && { preDeployCommand: service.preDeploy }),
    region: REGION,
    source: { image: service.image },
  });
  // Set before the request: once sent, Railway may have accepted it even if
  // the answer never arrives.
  entry.started = true;
  const { serviceInstanceDeployV2: deploymentId } = await redeploy(
    options,
    service,
  );
  const status = await waitFor(options, deploymentId);
  if (status === DONE) return;
  throw new Error(
    status === 'TIMED_OUT'
      ? `${service.name}: not healthy within ${options.limitMs / 1000} s`
      : `${service.name}: deployment ${status}`,
  );
}

// Puts every service this run touched back on the image it ran before. The
// ones that already went live on the new image are redeployed; the one that
// failed is still serving its previous deployment. On a cancel, the one whose
// deployment was still in progress is redeployed too, because that deployment
// may yet go live on the new image. Services are restored side by side, so
// one slow or failing answer neither delays nor stops the others.
async function restore(options: Options, touched: Touched[]) {
  const results = await Promise.allSettled(
    touched.map(async ({ service, previous, live }) => {
      if (!previous) return;
      await update(options, service.id, { source: { image: previous } });
      if (live) await redeploy(options, service);
    }),
  );
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error(
        `restore of ${touched[i]?.service.name} failed: ${(result.reason as Error).message}`,
      );
    }
  }
}

// The api goes first: its pre-deploy step migrates the database the others use.
export async function deploy(options: Options) {
  const touched: Touched[] = [];
  try {
    for (const service of options.services) {
      stopIfCancelled(options);
      const entry: Touched = {
        live: false,
        previous: await previousImage(options, service),
        service,
        started: false,
      };
      touched.push(entry);
      await deployOne(options, entry);
      entry.live = true;
    }
  } catch (error) {
    const cancelled = options.signal?.aborted ?? false;
    if (cancelled) {
      for (const entry of touched) entry.live ||= entry.started;
    }
    await restore({ ...options, signal: undefined }, touched);
    throw cancelled ? new Error(CANCELLED) : error;
  }
}

const REPLICAS: Record<string, Record<string, number>> = {
  production: { api: 2, web: 2, worker: 1 },
  staging: { api: 1, web: 1, worker: 1 },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

async function main() {
  const replicas = REPLICAS[process.argv[2] ?? ''];
  if (!replicas)
    throw new Error('usage: railway-deploy.ts <staging|production>');
  // A cancelled run gets SIGINT, then SIGTERM a few seconds later. Both stay
  // handled for the whole run, so the second does not kill the restore.
  const cancel = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (cancel.signal.aborted) return;
      console.error(`${signal}: cancelling, restoring the previous images`);
      cancel.abort();
    });
  }
  return deploy({
    endpoint: 'https://backboard.railway.com/graphql/v2',
    environmentId: required('RAILWAY_ENVIRONMENT_ID'),
    // Railway's own health check (HEALTH_TIMEOUT_S, counted from container
    // start) decides; this limit only stops a run whose deployment never ends.
    limitMs: 20 * 60_000,
    pollMs: 5_000,
    services: ['api', 'worker', 'web'].map((name) => ({
      id: required(`RAILWAY_SERVICE_${name.toUpperCase()}`),
      image: required(`IMAGE_${name.toUpperCase()}`),
      name,
      replicas: replicas[name] ?? 1,
      ...(name === 'api' && { preDeploy: ['npx prisma migrate deploy'] }),
    })),
    signal: cancel.signal,
    token: required('RAILWAY_API_TOKEN'),
  });
}

if (process.argv[1]?.endsWith('railway-deploy.ts')) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
