// Opens, drives and closes a short-lived Railway sandbox on one environment's
// private network, so a workflow can reach a service that has no public
// address without `railway ssh` (which Railway refuses to the repository's
// tokens). The backup, the staging reset and the point-in-time drill use it.
//
//   node scripts/railway-sandbox.ts open <staging|production> <postgres|api>
//   node scripts/railway-sandbox.ts image <service-id>
//   node scripts/railway-sandbox.ts exec <sandbox-id> [command...]
//   node scripts/railway-sandbox.ts close <sandbox-id>
//   node scripts/railway-sandbox.ts mask <NAME...>
//   node scripts/railway-sandbox.ts prelude <NAME...>
//
// open refuses unless Railway names RAILWAY_ENVIRONMENT_ID `<environment>`,
// and refuses `api` anywhere but staging. It reads the service's name by its
// id (RAILWAY_SERVICE_POSTGRES or RAILWAY_SERVICE_API), creates the sandbox on
// the private network with only Railway reference variables (Railway resolves
// them, so no value passes through this script), waits until it runs and
// prints its id; under GitHub Actions it also writes `id=` to $GITHUB_OUTPUT
// as soon as the sandbox exists, so a closing step finds it even if the wait
// fails or is cancelled. exec streams stdin into the sandbox (`sh -s` by
// default) and exits with the command's code: only small text should come
// back that way, since a large stream arrives cut short. A secret goes in on
// stdin, in the lines `prelude` prints, after `mask` has hidden its raw and
// base64 forms from the log; never as an argument or a Railway variable.
//
// Railway is called through the pinned Railway CLI (`railway api`, `railway
// sandbox exec`). RAILWAY_API_TOKEN goes as
// an account token first and, when Railway refuses it, once more as a project
// token (RAILWAY_TOKEN), as scripts/railway-deploy.ts does;
// RAILWAY_TOKEN_KIND=project goes straight to the second. With no
// RAILWAY_API_TOKEN (a laptop), the CLI's own login is used.

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export type Kind = 'postgres' | 'api';
type TokenKind = 'bearer' | 'project';
type Env = Record<string, string | undefined>;

const REGION = 'europe-west4-drams3a';
const IDLE_MINUTES = 30;
const READY_LIMIT_MS = 5 * 60_000;
const POLL_MS = 5_000;
const EXEC_TIMEOUT_S = 3_000;
// Railway answers a refused token with this message.
const REFUSED = 'Not Authorized';

const VARIABLES: Record<Kind, string[]> = {
  api: ['APP_ENV', 'DATABASE_URL', 'RAILWAY_ENVIRONMENT_NAME'],
  postgres: [
    'PGDATABASE',
    'PGHOST',
    'PGPASSWORD',
    'PGPORT',
    'PGUSER',
    'RAILWAY_ENVIRONMENT_NAME',
  ],
};
const SERVICE_VARIABLE: Record<Kind, string> = {
  api: 'RAILWAY_SERVICE_API',
  postgres: 'RAILWAY_SERVICE_POSTGRES',
};
const ENVIRONMENTS = ['staging', 'production'];

const isKind = (kind: string): kind is Kind => Object.hasOwn(VARIABLES, kind);

// Railway reference variables naming the service's own variables.
export function references(kind: Kind, service: string) {
  // No dot: `${{my.db.PGHOST}}` would not say which part is the service.
  if (!/^\w[\w -]*$/.test(service)) {
    throw new Error(`a reference cannot hold the service name '${service}'`);
  }
  return Object.fromEntries(
    VARIABLES[kind].map((name) => [name, `\${{${service}.${name}}}`]),
  );
}

export function createInput(
  environmentId: string,
  kind: Kind,
  service: string,
) {
  return {
    environmentId,
    idleTimeoutMinutes: IDLE_MINUTES,
    networkIsolation: 'PRIVATE',
    region: REGION,
    variables: references(kind, service),
  };
}

// Why a sandbox must not open, or undefined when it may.
export function refusal(environment: string, kind: string, actual: string) {
  if (!ENVIRONMENTS.includes(environment)) {
    return `unknown environment '${environment}': staging or production`;
  }
  if (!isKind(kind)) return `unknown kind '${kind}': postgres or api`;
  if (actual !== environment) {
    return `RAILWAY_ENVIRONMENT_ID is Railway's '${actual}', not '${environment}'`;
  }
  if (kind === 'api' && environment !== 'staging') {
    return 'an api sandbox opens on staging only';
  }
  return undefined;
}

const NAME = /^[A-Z_][A-Z0-9_]*$/;

function value(env: Env, name: string) {
  if (!NAME.test(name)) throw new Error(`'${name}' is not a variable name`);
  return required(env, name);
}

const base64 = (text: string) => Buffer.from(text).toString('base64');

// Shell lines that set and export each named value, base64 so no quoting can
// break them. Fed on stdin in front of a script; never printed to a log. The
// trailing x keeps the value's own trailing newlines, which `$(...)` drops.
export function prelude(env: Env, names: string[]) {
  return names
    .map((name) => {
      const encoded = base64(value(env, name));
      return `${name}=$(printf %s '${encoded}' | base64 -d; printf x); ${name}=\${${name}%x}; export ${name}\n`;
    })
    .join('');
}

// GitHub reads one mask command per line, so a multi-line value is masked
// line by line, never as one command that would end at its first line.
export function maskLines(env: Env, names: string[]) {
  const lines = new Set<string>();
  for (const name of names) {
    const found = env[name];
    if (!found) continue;
    for (const part of [...found.split(/\r?\n/), base64(found)]) {
      if (part.trim()) lines.add(`::add-mask::${part}`);
    }
  }
  return [...lines];
}

export type Run = (
  args: string[],
  env: Env,
) => { status: number | null; stdout: string; stderr: string };

interface Context {
  env: Env;
  run: Run;
  kind?: TokenKind;
}

// The token as the CLI reads it: an account or workspace token in
// RAILWAY_API_TOKEN, a project token in RAILWAY_TOKEN, never both.
// With none (a laptop), the CLI's own login is used and nothing is retried.
function tokenEnv(ctx: Context, kind: TokenKind): Env {
  const token = ctx.env.RAILWAY_API_TOKEN;
  if (!token) return ctx.env;
  const { RAILWAY_API_TOKEN: _a, RAILWAY_TOKEN: _p, ...rest } = ctx.env;
  return kind === 'project'
    ? { ...rest, RAILWAY_TOKEN: token }
    : { ...rest, RAILWAY_API_TOKEN: token };
}

function firstKind(ctx: Context): TokenKind {
  return (
    ctx.kind ??
    (ctx.env.RAILWAY_TOKEN_KIND === 'project' ? 'project' : 'bearer')
  );
}

type Answer = { data?: unknown; errors?: { message: string }[] };

function parse(stdout: string): Answer {
  try {
    return JSON.parse(stdout) as Answer;
  } catch {
    return {};
  }
}

const refused = (answer: Answer) =>
  !answer.data && (answer.errors ?? []).some((e) => e.message === REFUSED);

// Runs one CLI command with the token, retried once as a project token when
// Railway refuses a bearer it was not told the kind of.
function withToken(
  ctx: Context,
  args: string[],
  isRefused: (out: string) => boolean,
) {
  const kind = firstKind(ctx);
  let result = ctx.run(args, tokenEnv(ctx, kind));
  const retry = kind === 'bearer' && !ctx.kind && ctx.env.RAILWAY_API_TOKEN;
  if (retry && isRefused(result.stdout)) {
    result = ctx.run(args, tokenEnv(ctx, 'project'));
    if (!isRefused(result.stdout)) ctx.kind = 'project';
  } else if (!isRefused(result.stdout)) {
    ctx.kind = kind;
  }
  return result;
}

export function railwayApi<T>(
  query: string,
  variables: Record<string, unknown>,
  ctx: Context,
): T {
  const result = withToken(
    ctx,
    ['api', query, '--variables', JSON.stringify(variables), '--compact'],
    (out) => refused(parse(out)),
  );
  const answer = parse(result.stdout);
  if (result.status !== 0 || !answer.data || answer.errors?.length) {
    const why =
      answer.errors?.map((e) => e.message).join('; ') ||
      result.stderr.trim().split('\n').pop() ||
      `exit ${result.status}`;
    throw new Error(`Railway API: ${why}`);
  }
  return answer.data as T;
}

export async function waitRunning(
  read: () => string,
  options: {
    limitMs: number;
    pollMs: number;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  },
) {
  const deadline = options.now() + options.limitMs;
  let status = read();
  while (status !== 'RUNNING') {
    // Only CREATING still leads to RUNNING.
    if (status !== 'CREATING') throw new Error(`sandbox is ${status}`);
    if (options.now() >= deadline) {
      throw new Error(
        `sandbox still ${status} after ${options.limitMs / 1000} s`,
      );
    }
    await options.sleep(options.pollMs);
    status = read();
  }
}

function context(env: Env): Context {
  return {
    env,
    run: (args, runEnv) => {
      const r = spawnSync('railway', args, {
        encoding: 'utf8',
        env: runEnv as NodeJS.ProcessEnv,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (r.error) throw r.error;
      return { status: r.status, stderr: r.stderr, stdout: r.stdout };
    },
  };
}

function required(env: Env, name: string) {
  const found = env[name];
  if (!found) throw new Error(`${name} is not set`);
  return found;
}

function status(ctx: Context, environmentId: string, id: string) {
  const data = railwayApi<{ sandbox: { status: string } | null }>(
    'query($e:String!,$i:String!){ sandbox(environmentId:$e, id:$i){ status } }',
    { e: environmentId, i: id },
    ctx,
  );
  return data.sandbox?.status ?? 'DESTROYED';
}

function destroy(ctx: Context, environmentId: string, id: string) {
  railwayApi(
    'mutation($e:String!,$i:String!){ sandboxDestroy(environmentId:$e, id:$i){ id } }',
    { e: environmentId, i: id },
    ctx,
  );
}

// open destroys a sandbox that never ran, so the closing step may find it
// already gone.
export function close(ctx: Context, id: string): 'closed' | 'gone' {
  try {
    destroy(ctx, required(ctx.env, 'RAILWAY_ENVIRONMENT_ID'), id);
    return 'closed';
  } catch (error) {
    if (!/not found/i.test(String(error))) throw error;
    return 'gone';
  }
}

type Timing = Parameters<typeof waitRunning>[1];

const TIMING: Timing = {
  limitMs: READY_LIMIT_MS,
  now: Date.now,
  pollMs: POLL_MS,
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
};

const present = <T>(value: T | null | undefined, what: string): T => {
  if (value == null) throw new Error(`Railway returned no ${what}`);
  return value;
};

export async function open(
  ctx: Context,
  environment: string,
  kind: string,
  timing: Timing = TIMING,
) {
  const environmentId = required(ctx.env, 'RAILWAY_ENVIRONMENT_ID');
  const named = railwayApi<{ environment: { name: string } | null }>(
    'query($e:String!){ environment(id:$e){ name } }',
    { e: environmentId },
    ctx,
  );
  const actual = present(named.environment, 'environment').name;
  const why = refusal(environment, kind, actual);
  if (why || !isKind(kind)) throw new Error(`sandbox refused: ${why}`);
  const service = railwayApi<{ service: { name: string } | null }>(
    'query($s:String!){ service(id:$s){ name } }',
    { s: required(ctx.env, SERVICE_VARIABLE[kind]) },
    ctx,
  );
  const created = railwayApi<{ sandboxCreate: { id: string } | null }>(
    'mutation($input:SandboxCreateInput!){ sandboxCreate(input:$input){ id } }',
    {
      input: createInput(
        environmentId,
        kind,
        present(service.service, 'service').name,
      ),
    },
    ctx,
  );
  const id = present(created.sandboxCreate, 'sandbox').id;
  if (ctx.env.GITHUB_OUTPUT) {
    appendFileSync(ctx.env.GITHUB_OUTPUT, `id=${id}\n`);
  }
  const stop = () => {
    try {
      destroy(ctx, environmentId, id);
    } finally {
      process.exit(1);
    }
  };
  process.once('SIGTERM', stop).once('SIGINT', stop);
  try {
    await waitRunning(() => status(ctx, environmentId, id), timing);
  } catch (error) {
    try {
      destroy(ctx, environmentId, id);
    } catch (failed) {
      throw new Error(`${String(error)}; then ${String(failed)}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    process.off('SIGTERM', stop).off('SIGINT', stop);
  }
  return id;
}

function image(env: Env, serviceId: string) {
  const data = railwayApi<{
    serviceInstance: { source: { image: string | null } | null } | null;
  }>(
    'query($e:String!,$s:String!){ serviceInstance(environmentId:$e, serviceId:$s){ source { image } } }',
    { e: required(env, 'RAILWAY_ENVIRONMENT_ID'), s: serviceId },
    context(env),
  );
  const found = data.serviceInstance?.source?.image;
  if (!found) throw new Error('the service runs no image');
  process.stdout.write(`${found}\n`);
}

function exec(env: Env, id: string, command: string[]) {
  if (!id) throw new Error('exec needs a sandbox id');
  const ctx = context(env);
  const environmentId = required(env, 'RAILWAY_ENVIRONMENT_ID');
  // Also settles which kind the token is before stdin is consumed.
  const now = status(ctx, environmentId, id);
  if (now !== 'RUNNING') throw new Error(`sandbox is ${now}`);
  const r = spawnSync(
    'railway',
    [
      'sandbox',
      'exec',
      '--project',
      required(env, 'RAILWAY_PROJECT_ID'),
      '--environment',
      environmentId,
      '--id',
      id,
      '--timeout',
      String(EXEC_TIMEOUT_S),
      '--',
      ...(command.length ? command : ['sh', '-s']),
    ],
    {
      env: tokenEnv(ctx, firstKind(ctx)) as NodeJS.ProcessEnv,
      stdio: 'inherit',
    },
  );
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function usage() {
  process.stderr.write(
    'usage: railway-sandbox.ts open <env> <postgres|api> | image <service-id> | exec <id> [cmd...] | close <id> | mask <NAME...> | prelude <NAME...>\n',
  );
  return 2;
}

const write = (text: string) => {
  process.stdout.write(text);
  return 0;
};

const COMMANDS: Record<
  string,
  (env: Env, args: string[]) => number | Promise<number>
> = {
  close: (env, [id]) => {
    if (!id) return usage();
    return write(
      close(context(env), id) === 'gone' ? 'sandbox already gone\n' : '',
    );
  },
  exec: (env, [id = '', ...command]) => exec(env, id, command),
  image: (env, [serviceId = '']) => {
    image(env, serviceId);
    return 0;
  },
  mask: (env, names) =>
    write(
      maskLines(env, names)
        .map((l) => `${l}\n`)
        .join(''),
    ),
  open: async (env, [environment = '', kind = '']) =>
    write(`${await open(context(env), environment, kind)}\n`),
  prelude: (env, names) => write(prelude(env, names)),
};

// async, so a command that throws ends in the one error line below.
async function main(argv: string[], env: Env = process.env) {
  const [command = '', ...args] = argv;
  const run = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  return run ? run(env, args) : usage();
}

if (process.argv[1]?.endsWith('railway-sandbox.ts')) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `railway-sandbox: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
