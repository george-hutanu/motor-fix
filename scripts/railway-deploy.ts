// Points each Railway service of one environment at an image digest built by
// the release workflow, deploys it, and waits until Railway's health check
// passes. On failure the service is pointed back at its previous image; Railway
// itself keeps traffic on the previous deployment. SIGINT or SIGTERM (a
// cancelled workflow run) stops the wait and restores the same way.
//
//   node scripts/railway-deploy.ts <staging|production>
//
// Reads RAILWAY_API_TOKEN, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_<APP> and
// IMAGE_<APP> for each service of the environment: API, WORKER, WEB, and on
// staging only KEYCLOAK and MCP. An unset RAILWAY_SERVICE_KEYCLOAK or
// RAILWAY_SERVICE_MCP skips that service with a notice, until the owner has
// created it. RAILWAY_TOKEN_KIND=project sends the token as a project token;
// unset, a bearer token Railway refuses is retried once as a project token.

export interface Service {
  name: string;
  id: string;
  image: string;
  healthcheckPath: string;
  replicas: number;
  preDeploy?: string[];
}

interface Options {
  endpoint: string;
  token: string;
  // Account and workspace tokens go as a bearer, project tokens in
  // Project-Access-Token. Unset: bearer first, project if Railway refuses it.
  tokenKind?: TokenKind;
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

type TokenKind = 'bearer' | 'project';

// Railway answers a refused token with HTTP 200 and this message.
const REFUSED = 'Not Authorized';

const authHeader = (kind: TokenKind, token: string): Record<string, string> =>
  kind === 'project'
    ? { 'project-access-token': token }
    : { authorization: `Bearer ${token}` };

const errorText = (errors?: { message: string }[]) =>
  errors?.map((e) => e.message).join('; ') ?? '';

async function request<T>(
  options: Options,
  kind: TokenKind,
  query: string,
  variables: Record<string, unknown>,
) {
  const res = await fetch(options.endpoint, {
    body: JSON.stringify({ query, variables }),
    headers: {
      ...authHeader(kind, options.token),
      'content-type': 'application/json',
    },
    method: 'POST',
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });
  // A GraphQL validation error comes back as a 400 whose body names it.
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!res.ok) {
    const why = errorText(body.errors);
    throw new Error(
      `Railway API answered HTTP ${res.status}${why ? `: ${why}` : ''}`,
    );
  }
  return body;
}

async function graphql<T>(
  options: Options,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let body = await request<T>(
    options,
    options.tokenKind ?? 'bearer',
    query,
    variables,
  );
  if (
    !options.tokenKind &&
    !body.data &&
    body.errors?.some((e) => e.message === REFUSED)
  ) {
    body = await request<T>(options, 'project', query, variables);
    // Remember what worked, so later calls go straight to it.
    if (body.data) options.tokenKind = 'project';
  }
  if (!body.data) throw new Error(errorText(body.errors) || 'no data');
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
    'query ($serviceId: String!, $environmentId: String!) { serviceInstance(serviceId: $serviceId, environmentId: $environmentId) { source { image } } }',
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
    healthcheckPath: service.healthcheckPath,
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

// The api goes first: its pre-deploy step migrates the database the others
// use, then sets the monitor role's password.
export const API_PRE_DEPLOY = [
  'npx prisma migrate deploy && node scripts/monitor-password.ts',
];

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

// Production is the three apps; the identity server and the MCP server run on
// staging only, in that order, after the api they both call.
const ENVIRONMENTS: Record<
  string,
  { services: string[]; replicas: Record<string, number> }
> = {
  production: {
    replicas: { api: 2, web: 2 },
    services: ['api', 'worker', 'web'],
  },
  staging: {
    replicas: {},
    services: ['api', 'worker', 'web', 'keycloak', 'mcp'],
  },
};

// Keycloak is healthy once its realm answers; the MCP server's readiness
// would wait on the identity server, so Railway checks its liveness.
const HEALTH_PATH: Record<string, string> = {
  keycloak: '/realms/motorfix-assistants/.well-known/openid-configuration',
  mcp: '/health/live',
};

// Created by the owner after the first release that carries them.
const OPTIONAL = new Set(['keycloak', 'mcp']);

function required(
  name: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const value = env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

export function servicesFor(
  environment: string,
  env: Record<string, string | undefined> = process.env,
): Service[] {
  const settings = Object.hasOwn(ENVIRONMENTS, environment)
    ? ENVIRONMENTS[environment]
    : undefined;
  if (!settings)
    throw new Error('usage: railway-deploy.ts <staging|production>');
  return settings.services.flatMap((name) => {
    const id = `RAILWAY_SERVICE_${name.toUpperCase()}`;
    if (OPTIONAL.has(name) && !env[id]) {
      console.log(
        `::notice::${id} is not set; ${name} was not deployed for this release.`,
      );
      return [];
    }
    return [
      {
        healthcheckPath: HEALTH_PATH[name] ?? '/health/ready',
        id: required(id, env),
        image: required(`IMAGE_${name.toUpperCase()}`, env),
        name,
        replicas: settings.replicas[name] ?? 1,
        ...(name === 'api' && { preDeploy: API_PRE_DEPLOY }),
      },
    ];
  });
}

async function main() {
  const services = servicesFor(process.argv[2] ?? '');
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
    services,
    signal: cancel.signal,
    token: required('RAILWAY_API_TOKEN'),
    ...(process.env['RAILWAY_TOKEN_KIND'] === 'project' && {
      tokenKind: 'project' as const,
    }),
  });
}

if (process.argv[1]?.endsWith('railway-deploy.ts')) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
